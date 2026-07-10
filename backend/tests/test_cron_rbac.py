"""Cron ownership + workspace-visibility RBAC (plan 21 Phase 3, #12).

Uses the shared `scoping_rbac` fixture (five personas over one workspace + app).
Cron jobs live in a JSON store, so `cron_store` isolates it to a tmp file and
forces the non-Linux (metadata-only) path so no real crontab is touched.
"""
import pytest

from app.services.cron_service import CronService


@pytest.fixture
def cron_store(tmp_path, monkeypatch):
    import app.services.cron_service as mod
    monkeypatch.setattr(mod, 'JOBS_FILE', str(tmp_path / 'cron_jobs.json'))
    monkeypatch.setattr(CronService, 'is_linux', classmethod(lambda cls: False))
    return mod


def _mk_job(app_id, name='App Cron'):
    res = CronService.add_job('0 0 * * *', '/usr/bin/app-task.sh', name=name,
                              application_id=app_id)
    assert res['success']
    return res['job_id']


# --------------------------------------------------------------------------- #
# for-app visibility gate
# --------------------------------------------------------------------------- #

def test_member_sees_for_app_jobs(client, scoping_rbac, cron_store):
    _mk_job(scoping_rbac.app_id)
    r = client.get(f'/api/v1/cron/jobs/for-app/{scoping_rbac.app_id}',
                   headers=scoping_rbac.member)
    assert r.status_code == 200
    body = r.get_json()
    assert body['count'] == 1
    job = body['jobs'][0]
    assert job['name'] == 'App Cron'
    assert job['schedule_human']
    # Member-facing surface never leaks the raw host command.
    assert 'command' not in job


def test_viewer_sees_read_only(client, scoping_rbac, cron_store):
    _mk_job(scoping_rbac.app_id)
    r = client.get(f'/api/v1/cron/jobs/for-app/{scoping_rbac.app_id}',
                   headers=scoping_rbac.viewer)
    assert r.status_code == 200
    assert r.get_json()['count'] == 1


def test_owner_and_admin_see_for_app_jobs(client, scoping_rbac, cron_store):
    _mk_job(scoping_rbac.app_id)
    for hdr in (scoping_rbac.owner, scoping_rbac.admin):
        r = client.get(f'/api/v1/cron/jobs/for-app/{scoping_rbac.app_id}', headers=hdr)
        assert r.status_code == 200
        assert r.get_json()['count'] == 1


def test_foreign_member_forbidden(client, scoping_rbac, cron_store):
    _mk_job(scoping_rbac.app_id)
    r = client.get(f'/api/v1/cron/jobs/for-app/{scoping_rbac.app_id}',
                   headers=scoping_rbac.foreign)
    assert r.status_code == 403


def test_for_app_missing_app_404(client, scoping_rbac, cron_store):
    r = client.get('/api/v1/cron/jobs/for-app/999999', headers=scoping_rbac.admin)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# admin /cron surface: attribution + create validation
# --------------------------------------------------------------------------- #

def test_admin_list_carries_attribution(client, scoping_rbac, cron_store):
    _mk_job(scoping_rbac.app_id)
    r = client.get('/api/v1/cron/jobs', headers=scoping_rbac.admin)
    assert r.status_code == 200
    jobs = r.get_json()['jobs']
    attributed = [j for j in jobs if j.get('app')]
    assert attributed
    j = attributed[0]
    assert j['app']['id'] == scoping_rbac.app_id
    assert j['workspace']['id'] == scoping_rbac.ws_id


def test_create_rejects_unknown_application(client, scoping_rbac, cron_store):
    r = client.post('/api/v1/cron/jobs', headers=scoping_rbac.admin, json={
        'name': 'X', 'command': '/usr/bin/x.sh', 'schedule': '0 0 * * *',
        'application_id': 987654,
    })
    assert r.status_code == 400
    assert 'not found' in r.get_json()['error'].lower()


def test_member_cannot_create_job(client, scoping_rbac, cron_store):
    # Creating stays admin (Decision 2) — a workspace member is not an admin.
    r = client.post('/api/v1/cron/jobs', headers=scoping_rbac.member, json={
        'name': 'X', 'command': '/usr/bin/x.sh', 'schedule': '0 0 * * *',
    })
    assert r.status_code in (401, 403)


# --------------------------------------------------------------------------- #
# association lifecycle
# --------------------------------------------------------------------------- #

def test_association_survives_app_rename(client, scoping_rbac, cron_store):
    from app import db
    from app.models import Application
    _mk_job(scoping_rbac.app_id)

    app = Application.query.get(scoping_rbac.app_id)
    app.name = 'renamed-app'
    db.session.commit()

    r = client.get('/api/v1/cron/jobs', headers=scoping_rbac.admin)
    attributed = [j for j in r.get_json()['jobs'] if j.get('app')]
    assert attributed and attributed[0]['app']['name'] == 'renamed-app'


def test_app_deletion_falls_back_to_system_bucket(client, scoping_rbac, cron_store):
    from app import db
    from app.models import Application
    job_id = _mk_job(scoping_rbac.app_id)

    app = Application.query.get(scoping_rbac.app_id)
    db.session.delete(app)   # fires the before_delete association-clear
    db.session.commit()

    # Job is NOT deleted; it just loses its association (System bucket).
    assert CronService.jobs_for_application(scoping_rbac.app_id) == []
    meta = CronService._load_jobs_metadata()
    assert job_id in meta['jobs']
    assert meta['jobs'][job_id]['application_id'] is None
