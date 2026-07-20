"""Panel-core coverage that used to live at the bottom of
backend/tests/test_tramo_extension.py.

When serverkit-tramo moved to its own standalone repo its extension tests moved
with it, but these four exercise CORE behavior (the retired /api/v1/workflows
blueprint, the plan-45 event emitters ported to EventService, and the
docker_service double-emit fix) — so they stay in the panel.
"""
from types import SimpleNamespace

from app import db
from app.models.user import User


def _mk_admin():
    from werkzeug.security import generate_password_hash
    u = User(email='tramoadmin@t.local', username='tramoadmin',
             password_hash=generate_password_hash('x'),
             role=User.ROLE_ADMIN, is_active=True)
    db.session.add(u)
    db.session.commit()
    return u


def _wildcard_sub(app):
    from app.models.event_subscription import EventSubscription
    admin = _mk_admin()
    sub = EventSubscription(user_id=admin.id, name='cap', url='http://x/y', is_active=True)
    sub.set_events(['*'])
    db.session.add(sub)
    db.session.commit()
    return sub


def test_old_workflows_routes_are_gone(client, auth_headers):
    # The /api/v1/workflows blueprint was removed in Phase 4.
    r = client.get('/api/v1/workflows', headers=auth_headers)
    assert r.status_code == 404
    # The execute route no longer has a POST handler; the SPA catch-all is
    # GET-only, so an unmatched POST is 404/405 -- either proves it is gone.
    r2 = client.post('/api/v1/workflows/1/execute', headers=auth_headers, json={})
    assert r2.status_code in (404, 405)


def test_event_catalog_has_ported_types():
    from app.services.event_service import EVENT_CATALOG
    types = {e['type'] for e in EVENT_CATALOG}
    assert {'health.check_failed', 'git.push',
            'monitor.high_cpu', 'monitor.high_memory'} <= types


def test_ported_emitters_reach_event_service(app, monkeypatch):
    from app.services.event_service import EventService
    from app.models.event_subscription import EventDelivery
    _wildcard_sub(app)
    enqueued = []
    monkeypatch.setattr('app.services.event_service.enqueue_webhook_delivery',
                        lambda did: enqueued.append(did))
    for evt in ('health.check_failed', 'git.push', 'monitor.high_cpu'):
        EventService.emit(evt, {'event': evt})
    delivered = {d.event_type for d in EventDelivery.query.all()}
    assert {'health.check_failed', 'git.push', 'monitor.high_cpu'} <= delivered
    assert len(enqueued) == 3


def test_app_stopped_not_double_emitted_by_docker_service(app, monkeypatch):
    """docker_service.stop_container no longer emits app.stopped itself."""
    from app.models.event_subscription import EventDelivery
    _wildcard_sub(app)
    from app.services.docker_service import DockerService
    monkeypatch.setattr('app.services.event_service.enqueue_webhook_delivery',
                        lambda did: None)
    monkeypatch.setattr(
        'app.services.docker_service.subprocess.run',
        lambda *a, **k: SimpleNamespace(returncode=0, stdout='', stderr=''))
    res = DockerService.stop_container('abc123')
    assert res['success'] is True
    # No app.stopped delivery came from the low-level stop helper.
    assert EventDelivery.query.filter_by(event_type='app.stopped').count() == 0
