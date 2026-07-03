"""Tests for the API-backed CLI verbs (#12/#13): break-glass token minting,
login-url, doctor/repair against a stubbed client, and the update guard."""
import os

import pytest
from click.testing import CliRunner

import cli as serverkit_cli


def _all_output(result):
    """stdout + stderr regardless of the installed click version."""
    out = result.output
    try:
        out += result.stderr
    except (ValueError, AttributeError):
        pass
    return out


def _make_admin(username='cliadmin', email='cliadmin@test.local', role='admin', active=True):
    from app import db
    from app.models import User

    user = User(email=email, username=username, role=role, is_active=active)
    user.set_password('cli-test-pass')
    db.session.add(user)
    db.session.commit()
    return user


# ── break-glass token ────────────────────────────────────────────────────────

def test_breakglass_token_mints_and_is_accepted(app, client):
    admin = _make_admin()
    from app.services.cli_api_client import mint_breakglass_token

    token, minted_user = mint_breakglass_token()
    assert minted_user.id == admin.id

    resp = client.get('/api/v1/system/version',
                      headers={'Authorization': f'Bearer {token}'})
    assert resp.status_code == 200
    assert 'version' in resp.get_json()

    from app.models import AuditLog
    rows = AuditLog.query.filter_by(action='cli.breakglass').all()
    assert len(rows) == 1
    assert rows[0].user_id == admin.id


def test_breakglass_requires_an_active_admin(app):
    from app.services.cli_api_client import CliApiError, mint_breakglass_token

    _make_admin(username='inactive', email='inactive@test.local', active=False)
    _make_admin(username='pleb', email='pleb@test.local', role='user')
    with pytest.raises(CliApiError):
        mint_breakglass_token()


# ── login-url ────────────────────────────────────────────────────────────────

def test_login_url_prints_a_redeemable_link(app, client):
    _make_admin()
    runner = CliRunner()
    result = runner.invoke(serverkit_cli.cli, ['login-url', '--ttl', '5'])
    assert result.exit_code == 0, _all_output(result)

    url_lines = [l for l in result.output.splitlines() if '/login?link=' in l]
    assert url_lines, _all_output(result)
    token = url_lines[0].split('link=', 1)[1].strip()
    assert token

    resp = client.post('/api/v1/auth/login-links/redeem', json={'token': token})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['access_token']
    assert body['user']['username'] == 'cliadmin'

    # single use: a second redeem must fail
    resp = client.post('/api/v1/auth/login-links/redeem', json={'token': token})
    assert resp.status_code == 401


def test_login_url_unknown_user_fails(app):
    _make_admin()
    runner = CliRunner()
    result = runner.invoke(serverkit_cli.cli, ['login-url', '--user', 'nobody@nowhere'])
    assert result.exit_code == 1
    assert 'not found' in _all_output(result)


# ── stubbed-API verbs ────────────────────────────────────────────────────────

class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, path):
        self.calls.append(('GET', path, None))
        return self.responses[path]

    def post(self, path, json_body=None):
        self.calls.append(('POST', path, json_body))
        return self.responses[path]


@pytest.fixture
def fake_api(monkeypatch):
    def _install(responses):
        fake = FakeClient(responses)
        monkeypatch.setattr(serverkit_cli, '_api_client', lambda with_token=True: fake)
        return fake
    return _install


def test_doctor_renders_report_table(fake_api):
    fake_api({
        '/doctor/run': {'report': {'checks': [
            {'key': 'nginx', 'title': 'Nginx config', 'status': 'ok',
             'detail': '', 'repairable': False},
            {'key': 'ssl', 'title': 'SSL cert', 'status': 'fail',
             'detail': 'certificate expired', 'repairable': True},
        ]}},
    })
    result = CliRunner().invoke(serverkit_cli.cli, ['doctor'])
    assert result.exit_code == 0, _all_output(result)
    assert 'Nginx config' in result.output
    assert 'SSL cert' in result.output
    assert 'certificate expired' in result.output


