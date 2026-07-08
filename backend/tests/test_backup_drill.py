"""Plan 23 Phase 2 — restore-drill engine proving tests.

End-to-end files drill on tmp dirs (real archive, cross-platform), a database
drill against a stubbed engine (asserts create -> restore -> probe -> drop call
order), the no-space skip path, teardown/record-on-exception, and single-flight
refusal."""
import io
import os
import tarfile
from datetime import datetime

import pytest

from app import db
from app.services.backup_policy_service import BackupPolicyService
from app.services.backup_drill_service import BackupDrillService, BackupDrillError
from app.services import backup_verify_service as bv


class _FakeJob:
    def __init__(self, payload, jid='job-drill-1'):
        self.id = jid
        self._payload = payload

    def get_payload(self):
        return self._payload


def _write_tar_gz_tree(dest, files):
    with tarfile.open(dest, 'w:gz') as tar:
        for name, content in files.items():
            data = io.BytesIO(content)
            info = tarfile.TarInfo(name)
            info.size = len(content)
            tar.addfile(info, data)


def _make_files_run(policy, tmp_path, name='run', files=None):
    """A successful files BackupRun with a real .tar.gz + manifest on disk."""
    from app.models.backup_run import BackupRun
    run_dir = tmp_path / name
    run_dir.mkdir()
    primary = str(run_dir / 'files.tar.gz')
    _write_tar_gz_tree(primary, files if files is not None else {'a.txt': b'alpha', 'b.txt': b'beta'})
    run = BackupRun(policy_id=policy.id, kind='full', status='success',
                    storage_path=str(run_dir), started_at=datetime.utcnow())
    meta = {'engine': 'files', 'kind': 'full', 'primary_archive': primary,
            'incremental': False}
    run.set_metadata(meta)
    db.session.add(run)
    db.session.commit()
    bv.write_manifest(run, meta)
    run.set_metadata(meta)
    db.session.commit()
    return run


# --------------------------------------------------------------------------- #
# End-to-end files drill (#9)
# --------------------------------------------------------------------------- #

def test_files_drill_success_promotes_run_and_stamps_policy(app, tmp_path, monkeypatch):
    from app.services.backup_service import BackupService
    from app.models.backup_run import BackupRun
    from app.models.backup_policy import BackupPolicy
    monkeypatch.setattr(BackupService, 'BACKUP_BASE_DIR', str(tmp_path / 'backups'))
    os.makedirs(BackupService.BACKUP_BASE_DIR, exist_ok=True)

    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'files', 8201, target_meta={'paths': ['/etc/x'], 'label': 'configs'})
        run = _make_files_run(policy, tmp_path)

        BackupDrillService.run_restore_drill(_FakeJob(
            {'policy_id': policy.id, 'run_id': run.id, 'trigger': 'manual'}))

        from app.models.restore_drill import RestoreDrill
        drill = RestoreDrill.query.filter_by(policy_id=policy.id).first()
        assert drill.status == 'success'
        assert drill.get_probes()['file_count'] == 2
        assert drill.get_probes()['sampled_ok'] == drill.get_probes()['sampled']

        # The drilled run is promoted; the policy cache is stamped.
        assert BackupRun.query.get(run.id).verify_level == 'drilled'
        pol = BackupPolicy.query.get(policy.id)
        assert pol.last_drill_status == 'success'
        assert pol.last_drill_at is not None

        # Scratch is torn down on success.
        scratch = os.path.join(BackupService.BACKUP_BASE_DIR, 'restores', f'drill-{drill.id}')
        assert not os.path.exists(scratch)


# --------------------------------------------------------------------------- #
# Database drill call order against a stubbed engine (#9)
# --------------------------------------------------------------------------- #

def test_database_drill_create_restore_probe_drop_order(app, tmp_path, monkeypatch):
    from app.services.backup_service import BackupService
    from app.services import database_service as dbsvc
    from app.models.backup_run import BackupRun
    from app.models.backup_policy import BackupPolicy
    monkeypatch.setattr(BackupService, 'BACKUP_BASE_DIR', str(tmp_path / 'backups'))

    calls = []
    monkeypatch.setattr(dbsvc.DatabaseService, 'mysql_create_database',
                        staticmethod(lambda name, **kw: calls.append(('create', name)) or {'success': True}))
    monkeypatch.setattr(dbsvc.DatabaseService, 'mysql_get_tables',
                        staticmethod(lambda name, **kw: calls.append(('tables', name)) or ['wp_posts', 'wp_users']))
    monkeypatch.setattr(dbsvc.DatabaseService, 'mysql_drop_database',
                        staticmethod(lambda name, **kw: calls.append(('drop', name)) or {'success': True}))
    monkeypatch.setattr(BackupService, 'restore_database',
                        staticmethod(lambda **kw: calls.append(('restore', kw['db_name'])) or {'success': True}))

    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'database', 8202, target_subtype='mysql', target_meta={'db_name': 'shop'})
        dump = tmp_path / 'shop.sql.gz'
        dump.write_bytes(b'dummy')
        run = BackupRun(policy_id=policy.id, kind='full', status='success',
                        storage_path=str(dump))
        run.set_metadata({'engine': 'database', 'primary_archive': str(dump),
                          'db_type': 'mysql', 'db_name': 'shop'})
        db.session.add(run)
        db.session.commit()

        scratch_name = f'skdrill_{run.id}'
        BackupDrillService.run_restore_drill(_FakeJob(
            {'policy_id': policy.id, 'run_id': run.id, 'trigger': 'scheduled'}))

        kinds = [c[0] for c in calls]
        assert kinds == ['create', 'restore', 'tables', 'drop']
        # All operate on the scratch DB, never the live 'shop'.
        assert all(c[1] == scratch_name for c in calls)
        from app.models.restore_drill import RestoreDrill
        drill = RestoreDrill.query.filter_by(policy_id=policy.id).first()
        assert drill.status == 'success'
        assert drill.get_probes()['table_count'] == 2


