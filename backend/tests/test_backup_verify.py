"""Plan 23 Phase 1 — Tier-1 backup verification proving tests.

Covers the manifest writer + post-run verifier (backup_verify_service): manifest
shape, corrupted-archive detection (flip a byte -> verify_error), incremental
chain metadata intact, and legacy-run serialization compatibility. All tests use
real (small) tar archives so they run cross-platform (the verifier falls back to
Python's tarfile where GNU tar is unavailable, e.g. Windows dev)."""
import os
import tarfile

from app import db
from app.services.backup_policy_service import BackupPolicyService
from app.services import backup_verify_service as bv


def _mk_run(policy_id, storage_path, primary, kind='full', meta_extra=None):
    from app.models.backup_run import BackupRun
    run = BackupRun(policy_id=policy_id, kind=kind, status='verifying',
                    storage_path=storage_path)
    meta = {'engine': 'files', 'kind': kind, 'primary_archive': primary,
            'incremental': False}
    if meta_extra:
        meta.update(meta_extra)
    run.set_metadata(meta)
    db.session.add(run)
    db.session.commit()
    return run, meta


def _write_tar_gz(dest, payload=b'hello world'):
    """A tiny valid .tar.gz containing one file."""
    import io
    with tarfile.open(dest, 'w:gz') as tar:
        data = io.BytesIO(payload)
        info = tarfile.TarInfo('data.txt')
        info.size = len(payload)
        tar.addfile(info, data)


def _write_tar_plain(dest, payload=b'A' * 1024):
    """An uncompressed .tar — flipping a content byte stays listable but changes
    the sha256, so it isolates the checksum spot-check from the readability one."""
    import io
    with tarfile.open(dest, 'w') as tar:
        data = io.BytesIO(payload)
        info = tarfile.TarInfo('data.bin')
        info.size = len(payload)
        tar.addfile(info, data)


# --------------------------------------------------------------------------- #
# Manifest shape (#5)
# --------------------------------------------------------------------------- #

def test_manifest_shape(app, tmp_path):
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('files', 9101,
                                                          target_meta={'paths': ['/x']})
        run_dir = tmp_path / 'run1'
        run_dir.mkdir()
        primary = str(run_dir / 'files.tar.gz')
        _write_tar_gz(primary)
        # a second artifact to prove the manifest lists everything
        (run_dir / 'notes.txt').write_text('side file')

        run, meta = _mk_run(policy.id, str(run_dir), primary)
        manifest = bv.write_manifest(run, meta)

        assert manifest['version'] == bv.MANIFEST_VERSION
        assert manifest['primary_archive'] == 'files.tar.gz'
        assert manifest['primary_sha256'] and len(manifest['primary_sha256']) == 64
        names = {a['name'] for a in manifest['artifacts']}
        assert names == {'files.tar.gz', 'notes.txt'}
        for art in manifest['artifacts']:
            assert art['sha256'] and len(art['sha256']) == 64
            assert art['size'] >= 0
        assert manifest['totals']['count'] == 2
        assert manifest['chain'] == {'incremental': False, 'full_run_id': None}
        # sha256 is denormalized onto the run row.
        assert run.checksum_sha256 == manifest['primary_sha256']
        # manifest.json actually lands next to the archives.
        assert os.path.exists(run_dir / bv.MANIFEST_NAME)


# --------------------------------------------------------------------------- #
# Good archive -> hashed (#5)
# --------------------------------------------------------------------------- #

def test_verify_promotes_good_archive_to_hashed(app, tmp_path):
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('files', 9102,
                                                          target_meta={'paths': ['/x']})
        run_dir = tmp_path / 'run2'
        run_dir.mkdir()
        primary = str(run_dir / 'files.tar.gz')
        _write_tar_gz(primary)
        run, meta = _mk_run(policy.id, str(run_dir), primary)
        bv.write_manifest(run, meta)

        probes = bv.verify_run_tier1(run, meta)
        assert run.verify_level == 'hashed'
        assert run.verify_error is None
        assert run.verified_at is not None
        assert probes['hashed'] is True
        assert probes['listed'][0]['ok'] is True