def test_doctor_repair_posts_all_repairable_items(fake_api):
    ref_a = {'kind': 'drift', 'type': 'nginx_vhost', 'id': 'a'}
    ref_b = {'kind': 'service', 'name': 'nginx'}
    fake = fake_api({
        '/doctor/run': {'report': {'checks': [
            {'key': 'ok-check', 'title': 'Fine', 'status': 'ok',
             'detail': '', 'repairable': True,
             'repair_ref': {'kind': 'service', 'name': 'docker'}},
            {'key': 'broken-a', 'title': 'Broken A', 'status': 'fail',
             'detail': '', 'repairable': True, 'repair_ref': ref_a},
            {'key': 'broken-b', 'title': 'Broken B', 'status': 'warn',
             'detail': '', 'repairable': True, 'repair_ref': ref_b},
            {'key': 'manual', 'title': 'Manual only', 'status': 'fail',
             'detail': '', 'repairable': False},
        ]}},
        '/doctor/repair': {'results': [
            {'item': ref_a, 'success': True},
            {'item': ref_b, 'success': True},
        ]},
    })
    result = CliRunner().invoke(serverkit_cli.cli, ['doctor', '--repair', '--yes'])
    assert result.exit_code == 0, _all_output(result)

    repair_calls = [c for c in fake.calls if c[1] == '/doctor/repair']
    assert repair_calls == [('POST', '/doctor/repair', {'items': [ref_a, ref_b]})]
    assert '2/2 repairs succeeded' in result.output


def test_repair_verb_posts_confirmed_drift_repair(fake_api):
    fake = fake_api({
        '/doctor/drift/nginx/12/repair': {'message': 'Repaired nginx 12'},
    })
    result = CliRunner().invoke(serverkit_cli.cli, ['repair', 'nginx', '12'])
    assert result.exit_code == 0, _all_output(result)
    assert fake.calls == [('POST', '/doctor/drift/nginx/12/repair', {'confirm': True})]
    assert 'Repaired nginx 12' in result.output


def test_services_list_and_restart(fake_api):
    fake = fake_api({
        '/processes/services': {'services': [
            {'name': 'nginx', 'status': 'running', 'pid': 123},
            {'name': 'mysql', 'status': 'stopped', 'pid': None},
        ]},
        '/processes/services/nginx': {'success': True, 'message': 'nginx restarted'},
    })
    result = CliRunner().invoke(serverkit_cli.cli, ['services', 'list'])
    assert result.exit_code == 0, _all_output(result)
    assert 'nginx' in result.output and 'stopped' in result.output

    result = CliRunner().invoke(serverkit_cli.cli, ['services', 'restart', 'nginx'])
    assert result.exit_code == 0, _all_output(result)
    assert ('POST', '/processes/services/nginx', {'action': 'restart'}) in fake.calls


def test_apps_list(fake_api):
    fake_api({
        '/apps': {'apps': [
            {'name': 'blog', 'app_type': 'wordpress', 'status': 'running'},
        ]},
    })
    result = CliRunner().invoke(serverkit_cli.cli, ['apps', 'list'])
    assert result.exit_code == 0, _all_output(result)
    assert 'blog' in result.output and 'wordpress' in result.output


# ── update guard ─────────────────────────────────────────────────────────────

def test_update_refuses_on_windows(monkeypatch):
    monkeypatch.setattr(os, 'name', 'nt')
    result = CliRunner().invoke(serverkit_cli.cli, ['update', '--yes'])
    assert result.exit_code == 1
    assert 'Linux-only' in _all_output(result)


# ── ApiClient error surface ──────────────────────────────────────────────────

def test_api_client_connection_refused_is_helpful():
    import requests

    class BoomSession:
        def request(self, *args, **kwargs):
            raise requests.exceptions.ConnectionError('boom')

    from app.services.cli_api_client import ApiClient, CliApiError

    client = ApiClient(token='t', session=BoomSession())
    with pytest.raises(CliApiError) as excinfo:
        client.get('/system/health')
    assert 'systemctl status serverkit' in str(excinfo.value)


def test_api_client_surfaces_json_errors():
    class Resp:
        status_code = 403

        def json(self):
            return {'error': 'Admin access required'}

    class Session:
        def request(self, *args, **kwargs):
            return Resp()

    from app.services.cli_api_client import ApiClient, CliApiError

    client = ApiClient(token='t', session=Session())
    with pytest.raises(CliApiError) as excinfo:
        client.post('/doctor/run')
    assert 'Admin access required' in str(excinfo.value)
