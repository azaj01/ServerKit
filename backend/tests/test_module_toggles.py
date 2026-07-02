"""Module toggles (#14): hide/503 a core vertical on demand.

Email used to be a module toggle; it's now the serverkit-email extension (#32),
so WordPress is the remaining core module and drives these tests.
"""
from app.services import module_service


def test_modules_default_enabled(app, client, auth_headers):
    resp = client.get('/api/v1/modules', headers=auth_headers)
    assert resp.status_code == 200
    mods = {m['name']: m for m in resp.get_json()['modules']}
    assert mods['wordpress']['enabled'] is True
    # Email is no longer a module toggle (it's an extension now).
    assert 'email' not in mods


def test_toggle_requires_admin_body(app, client, auth_headers):
    resp = client.put('/api/v1/modules/wordpress', headers=auth_headers, json={})
    assert resp.status_code == 400


def test_unknown_module_404(app, client, auth_headers):
    resp = client.put('/api/v1/modules/nope', headers=auth_headers, json={'enabled': False})
    assert resp.status_code == 404


def test_wordpress_api_503s_when_module_disabled(app, client, auth_headers):
    # Enabled → the wordpress route is reachable (any status that isn't 503).
    resp = client.get('/api/v1/wordpress/sites', headers=auth_headers)
    assert resp.status_code != 503

    # Disable via the API, then the same route is guarded with 503.
    toggle = client.put('/api/v1/modules/wordpress', headers=auth_headers, json={'enabled': False})
    assert toggle.status_code == 200
    assert toggle.get_json()['enabled'] is False

    resp = client.get('/api/v1/wordpress/sites', headers=auth_headers)
    assert resp.status_code == 503
    assert resp.get_json()['module'] == 'wordpress'

    # Re-enable restores it.
    client.put('/api/v1/modules/wordpress', headers=auth_headers, json={'enabled': True})
    resp = client.get('/api/v1/wordpress/sites', headers=auth_headers)
    assert resp.status_code != 503


def test_is_module_enabled_fails_open(app):
    # Unknown module name is treated as enabled (never hide a core feature).
    assert module_service.is_module_enabled('does-not-exist') is True
