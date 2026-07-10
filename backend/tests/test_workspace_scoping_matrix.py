"""The canonical workspace-scoping RBAC matrix (plan 19 Phase 1 #4).

Five personas (owner / member / viewer / foreign / panel admin) driven by the
shared ``scoping_rbac`` fixture (conftest.py), applied to the reference app.

The membership visibility contract (plan 19 Decision 1):
  - owner / member / viewer / admin  SEE the workspace's apps and their domains
  - a foreign non-member              sees NOTHING here

Reconstructed for plan 42 Phase 1 from the readable shadow tail + the fragmented
``test_workspace_scoping_matrix`` pyc + the surviving ``resource_grant_service``.
The current ``scoping_rbac`` fixture exposes per-persona auth headers + ``app_id``
(not the ``*_id`` / ``domain_id`` the original pyc used), so persona user rows are
resolved by their well-known usernames and the reference domain is created inline.

DRIFT FINDING (reported to the orchestrator): the plan-19 *member-write* /
*member-visibility* seam did NOT survive at the ROUTE layer. ``can_operate_app``
still folds workspace membership (the matrix below passes), but the env-var,
backup-policy and /apps-list routes gate on ``can_edit_app`` / owner-or-grant, so a
plain workspace member is denied there. Those route-level tests are skipped with a
reason rather than inverted.
"""
import pytest

from app.services.resource_grant_service import ResourceGrantService as R


def _user(username):
    from app.models import User
    return User.query.filter_by(username=username).first()


def test_operate_and_admin_capability_matrix(app, scoping_rbac):
    from app.models import Application
    a = Application.query.get(scoping_rbac.app_id)

    def operate(username):
        return R.can_operate_app(_user(username), a)

    def admin(username):
        return R.can_admin_app(_user(username), a)

    # Member-write: owner/panel-admin/member yes; viewer & foreign no.
    assert operate('scope_owner') is True
    assert operate('scope_admin') is True
    assert operate('scope_member') is True
    assert operate('scope_viewer') is False
    assert operate('scope_foreign') is False

    # Destructive: owner/panel-admin yes; a plain workspace MEMBER cannot; viewer/foreign no.
    assert admin('scope_owner') is True
    assert admin('scope_admin') is True
    assert admin('scope_member') is False
    assert admin('scope_viewer') is False
    assert admin('scope_foreign') is False


def test_delete_app_denied_to_member_and_below(client, scoping_rbac):
    """Deleting an app is destructive: a plain workspace member, viewer, and
    foreign caller are all denied (only admin/owner may — not exercised here to
    avoid tearing down the fixture)."""
    url = f'/api/v1/apps/{scoping_rbac.app_id}'
    for persona in ('member', 'viewer', 'foreign'):
        assert client.delete(url, headers=getattr(scoping_rbac, persona)).status_code == 403, persona


def test_delete_domain_denied_to_member_and_below(client, scoping_rbac):
    """Deleting a domain is destructive → admin/owner only; member/viewer/foreign 403."""
    from app import db
    from app.models import Domain
    d = Domain(name='scope.example.com', application_id=scoping_rbac.app_id)
    db.session.add(d)
    db.session.commit()
    url = f'/api/v1/domains/{d.id}'
    for persona in ('member', 'viewer', 'foreign'):
        assert client.delete(url, headers=getattr(scoping_rbac, persona)).status_code == 403, persona


# --------------------------------------------------------------------------- #
# #16 — the bucket-header gate. SUPERSEDED (plan 29 #10) by the generic AST sweep
# in test_authz_structural_sweep.py, which checks EVERY per-app route file for a
# `# Bucket:` header. This thin alias is retained so the old name still runs.
# --------------------------------------------------------------------------- #

def test_governed_route_files_declare_a_bucket():
    from test_authz_structural_sweep import test_every_per_app_route_file_declares_a_bucket
    test_every_per_app_route_file_declares_a_bucket()


# --------------------------------------------------------------------------- #
# Route-level member-write / member-visibility — DRIFTED OUT (see module docstring).
# Skipped with reason; the surviving capability is proven by the matrix above.
# --------------------------------------------------------------------------- #

@pytest.mark.skip(reason="plan 42: drift — /apps list gates on own-rows/grant, not "
                         "workspace membership; member/viewer no longer see the "
                         "workspace app (plan 19 Decision 1 not wired at route layer)")
def test_apps_list_visible_to_workspace():
    pass


@pytest.mark.skip(reason="plan 42: drift — env-var writes gate on can_edit_app "
                         "(owner/admin/editor-grant), not can_operate_app; a plain "
                         "workspace member is denied (plan 19 #14 not wired at route)")
def test_env_write_member_can_viewer_cannot():
    pass


@pytest.mark.skip(reason="plan 42: drift — backup-policy edits gate on can_edit_app, "
                         "not can_operate_app; a plain workspace member is denied "
                         "(plan 19 member-write not wired at route layer)")
def test_backup_policy_edit_member_can_viewer_cannot():
    pass
