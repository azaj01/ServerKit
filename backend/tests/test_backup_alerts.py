"""Plan 23 Phase 5 — edge-triggered restore-proof alerts + support-bundle section."""
from datetime import datetime

from app import db
from app.services.backup_policy_service import BackupPolicyService
from app.services.backup_alert_service import BackupAlertService


def _capture_notify(monkeypatch):
    import app.plugins_sdk as sdk
    sent = []
    monkeypatch.setattr(sdk.notify, 'send',
                        lambda event, to=None, data=None, **kw: sent.append((event, data)))
    return sent


def _policy(target_id):
    return BackupPolicyService.get_or_create_policy('files', target_id,
                                                    target_meta={'paths': ['/x']})


# --------------------------------------------------------------------------- #
# Drill alerts — fire once on transition (#17)
# --------------------------------------------------------------------------- #

def test_drill_failed_fires_once_then_throttles(app, monkeypatch):
    with app.app_context():
        sent = _capture_notify(monkeypatch)
        policy = _policy(5501)
        BackupAlertService.on_drill_result(policy, 'failed', 'boom')
        assert [e for e, _ in sent] == ['backup.drill_failed']
        # A second consecutive failure does NOT re-alert.
        BackupAlertService.on_drill_result(policy, 'failed', 'boom again')
        assert [e for e, _ in sent] == ['backup.drill_failed']


def test_drill_recovery_fires_after_failure(app, monkeypatch):
    with app.app_context():
        sent = _capture_notify(monkeypatch)
        policy = _policy(5502)
        BackupAlertService.on_drill_result(policy, 'failed', 'boom')
        BackupAlertService.on_drill_result(policy, 'success', None)
        assert [e for e, _ in sent] == ['backup.drill_failed', 'backup.drill_recovered']
        # Staying healthy doesn't repeat the recovery notice.
        BackupAlertService.on_drill_result(policy, 'success', None)
        assert [e for e, _ in sent] == ['backup.drill_failed', 'backup.drill_recovered']


def test_first_success_is_silent(app, monkeypatch):
    with app.app_context():
        sent = _capture_notify(monkeypatch)
        policy = _policy(5503)
        # A healthy-from-the-start policy never had a failure -> no recovery spam.
        BackupAlertService.on_drill_result(policy, 'success', None)
        assert sent == []


def test_skipped_no_space_counts_as_failure(app, monkeypatch):
    with app.app_context():
        sent = _capture_notify(monkeypatch)
        policy = _policy(5504)
        BackupAlertService.on_drill_result(policy, 'skipped_no_space', 'no space')
        assert [e for e, _ in sent] == ['backup.drill_failed']


# --------------------------------------------------------------------------- #
# Verify alerts (#17)
# --------------------------------------------------------------------------- #

def test_verify_failed_and_recovered(app, monkeypatch):
    from app.models.backup_run import BackupRun
    with app.app_context():
        sent = _capture_notify(monkeypatch)
        policy = _policy(5505)
        bad = BackupRun(policy_id=policy.id, kind='full', status='success',
                        verify_level='listed', verify_error='Checksum mismatch')
        db.session.add(bad)
        db.session.commit()
        BackupAlertService.on_verify_result(policy, bad)
        assert [e for e, _ in sent] == ['backup.verify_failed']

        good = BackupRun(policy_id=policy.id, kind='full', status='success',
                         verify_level='hashed')
        db.session.add(good)
        db.session.commit()
        BackupAlertService.on_verify_result(policy, good)
        assert [e for e, _ in sent] == ['backup.verify_failed', 'backup.verify_recovered']


def test_verify_failed_on_deep_offsite_mismatch(app, monkeypatch):
    from app.models.backup_run import BackupRun
    with app.app_context():
        sent = _capture_notify(monkeypatch)
        policy = _policy(5506)
        run = BackupRun(policy_id=policy.id, kind='full', status='success',
                        verify_level='hashed')
        run.set_metadata({'offsite': {'evidence': 'size_only', 'deep_match': False}})
        db.session.add(run)
        db.session.commit()
        BackupAlertService.on_verify_result(policy, run)
        assert [e for e, _ in sent] == ['backup.verify_failed']


# --------------------------------------------------------------------------- #
# Catalog registration (#17)
# --------------------------------------------------------------------------- #

def test_catalog_has_restore_proof_events():
    from app.notifications import catalog
    for key in ('backup.drill_failed', 'backup.drill_recovered',
                'backup.verify_failed', 'backup.verify_recovered'):
        entry = catalog.get(key)
        assert entry is not None
        assert entry['category'] == 'backups'


# --------------------------------------------------------------------------- #
# Support bundle restore_confidence section (#18)
# --------------------------------------------------------------------------- #

def test_support_bundle_restore_confidence(app):
    from app.services.support_bundle_service import _collect_restore_confidence
    from app.models.backup_run import BackupRun
    with app.app_context():
        policy = _policy(5507)
        policy.drill_cadence = 'weekly'
        policy.last_drill_status = 'success'
        policy.last_drill_at = datetime.utcnow()
        run = BackupRun(policy_id=policy.id, kind='full', status='success',
                        verify_level='drilled')
        run.set_metadata({'offsite': {'evidence': 'checksum', 'deep_evidence': 'deep_sha256'}})
        db.session.add(run)
        db.session.commit()

        section = _collect_restore_confidence()
        assert section['total'] >= 1
        entry = next(p for p in section['policies']
                     if p['target_type'] == 'files' and p['target_id'] == 5507)
        assert entry['drill_cadence'] == 'weekly'
        assert entry['latest_verify_level'] == 'drilled'
        assert entry['last_drill_status'] == 'success'
        assert entry['offsite_evidence'] == 'checksum'
        # No paths / secrets leak into the section.
        assert 'storage_path' not in entry and 'remote_key' not in entry