def test_database_drill_drops_scratch_even_on_restore_failure(app, tmp_path, monkeypatch):
    from app.services.backup_service import BackupService
    from app.services import database_service as dbsvc
    from app.models.backup_run import BackupRun
    monkeypatch.setattr(BackupService, 'BACKUP_BASE_DIR', str(tmp_path / 'backups'))

    calls = []
    monkeypatch.setattr(dbsvc.DatabaseService, 'mysql_create_database',
                        staticmethod(lambda name, **kw: calls.append(('create', name)) or {'success': True}))
    monkeypatch.setattr(dbsvc.DatabaseService, 'mysql_drop_database',
                        staticmethod(lambda name, **kw: calls.append(('drop', name)) or {'success': True}))
    monkeypatch.setattr(BackupService, 'restore_database',
                        staticmethod(lambda **kw: {'success': False, 'error': 'boom'}))

    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'database', 8203, target_subtype='mysql', target_meta={'db_name': 'shop'})
        dump = tmp_path / 'shop2.sql.gz'
        dump.write_bytes(b'dummy')
        run = BackupRun(policy_id=policy.id, kind='full', status='success',
                        storage_path=str(dump))
        run.set_metadata({'engine': 'database', 'primary_archive': str(dump),
                          'db_type': 'mysql', 'db_name': 'shop'})
        db.session.add(run)
        db.session.commit()

        scratch_name = f'skdrill_{run.id}'
        with pytest.raises(Exception):
            BackupDrillService.run_restore_drill(_FakeJob(
                {'policy_id': policy.id, 'run_id': run.id}))

        # Scratch DB was created then dropped despite the restore failing.
        assert ('create', scratch_name) in calls
        assert ('drop', scratch_name) in calls
        from app.models.restore_drill import RestoreDrill
        drill = RestoreDrill.query.filter_by(policy_id=policy.id).first()
        assert drill.status == 'failed'
        assert 'boom' in (drill.error or '')


# --------------------------------------------------------------------------- #
# No-space skip (#9)
# --------------------------------------------------------------------------- #

def test_drill_skipped_no_space(app, tmp_path, monkeypatch):
    from app.services.backup_service import BackupService
    from app.models.backup_policy import BackupPolicy
    monkeypatch.setattr(BackupService, 'BACKUP_BASE_DIR', str(tmp_path / 'backups'))
    os.makedirs(BackupService.BACKUP_BASE_DIR, exist_ok=True)
    # Huge requirement, tiny free space -> loud skip, never a silent pass.
    monkeypatch.setattr(BackupDrillService, '_estimate_required', classmethod(lambda cls, r, m: 10 ** 12))
    monkeypatch.setattr(BackupDrillService, '_free_bytes', staticmethod(lambda p: 1024))

    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('files', 8204,
                                                          target_meta={'paths': ['/x']})
        run = _make_files_run(policy, tmp_path)
        result = BackupDrillService.run_restore_drill(_FakeJob(
            {'policy_id': policy.id, 'run_id': run.id}))

        assert result['status'] == 'skipped_no_space'
        from app.models.restore_drill import RestoreDrill
        drill = RestoreDrill.query.filter_by(policy_id=policy.id).first()
        assert drill.status == 'skipped_no_space'
        assert BackupPolicy.query.get(policy.id).last_drill_status == 'skipped_no_space'


# --------------------------------------------------------------------------- #
# Teardown / record on exception (#9)
# --------------------------------------------------------------------------- #

def test_drill_records_failure_on_empty_extract(app, tmp_path, monkeypatch):
    from app.services.backup_service import BackupService
    from app.models.backup_run import BackupRun
    monkeypatch.setattr(BackupService, 'BACKUP_BASE_DIR', str(tmp_path / 'backups'))
    os.makedirs(BackupService.BACKUP_BASE_DIR, exist_ok=True)

    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('files', 8205,
                                                          target_meta={'paths': ['/x']})
        # An empty archive -> the drill must fail loudly (0 files restored).
        run = _make_files_run(policy, tmp_path, files={})
        with pytest.raises(Exception):
            BackupDrillService.run_restore_drill(_FakeJob(
                {'policy_id': policy.id, 'run_id': run.id}))

        from app.models.restore_drill import RestoreDrill
        drill = RestoreDrill.query.filter_by(policy_id=policy.id).first()
        assert drill.status == 'failed'
        assert drill.error
        # The run is NOT promoted to drilled on a failed drill.
        assert BackupRun.query.get(run.id).verify_level != 'drilled'


# --------------------------------------------------------------------------- #
# Single-flight refusal (#9)
# --------------------------------------------------------------------------- #

def test_single_flight_refusal(app, tmp_path):
    from app.models.restore_drill import RestoreDrill
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy('files', 8206,
                                                          target_meta={'paths': ['/x']})
        _make_files_run(policy, tmp_path)
        # A running drill already exists -> request is refused.
        db.session.add(RestoreDrill(policy_id=policy.id, status='running',
                                    started_at=datetime.utcnow()))
        db.session.commit()
        assert BackupDrillService.is_drilling() is True
        with pytest.raises(BackupDrillError):
            BackupDrillService.request_drill(policy)
