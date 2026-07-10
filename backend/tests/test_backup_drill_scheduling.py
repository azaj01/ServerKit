"""Plan 30 Phase 4 — enqueue-time single-flight, WP drill persona symmetry,
per-destination offsite sampling."""
from datetime import datetime

import pytest

from app import db
from app.services.backup_policy_service import BackupPolicyService
from app.services.backup_drill_service import BackupDrillService, DRILL_JOB_KIND
from app.services.backup_offsite_service import BackupOffsiteService


def _files_run(policy):
    from app.models.backup_run import BackupRun
    run = BackupRun(policy_id=policy.id, kind='full', status='success',
                    storage_path='/tmp/x', started_at=datetime.utcnow())
    db.session.add(run)
    db.session.commit()
    return run


@pytest.mark.skip(reason="plan 42: hollow feature — BackupDrillService.request_drill "
                         "enqueue-time single-flight (_pending_drill_job dedup, plan 30 "
                         "Phase 4 / #8) not present in recovered tree; restored by plan 42")
def test_concurrent_requests_yield_one_drill_job(app):
    from app.jobs.models import Job
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'files', 9601, target_meta={'paths': ['/x']})
        _files_run(policy)
        first = BackupDrillService.request_drill(policy)

        second = BackupDrillService.request_drill(policy)
        assert first.id == second.id
        pending = Job.query.filter(
            Job.kind == DRILL_JOB_KIND,
            Job.owner_id == str(policy.id),
        ).count()
        assert pending == 1


def test_sampling_picks_one_run_per_destination(app):
    from app.models.backup_run import BackupRun
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'files', 9602, target_meta={'paths': ['/x']})
        runs = []
        for i, dest in enumerate(['bucket-a', 'bucket-a', 'bucket-b']):
            r = BackupRun(policy_id=policy.id, kind='full', status='success',
                          started_at=datetime.utcnow())
            r.set_metadata({'offsite': {'destination': dest}})
            db.session.add(r)
            db.session.commit()
            runs.append(r)

        picks = BackupOffsiteService._sample_per_destination(runs, seed=7)
        dests = sorted(BackupOffsiteService._destination_of(p) for p in picks)

        assert dests == ['bucket-a', 'bucket-b']


def test_sampling_is_deterministic(app):
    from app.models.backup_run import BackupRun
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'files', 9603, target_meta={'paths': ['/x']})
        runs = []
        for _ in range(4):
            r = BackupRun(policy_id=policy.id, kind='full', status='success',
                          started_at=datetime.utcnow())
            r.set_metadata({'offsite': {'destination': 'bucket-a'}})
            db.session.add(r)
            db.session.commit()
            runs.append(r)

        a = [p.id for p in BackupOffsiteService._sample_per_destination(runs, seed=42)]
        b = [p.id for p in BackupOffsiteService._sample_per_destination(runs, seed=42)]
        assert a == b and len(a) == 1


def _mk_user(username):
    from app.models.user import User
    u = User(email=f'{username}@test.local', username=username, role='user')
    u.set_password('x')
    db.session.add(u)
    db.session.commit()
    return u


def _mk_wp_site(owner_id, name):
    from app.models.application import Application
    from app.models.wordpress_site import WordPressSite
    app_row = Application(name=name, app_type='wordpress', user_id=owner_id,
                          root_path='/srv/x')
    db.session.add(app_row)
    db.session.commit()
    site = WordPressSite(application_id=app_row.id, wp_version='6.4')
    db.session.add(site)
    db.session.commit()
    return site


@pytest.mark.skip(reason="plan 42: hollow feature — WP app-scoped drill route "
                         "POST /api/v1/wordpress/sites/<id>/backups/drill (plan 30 Phase 6 / "
                         "#6 permission symmetry) missing from serverkit-wordpress extension; "
                         "restored by plan 42")
def test_wp_drill_owner_reaches_gate_nonowner_404(app, client, auth_headers):
    from app.models.user import User
    with app.app_context():
        admin = User.query.filter_by(username='testadmin').first()
        owned_id = _mk_wp_site(admin.id, 'owned-site').id
        other = _mk_user('someoneelse')
        foreign_id = _mk_wp_site(other.id, 'foreign-site').id

    r = client.post(f'/api/v1/wordpress/sites/{owned_id}/backups/drill',
                    headers=auth_headers)
    assert r.status_code in (202, 409)

    r = client.post(f'/api/v1/wordpress/sites/{foreign_id}/backups/drill',
                    headers=auth_headers)
    assert r.status_code == 404
