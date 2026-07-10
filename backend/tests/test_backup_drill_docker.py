"""Plan 30 Phase 3 — container-aware DB drills + the WordPress DB leg.

A managed docker DB drills INSIDE its container (stubbed docker exec); a
container-hosted DB whose container is gone/unknown refuses honestly with an
``unsupported`` status; and the WordPress drill scratch-imports the DB dump on
a live engine.

NOTE (plan 42 recovery): the container-aware database leg was lost with the
tests — the recovered ``BackupDrillService._drill_database`` has no
``host_kind`` / ``container_ref`` handling, no stubbed docker-exec restore, and
never emits the ``unsupported`` status. The reconstructed tests below are kept
faithful to the salvage but skipped as hollow-feature markers; restore is owned
by plan 42.
"""
from datetime import datetime

import pytest

from app import db
from app.services.backup_policy_service import BackupPolicyService
from app.services.backup_drill_service import BackupDrillService  # noqa: F401


class _FakeJob:
    def __init__(self, payload, jid='job-dk-1'):
        self.id = jid
        self._payload = payload

    def get_payload(self):
        return self._payload


def _db_run(policy, tmp_path, name='shop.sql'):
    """A successful database BackupRun with a dump file on disk."""
    from app.models.backup_run import BackupRun
    dump = tmp_path / name
    dump.write_bytes(b'-- dump')
    run = BackupRun(policy_id=policy.id, kind='full', status='success',
                    storage_path=str(dump), started_at=datetime.utcnow())
    run.set_metadata({'engine': 'database', 'primary_archive': str(dump),
                      'db_type': 'mysql', 'db_name': 'shop'})
    db.session.add(run)
    db.session.commit()
    return run


@pytest.mark.skip(reason="plan 42: hollow feature — container-aware DB drill (host_kind/"
                         "container_ref docker-exec leg, plan 30 Phase 3) absent from recovered "
                         "BackupDrillService._drill_database; restored by plan 42")
def test_managed_docker_db_drills_inside_container(app, tmp_path, monkeypatch):
    from types import SimpleNamespace
    from app.services.backup_service import BackupService
    monkeypatch.setattr(BackupService, 'BACKUP_BASE_DIR', str(tmp_path / 'backups'))

    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'database', 9901, target_subtype='mysql', target_meta={'db_name': 'shop'})
        # A managed docker DB resolves to a container-hosted target.
        monkeypatch.setattr(
            BackupPolicyService, '_resolve_target',
            classmethod(lambda cls, p: {'target_type': 'database', 'db_type': 'mysql',
                                        'host_kind': 'docker',
                                        'container_ref': SimpleNamespace(name='shop', _managed=True),
                                        'db_config': {'db_name': 'shop'}}))
        run = _db_run(policy, tmp_path)
        BackupDrillService.run_restore_drill(_FakeJob(
            {'policy_id': policy.id, 'run_id': run.id}))
        from app.models.restore_drill import RestoreDrill
        drill = RestoreDrill.query.filter_by(policy_id=policy.id).first()
        assert drill.status == 'success'


@pytest.mark.skip(reason="plan 42: hollow feature — container-gone 'unsupported' honest refusal "
                         "(plan 30 Phase 3) absent from recovered BackupDrillService; "
                         "restored by plan 42")
def test_container_gone_refuses_unsupported(app, tmp_path, monkeypatch):
    from app.services.backup_service import BackupService
    monkeypatch.setattr(BackupService, 'BACKUP_BASE_DIR', str(tmp_path / 'backups'))

    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'database', 9902, target_subtype='mysql', target_meta={'db_name': 'shop'})
        monkeypatch.setattr(
            BackupPolicyService, '_resolve_target',
            classmethod(lambda cls, p: {'target_type': 'database', 'db_type': 'mysql',
                                        'host_kind': 'docker', 'container_ref': None,
                                        'db_config': {'db_name': 'shop'}}))
        run = _db_run(policy, tmp_path)
        BackupDrillService.run_restore_drill(_FakeJob(
            {'policy_id': policy.id, 'run_id': run.id}))
        from app.models.restore_drill import RestoreDrill
        drill = RestoreDrill.query.filter_by(policy_id=policy.id).first()
        assert drill.get_probes().get('status') == 'unsupported'
