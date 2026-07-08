"""Plan 23 Phase 3 — cadence sweep, badge serialization, doctor check matrix."""
from datetime import datetime, timedelta

from app import db
from app.services.backup_policy_service import BackupPolicyService
from app.services.backup_drill_service import BackupDrillService


def _policy_with_run(target_id, cadence='weekly', enabled=True, last_drill_at=None,
                     last_drill_status=None):
    from app.models.backup_run import BackupRun
    policy = BackupPolicyService.get_or_create_policy('files', target_id,
                                                      target_meta={'paths': ['/x']})
    policy.enabled = enabled
    policy.drill_cadence = cadence
    policy.last_drill_at = last_drill_at
    policy.last_drill_status = last_drill_status
    db.session.add(BackupRun(policy_id=policy.id, kind='full', status='success',
                             started_at=datetime.utcnow()))
    db.session.commit()
    return policy


# --------------------------------------------------------------------------- #
# Cadence due-selection (#13)
# --------------------------------------------------------------------------- #

def test_is_due_matrix(app):
    with app.app_context():
        now = datetime.utcnow()
        # never drilled + cadenced + enabled -> due
        p_never = _policy_with_run(7301, cadence='weekly', last_drill_at=None)
        assert BackupDrillService.is_due(p_never, now) is True

        # drilled recently -> not due
        p_fresh = _policy_with_run(7302, cadence='weekly',
                                   last_drill_at=now - timedelta(days=1))
        assert BackupDrillService.is_due(p_fresh, now) is False

        # drilled long ago (> weekly interval incl. jitter) -> due
        p_old = _policy_with_run(7303, cadence='weekly',
                                 last_drill_at=now - timedelta(days=30))
        assert BackupDrillService.is_due(p_old, now) is True

        # cadence off -> never due
        p_off = _policy_with_run(7304, cadence='off', last_drill_at=None)
        assert BackupDrillService.is_due(p_off, now) is False

        # disabled -> never due
        p_dis = _policy_with_run(7305, cadence='weekly', enabled=False, last_drill_at=None)
        assert BackupDrillService.is_due(p_dis, now) is False


def test_due_policies_and_sweep_enqueues(app, monkeypatch):
    enqueued = []
    monkeypatch.setattr(BackupDrillService, 'request_drill',
                        classmethod(lambda cls, policy, trigger='scheduled':
                                    enqueued.append(policy.id) or type('J', (), {'id': f'j{policy.id}'})()))
    monkeypatch.setattr(BackupDrillService, 'is_drilling', classmethod(lambda cls: False))
    with app.app_context():
        due_policy = _policy_with_run(7311, cadence='weekly', last_drill_at=None)  # due
        fresh_policy = _policy_with_run(7312, cadence='weekly',
                                        last_drill_at=datetime.utcnow() - timedelta(hours=1))  # fresh
        off_policy = _policy_with_run(7313, cadence='off', last_drill_at=None)   # off
        due = {p.id for p in BackupDrillService.due_policies()}
        assert due_policy.id in due
        assert fresh_policy.id not in due and off_policy.id not in due

        result = BackupDrillService.run_drill_sweep()
        assert due_policy.id in enqueued
        assert result['count'] == len(enqueued)


def test_sweep_defers_when_a_drill_is_in_flight(app, monkeypatch):
    monkeypatch.setattr(BackupDrillService, 'is_drilling', classmethod(lambda cls: True))
    called = []
    monkeypatch.setattr(BackupDrillService, 'request_drill',
                        classmethod(lambda cls, policy, trigger='scheduled': called.append(policy.id)))
    with app.app_context():
        _policy_with_run(7321, cadence='weekly', last_drill_at=None)
        result = BackupDrillService.run_drill_sweep()
        assert result['count'] == 0
        assert called == []  # deferred — nothing enqueued while one is running


# --------------------------------------------------------------------------- #
# Badge serialization states (#13)
# --------------------------------------------------------------------------- #

def test_badge_states(app):
    with app.app_context():
        now = datetime.utcnow()
        never = _policy_with_run(7331, cadence='weekly', last_drill_at=None)
        assert BackupPolicyService._restore_proof_view(never)['badge'] == 'never'

        ok = _policy_with_run(7332, cadence='weekly', last_drill_status='success',
                              last_drill_at=now - timedelta(days=1))
        assert BackupPolicyService._restore_proof_view(ok)['badge'] == 'ok'

        stale = _policy_with_run(7333, cadence='weekly', last_drill_status='success',
                                 last_drill_at=now - timedelta(days=60))
        assert BackupPolicyService._restore_proof_view(stale)['badge'] == 'stale'

        failed = _policy_with_run(7334, cadence='weekly', last_drill_status='failed',
                                  last_drill_at=now - timedelta(days=1))
        assert BackupPolicyService._restore_proof_view(failed)['badge'] == 'failed'


def test_serialize_policy_view_includes_restore_proof(app):
    with app.app_context():
        policy = _policy_with_run(7341, cadence='monthly', last_drill_status='success',
                                  last_drill_at=datetime.utcnow())
        view = BackupPolicyService.serialize_policy_view(policy)
        assert 'restore_proof' in view
        proof = view['restore_proof']
        assert proof['drill_cadence'] == 'monthly'
        assert proof['badge'] == 'ok'
        assert 'recent_drills' in proof


# --------------------------------------------------------------------------- #
# Doctor check matrix (#13)
# --------------------------------------------------------------------------- #

def test_doctor_backup_proof_matrix(app):
    from app.services.doctor_service import DoctorService
    with app.app_context():
        now = datetime.utcnow()
        _policy_with_run(7351, cadence='weekly', last_drill_status='success',
                         last_drill_at=now - timedelta(days=1))          # fresh -> ok
        _policy_with_run(7352, cadence='weekly', last_drill_status='success',
                         last_drill_at=now - timedelta(days=60))         # stale -> warn
        _policy_with_run(7353, cadence='weekly', last_drill_status='failed',
                         last_drill_at=now - timedelta(days=1))          # failed -> fail
        _policy_with_run(7354, cadence='off', last_drill_at=None)        # no cadence -> no drill check

        checks = DoctorService._backup_proof_checks()
        by_key = {c['key']: c for c in checks}

        # Locate the drill checks by policy.
        from app.models.backup_policy import BackupPolicy
        pid = {tid: BackupPolicy.query.filter_by(target_type='files', target_id=tid).first().id
               for tid in (7351, 7352, 7353, 7354)}
        assert by_key[f'backup_drill_stale.{pid[7351]}']['status'] == 'ok'
        assert by_key[f'backup_drill_stale.{pid[7352]}']['status'] == 'warn'
        assert by_key[f'backup_drill_stale.{pid[7353]}']['status'] == 'fail'
        assert by_key[f'backup_drill_stale.{pid[7353]}']['repairable'] is True
        # A no-cadence policy has no drill-stale check.
        assert f'backup_drill_stale.{pid[7354]}' not in by_key

        # Every policy with a successful run gets an unverified check; the runs
        # here were created verify_level='none' -> warn + repairable.
        assert by_key[f'backup_unverified.{pid[7351]}']['status'] == 'warn'
        assert by_key[f'backup_unverified.{pid[7351]}']['repair_ref']['kind'] == 'backup_verify'
