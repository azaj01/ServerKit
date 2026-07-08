"""Offsite verification hardening (plan 23 Phase 4).

For remote-copy policies, prove the offsite object actually matches — not just
"the upload call returned":

  * **weekly shallow** (`backup.offsite.verify`) — HEAD + size + single-part
    ETag/MD5 compare for the newest run of every remote-copy policy, recording
    an honest evidence label (``checksum`` where a single-part ETag confirms
    content, ``size_only`` where a multipart ETag can only confirm size).
  * **monthly deep** — ONE deterministically sampled run per destination gets a
    full download-and-hash against the STORED sha256 (Decision 3 — never a hash
    recomputed from the same possibly-corrupt local file). Egress-bounded to one
    object/month and the downloaded bytes are reported raw (Decision 8).

Everything here is best-effort: a verification failure is recorded on the run's
offsite evidence + surfaced to the drawer, never raised out of the sweep.
"""
import logging
import os
import random
import shutil
from datetime import datetime

from app import db

logger = logging.getLogger(__name__)

OFFSITE_VERIFY_JOB_KIND = 'backup.offsite.verify'
OFFSITE_VERIFY_SCHEDULE_NAME = 'backup-offsite-verify'


class BackupOffsiteService:

    # ------------------------------------------------------------------ #
    # Candidate selection
    # ------------------------------------------------------------------ #

    @classmethod
    def _remote_copy_policies(cls):
        from app.models.backup_policy import BackupPolicy
        return BackupPolicy.query.filter_by(remote_copy=True).all()

    @classmethod
    def _newest_remote_run(cls, policy):
        from app.models.backup_run import BackupRun
        return (BackupRun.query
                .filter(BackupRun.policy_id == policy.id,
                        BackupRun.status == 'success',
                        BackupRun.remote_key.isnot(None))
                .order_by(BackupRun.started_at.desc()).first())

    @staticmethod
    def _is_deep_week(now):
        """Monthly cadence on a weekly schedule: deep-check on ~1 week in 4."""
        return (now.isocalendar()[1] % 4) == 0

    @classmethod
    def _sample_one(cls, runs, seed):
        """Deterministically pick one run (seeded — reproducible for a given
        seed, so the monthly egress is bounded AND testable)."""
        if not runs:
            return None
        ordered = sorted(runs, key=lambda r: r.id)
        return ordered[random.Random(seed).randrange(len(ordered))]

    @staticmethod
    def _destination_of(run):
        """A stable key for the destination a run's offsite copy lives in. Today
        every run shares one configured provider (one group), but the day a
        second bucket/provider lands (plan 36) each destination samples on its
        own — so a full backup is never left unproven because a different
        destination happened to win the single-sample lottery."""
        meta = run.get_metadata() or {}
        dest = (meta.get('offsite') or {}).get('destination')
        if dest:
            return str(dest)
        try:
            from app.services.backup_cost_service import BackupCostService
            prov = BackupCostService.configured_remote_provider()
            if prov is not None:
                return str(getattr(prov, 'name', None) or getattr(prov, 'id', None) or prov)
        except Exception:  # noqa: BLE001
            pass
        return 'default'

    @classmethod
    def _sample_per_destination(cls, runs, seed):
        """One deterministically sampled run per distinct destination (plan 30
        #10 / Decision 7). A no-op vs the old one-run-total behaviour while
        storage is single-provider; correct the day a second destination exists."""
        groups = {}
        for r in runs:
            groups.setdefault(cls._destination_of(r), []).append(r)
        picks = []
        for dest in sorted(groups.keys()):
            pick = cls._sample_one(groups[dest], f'{seed}:{dest}')
            if pick is not None:
                picks.append(pick)
        return picks

    # ------------------------------------------------------------------ #
    # Verify handlers
    # ------------------------------------------------------------------ #

    @classmethod
    def run_offsite_verify(cls, job=None):
        payload = (job.get_payload() if job else None) or {}
        now = datetime.utcnow()
        deep = payload.get('deep')
        if deep is None:
            deep = cls._is_deep_week(now)
        seed = payload.get('seed', now.isocalendar()[1])

        results = {'shallow': [], 'deep': []}
        candidates = []
        for policy in cls._remote_copy_policies():
            run = cls._newest_remote_run(policy)
            if not run:
                continue
            candidates.append(run)
            ev = cls._shallow_verify(policy, run)
            results['shallow'].append({'policy_id': policy.id, 'run_id': run.id,
                                       'evidence': ev.get('evidence'),
                                       'verified': ev.get('verified')})

        if deep and candidates:
            for pick in cls._sample_per_destination(candidates, seed):
                deep_res = cls._deep_verify(pick)
                results['deep'].append({'run_id': pick.id, **deep_res})
                # A deep mismatch is a verification failure — alert on transition.
                try:
                    from app.models.backup_policy import BackupPolicy
                    from app.services.backup_alert_service import BackupAlertService
                    pol = BackupPolicy.query.get(pick.policy_id)
                    if pol:
                        BackupAlertService.on_verify_result(pol, pick)
                except Exception as exc:  # noqa: BLE001
                    logger.debug('offsite verify alert skipped: %s', exc)

        db.session.commit()
        logger.info('offsite verify: %s shallow, %s deep',
                    len(results['shallow']), len(results['deep']))
        return results

    @classmethod
    def _shallow_verify(cls, policy, run):
        """HEAD + size + single-part content compare via verify_run, which records
        the honest evidence label ('checksum' | 'size_only') on the run."""
        from app.services.backup_policy_service import BackupPolicyService, BackupPolicyError
        try:
            res = BackupPolicyService.verify_run(policy, run.id)
            return {'verified': res.get('verified'), 'evidence': res.get('evidence')}
        except BackupPolicyError as exc:
            return {'verified': False, 'evidence': 'error', 'error': str(exc)}
        except Exception as exc:  # noqa: BLE001
            logger.warning('shallow offsite verify failed for run %s: %s', run.id, exc)
            return {'verified': False, 'evidence': 'error', 'error': str(exc)}

    @classmethod
    def _deep_verify(cls, run):
        """Download the remote object and hash it against the STORED sha256 — the
        only check that can promote a multipart ``size_only`` run to real content
        proof. Egress-bounded (one object) and the bytes are reported raw."""
        from app.services.storage_provider_service import StorageProviderService
        from app.services.backup_service import BackupService
        from app.services.backup_verify_service import sha256_file

        meta = run.get_metadata() or {}
        offsite = dict(meta.get('offsite') or {})
        stored = offsite.get('our_sha256') or run.checksum_sha256
        remote_key = run.remote_key
        if not remote_key:
            return {'ok': False, 'reason': 'no remote key'}
        if not stored:
            offsite['deep_evidence'] = 'no_stored_hash'
            meta['offsite'] = offsite
            run.set_metadata(meta)
            return {'ok': False, 'reason': 'no stored sha256 to compare against'}

        tmp_dir = os.path.join(BackupService.BACKUP_BASE_DIR, 'restores', 'offsite-verify')
        os.makedirs(tmp_dir, exist_ok=True)
        tmp_path = os.path.join(tmp_dir, f'deep-{run.id}.bin')
        bytes_downloaded = 0
        try:
            dl = StorageProviderService.download_file(remote_key, tmp_path)
            if not dl.get('success'):
                offsite['deep_evidence'] = 'download_failed'
                offsite['deep_error'] = dl.get('error')
                meta['offsite'] = offsite
                run.set_metadata(meta)
                return {'ok': False, 'reason': dl.get('error')}
            bytes_downloaded = dl.get('size') or (os.path.getsize(tmp_path)
                                                  if os.path.exists(tmp_path) else 0)
            actual = sha256_file(tmp_path)
            match = bool(actual and actual == stored)
            offsite['deep_evidence'] = 'deep_sha256'
            offsite['deep_match'] = match
            offsite['deep_bytes'] = bytes_downloaded
            offsite['deep_checked_at'] = datetime.utcnow().isoformat() + 'Z'
            if match:
                # A confirmed offsite content match is at least as strong as a
                # single-part checksum — the run's remote copy is proven.
                run.verified = True
                offsite['evidence'] = 'checksum'
            meta['offsite'] = offsite
            run.set_metadata(meta)
            return {'ok': match, 'bytes': bytes_downloaded, 'evidence': 'deep_sha256'}
        except Exception as exc:  # noqa: BLE001
            logger.warning('deep offsite verify failed for run %s: %s', run.id, exc)
            offsite['deep_evidence'] = 'error'
            offsite['deep_error'] = str(exc)[:300]
            meta['offsite'] = offsite
            run.set_metadata(meta)
            return {'ok': False, 'reason': str(exc)}
        finally:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass
            # keep the dir tidy
            try:
                if os.path.isdir(tmp_dir) and not os.listdir(tmp_dir):
                    shutil.rmtree(tmp_dir, ignore_errors=True)
            except OSError:
                pass

    # ------------------------------------------------------------------ #
    # Registration
    # ------------------------------------------------------------------ #

    @classmethod
    def register_jobs(cls):
        from app.jobs import registry
        registry.register(OFFSITE_VERIFY_JOB_KIND, cls.run_offsite_verify, replace=True)
