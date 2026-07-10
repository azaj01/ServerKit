"""Plan 29 Phase 4 (#11) — git-webhook READ reclassification.

Webhook/deploy reads move off panel-wide @viewer_required onto the linked app's
workspace visibility (can_access_app on the webhook's app_id). A foreign-workspace
viewer loses visibility of an app-linked webhook; a workspace member keeps it.
Webhooks with no app linkage stay panel-wide viewer-visible. Mutations stay
admin-only (explicitly re-deferred) and are not touched here.
"""
import pytest


def _mk_webhook(db, name, app_id=None):
    from app.models import GitWebhook
    w = GitWebhook(
        name=name, source='github',
        source_repo_url='https://example.com/r.git',
        secret='s', webhook_token=f'tok-{name}',
        app_id=app_id,
    )
    db.session.add(w)
    db.session.commit()
    return w


@pytest.fixture
def webhook_rbac(app, scoping_rbac):
    """One app-linked webhook (on scoping_rbac's app) + one unlinked webhook."""
    from types import SimpleNamespace
    from app import db
    linked = _mk_webhook(db, 'linked', app_id=scoping_rbac.app_id)
    unlinked = _mk_webhook(db, 'unlinked', app_id=None)
    return SimpleNamespace(linked_id=linked.id, unlinked_id=unlinked.id, s=scoping_rbac)


def test_webhook_get_scoped_to_app_visibility(client, webhook_rbac):
    """The app-linked webhook is reachable by owner/member/viewer/admin of its
    workspace, but a foreign caller gets a 404 (sealed-from-open, no leak)."""
    s = webhook_rbac.s
    url = f'/api/v1/git/webhooks/{webhook_rbac.linked_id}'
    for persona in ('owner', 'member', 'viewer', 'admin'):
        assert client.get(url, headers=getattr(s, persona)).status_code == 200, persona
    assert client.get(url, headers=s.foreign).status_code == 404


def test_webhook_logs_scoped_to_app_visibility(client, webhook_rbac):
    """Webhook logs follow the same app-visibility seam as the webhook itself."""
    s = webhook_rbac.s
    url = f'/api/v1/git/webhooks/{webhook_rbac.linked_id}/logs'
    assert client.get(url, headers=s.member).status_code == 200
    assert client.get(url, headers=s.foreign).status_code == 404


def test_webhook_list_filters_to_visible(client, webhook_rbac):
    """The collection lists only webhooks the caller can see: a member sees the
    app-linked + unlinked ones; a foreign caller sees only the unlinked one."""
    s = webhook_rbac.s

    member_ids = {w['id'] for w in client.get('/api/v1/git/webhooks', headers=s.member).get_json()['webhooks']}
    assert webhook_rbac.linked_id in member_ids
    assert webhook_rbac.unlinked_id in member_ids

    foreign_ids = {w['id'] for w in client.get('/api/v1/git/webhooks', headers=s.foreign).get_json()['webhooks']}
    assert webhook_rbac.linked_id not in foreign_ids   # lost visibility of the app-linked hook
    assert webhook_rbac.unlinked_id in foreign_ids       # unlinked stays panel-wide visible


def test_webhook_unlinked_visible_to_all(client, webhook_rbac):
    """A webhook with no app linkage is a panel-wide resource — any authenticated
    viewer (even a foreign one) can read it directly."""
    s = webhook_rbac.s
    url = f'/api/v1/git/webhooks/{webhook_rbac.unlinked_id}'
    assert client.get(url, headers=s.foreign).status_code == 200


def test_webhook_mutations_stay_admin_only(client, webhook_rbac):
    """Deferred by design: mutations remain admin-only. A member (who can now READ
    the linked webhook) still cannot delete or toggle it."""
    s = webhook_rbac.s
    wid = webhook_rbac.linked_id
    assert client.delete(f'/api/v1/git/webhooks/{wid}', headers=s.member).status_code == 403
    assert client.post(f'/api/v1/git/webhooks/{wid}/toggle', headers=s.member).status_code == 403