# --------------------------------------------------------------------------- #
# Corrupted archive -> verify_error, not 'hashed' (#5)
# --------------------------------------------------------------------------- #

def test_corrupted_archive_flags_checksum_mismatch(app, tmp_path):
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('files', 9103,
                                                          target_meta={'paths': ['/x']})
        run_dir = tmp_path / 'run3'
        run_dir.mkdir()
        primary = str(run_dir / 'files.tar')  # uncompressed: stays listable
        _write_tar_plain(primary)
        run, meta = _mk_run(policy.id, str(run_dir), primary)
        bv.write_manifest(run, meta)  # records the good sha256

        # Flip a byte inside the file-content region (offset well past the header).
        with open(primary, 'r+b') as f:
            f.seek(512 + 256)
            b = f.read(1)
            f.seek(512 + 256)
            f.write(bytes([b[0] ^ 0xFF]))

        probes = bv.verify_run_tier1(run, meta)
        # The archive is still readable (listing ok) but the hash no longer matches.
        assert run.verify_level == 'listed'
        assert run.verify_error and 'mismatch' in run.verify_error.lower()
        assert probes['hashed'] is False


def test_unreadable_archive_flags_verify_error(app, tmp_path):
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('files', 9104,
                                                          target_meta={'paths': ['/x']})
        run_dir = tmp_path / 'run4'
        run_dir.mkdir()
        primary = str(run_dir / 'files.tar.gz')
        # Not a real gzip/tar at all -> listing must fail.
        with open(primary, 'wb') as f:
            f.write(b'this is not a tar archive at all')
        run, meta = _mk_run(policy.id, str(run_dir), primary)
        bv.write_manifest(run, meta)

        bv.verify_run_tier1(run, meta)
        assert run.verify_level == 'none'
        assert run.verify_error and 'readable' in run.verify_error.lower()


# --------------------------------------------------------------------------- #
# Incremental chain metadata intact (#5)
# --------------------------------------------------------------------------- #

def test_incremental_chain_metadata_intact(app, tmp_path):
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('application', 9105)
        run_dir = tmp_path / 'incr'
        run_dir.mkdir()
        primary = str(run_dir / 'files.tar.gz')
        _write_tar_gz(primary)
        run, meta = _mk_run(policy.id, str(run_dir), primary, kind='incremental',
                            meta_extra={'incremental': True, 'full_run_id': 4242})
        manifest = bv.write_manifest(run, meta)
        assert manifest['chain'] == {'incremental': True, 'full_run_id': 4242}
        assert manifest['kind'] == 'incremental'


# --------------------------------------------------------------------------- #
# Legacy-run serialization compatibility (#5)
# --------------------------------------------------------------------------- #

def test_legacy_run_serialization_maps_forward(app):
    from app.models.backup_run import BackupRun
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('files', 9106,
                                                          target_meta={'paths': ['/x']})
        # A pre-plan-23 run: verify_level defaulted to 'none' but it had a
        # remote-verified copy — must read forward as 'listed', not 'none'.
        legacy = BackupRun(policy_id=policy.id, kind='full', status='success',
                           verified=True)
        db.session.add(legacy)
        db.session.commit()
        assert legacy.verify_level == 'none'           # stored value untouched
        assert legacy.effective_verify_level() == 'listed'
        assert legacy.to_dict()['verify_level'] == 'listed'

        # A run explicitly hashed serializes as hashed.
        fresh = BackupRun(policy_id=policy.id, kind='full', status='success',
                          verify_level='hashed')
        db.session.add(fresh)
        db.session.commit()
        assert fresh.to_dict()['verify_level'] == 'hashed'

        # A never-verified local-only run stays 'none'.
        plain = BackupRun(policy_id=policy.id, kind='full', status='success')
        db.session.add(plain)
        db.session.commit()
        assert plain.to_dict()['verify_level'] == 'none'
