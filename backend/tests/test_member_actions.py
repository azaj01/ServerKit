"""Proving tests for the member-action escape hatch (plan 19 Phase 5 / plan 29
#13). Exercises the feature flag, the tier authorization (via the reconstructed
can_operate_app/can_admin_app helpers), and the validate→authorize→execute→audit
pipeline of member_action_service.
"""
from werkzeug.security import generate_password_hash

from app import db
from app.models import Application, User
from app.services import member_action_service as ma
from app.services.resource_grant_service import ResourceGrantService as RGS


def _user(username, role='developer'):
    u = User(email=f'{username}@t.local', username=username,
             password_hash=generate_password_hash('x'), role=role, is_active=True)
    db.session.add(u)
    db.session.commit()
    return u


def _app(owner, name):
    a = Application(name=name, app_type='php', user_id=owner.id)
    db.session.add(a)
    db.session.commit()
    return a


def test_enabled_by_default_and_lists_template(app):
    assert ma.is_enabled() is True
    actions = ma.list_actions()
    ids = {a['id'] for a in actions}
    assert 'set-backup-frequency' in ids
    # Client-safe view never leaks the executor callable.
    assert all('executor' not in a for a in actions)


def test_two_kill_switches_disable_the_surface(app):
    from app.models.system_settings import SystemSettings
    from app import db as _db
    owner = _user('ma_off_owner')
    a = _app(owner, 'ma-off-app')

    # System-setting switch off (admin-stored boolean).
    SystemSettings.set('security_member_actions_enabled', False, value_type='boolean')
    _db.session.commit()
    assert ma.is_enabled() is False
    assert ma.list_actions() == []
    result, err = ma.run(owner, a, 'set-backup-frequency', {'frequency': 'daily'})
    assert result is None and err == ('Member actions are disabled', 403)

    # Back on via the system setting, off via the deployment config flag.
    SystemSettings.set('security_member_actions_enabled', True, value_type='boolean')
    _db.session.commit()
    assert ma.is_enabled() is True
    app.config['MEMBER_ACTIONS_ENABLED'] = False
    try:
        assert ma.is_enabled() is False
    finally:
        app.config['MEMBER_ACTIONS_ENABLED'] = True


def test_unknown_action_is_404(app):
    owner = _user('ma_unk_owner')
    a = _app(owner, 'ma-unk-app')
    result, err = ma.run(owner, a, 'no-such-action', {})
    assert result is None and err == ('Unknown action', 404)


def test_stranger_is_denied(app):
    owner = _user('ma_str_owner')
    stranger = _user('ma_stranger')
    a = _app(owner, 'ma-str-app')
    result, err = ma.run(stranger, a, 'set-backup-frequency', {'frequency': 'daily'})
    assert result is None and err == ('Access denied', 403)


def test_viewer_grant_cannot_run_member_action(app):
    owner = _user('ma_v_owner')
    viewer = _user('ma_viewer')
    a = _app(owner, 'ma-v-app')
    RGS.grant(viewer.id, 'application', a.id, granted_by=owner.id, role='viewer')
    # A viewer is below the 'member' min_role of the template.
    assert not RGS.can_operate_app(viewer, a)
    result, err = ma.run(viewer, a, 'set-backup-frequency', {'frequency': 'daily'})
    assert result is None and err == ('Access denied', 403)


def test_bad_params_are_rejected(app):
    owner = _user('ma_bad_owner')
    a = _app(owner, 'ma-bad-app')
    # Enum violation -> 400 (never reaches the executor).
    result, err = ma.run(owner, a, 'set-backup-frequency', {'frequency': 'hourly'})
    assert result is None
    assert err[1] == 400


def test_editor_runs_action_end_to_end(app):
    owner = _user('ma_e_owner')
    editor = _user('ma_editor')
    a = _app(owner, 'ma-e-app')
    RGS.grant(editor.id, 'application', a.id, granted_by=owner.id, role='editor')
    assert RGS.can_operate_app(editor, a)

    result, err = ma.run(editor, a, 'set-backup-frequency', {'frequency': 'weekly'})
    assert err is None
    assert result['action'] == 'set-backup-frequency'
    assert result['result']['frequency'] == 'weekly'
    assert result['result']['enabled'] is True
