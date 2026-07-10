"""Proving matrix for the per-app capability tiers (plan 29 / plan 19).

Locks the four-rung access family down against the single tier seam in
``rbac.app_access_tier`` ('viewer' < 'member' < 'admin' < 'owner'):

    can_access_app  — read (owner/admin/any grant)
    can_operate_app — member+ (owner, panel admin, editor grant, ws member+)
    can_edit_app    — editor grant (or owner/admin)
    can_admin_app   — admin+ (owner, panel admin, ws admin/owner)

``can_operate_app`` / ``can_admin_app`` were lost in the recovery and are
reconstructed here (a surviving caller, member_action_service, depends on them).
"""
from werkzeug.security import generate_password_hash

from app import db
from app.models import Application, User
from app.models.workspace import Workspace, WorkspaceMember
from app.middleware.rbac import app_access_tier, _APP_ROLE_RANK
from app.services.resource_grant_service import ResourceGrantService as RGS


def _user(username, role='developer'):
    u = User(email=f'{username}@t.local', username=username,
             password_hash=generate_password_hash('x'), role=role, is_active=True)
    db.session.add(u)
    db.session.commit()
    return u


def _app(owner, name, workspace_id=None):
    a = Application(name=name, app_type='php', user_id=owner.id, workspace_id=workspace_id)
    db.session.add(a)
    db.session.commit()
    return a


def _workspace(slug):
    ws = Workspace(name=slug, slug=slug)
    db.session.add(ws)
    db.session.commit()
    return ws


def _member(ws, user, role):
    db.session.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=role))
    db.session.commit()


# --------------------------------------------------------------------------- #
# Grant-based personas
# --------------------------------------------------------------------------- #

def test_owner_reaches_every_tier(app):
    owner = _user('s_owner')
    a = _app(owner, 's-owner-app')
    assert app_access_tier(owner, a) == 'owner'
    assert RGS.can_access_app(owner, a)
    assert RGS.can_operate_app(owner, a)
    assert RGS.can_edit_app(owner, a)
    assert RGS.can_admin_app(owner, a)


def test_panel_admin_reaches_every_tier(app):
    owner = _user('s_o2')
    admin = _user('s_admin', role='admin')
    a = _app(owner, 's-admin-app')
    assert admin.is_admin
    assert app_access_tier(admin, a) == 'owner'
    assert RGS.can_operate_app(admin, a)
    assert RGS.can_admin_app(admin, a)


def test_editor_grant_operates_but_not_admins(app):
    owner = _user('s_o3')
    editor = _user('s_editor')
    a = _app(owner, 's-editor-app')
    RGS.grant(editor.id, 'application', a.id, granted_by=owner.id, role='editor')
    assert app_access_tier(editor, a) == 'member'
    assert RGS.can_access_app(editor, a)
    assert RGS.can_operate_app(editor, a)
    assert RGS.can_edit_app(editor, a)
    assert not RGS.can_admin_app(editor, a)


def test_viewer_grant_is_read_only(app):
    owner = _user('s_o4')
    viewer = _user('s_viewer')
    a = _app(owner, 's-viewer-app')
    RGS.grant(viewer.id, 'application', a.id, granted_by=owner.id, role='viewer')
    assert app_access_tier(viewer, a) == 'viewer'
    assert RGS.can_access_app(viewer, a)
    assert not RGS.can_operate_app(viewer, a)
    assert not RGS.can_edit_app(viewer, a)
    assert not RGS.can_admin_app(viewer, a)


def test_stranger_reaches_nothing(app):
    owner = _user('s_o5')
    stranger = _user('s_stranger')
    a = _app(owner, 's-stranger-app')
    assert app_access_tier(stranger, a) is None
    assert not RGS.can_access_app(stranger, a)
    assert not RGS.can_operate_app(stranger, a)
    assert not RGS.can_edit_app(stranger, a)
    assert not RGS.can_admin_app(stranger, a)


# --------------------------------------------------------------------------- #
# Workspace-membership personas (widen operate/admin, not grants)
# --------------------------------------------------------------------------- #

def test_workspace_member_can_operate_not_admin(app):
    owner = _user('w_owner')
    ws = _workspace('ws-ops')
    member = _user('w_member')
    _member(ws, member, WorkspaceMember.ROLE_MEMBER)
    a = _app(owner, 'w-ops-app', workspace_id=ws.id)
    assert app_access_tier(member, a) == 'member'
    assert RGS.can_operate_app(member, a)
    assert not RGS.can_admin_app(member, a)


def test_workspace_admin_can_admin(app):
    owner = _user('w_owner2')
    ws = _workspace('ws-adm')
    wsadmin = _user('w_admin')
    _member(ws, wsadmin, WorkspaceMember.ROLE_ADMIN)
    a = _app(owner, 'w-adm-app', workspace_id=ws.id)
    assert app_access_tier(wsadmin, a) == 'admin'
    assert RGS.can_operate_app(wsadmin, a)
    assert RGS.can_admin_app(wsadmin, a)


def test_tier_rank_ordering_is_consistent(app):
    assert (_APP_ROLE_RANK['viewer'] < _APP_ROLE_RANK['member']
            < _APP_ROLE_RANK['admin'] < _APP_ROLE_RANK['owner'])
