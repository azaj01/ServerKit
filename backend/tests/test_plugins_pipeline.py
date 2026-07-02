"""Baseline coverage for the plugin/extension install pipeline.

These behaviors already existed (builtin install, the contributions envelope,
the disable→503 guard, reinstall metadata refresh, zip-slip rejection) but were
untested. Phase 0 of docs/plans/12_EXTENSIONS_PLATFORM_PLAN.md locks them in
before later phases build on them.
"""
import json
import os

import pytest

from app import db
from app.models.plugin import InstalledPlugin
from app.services import plugin_service


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

@pytest.fixture
def plugin_dirs(tmp_path, monkeypatch):
    """Redirect the plugin service's on-disk targets into a temp tree so tests
    never touch the real repo's backend/app/plugins or frontend/src/plugins."""
    backend = tmp_path / 'backend_plugins'
    frontend = tmp_path / 'frontend_plugins'
    builtin = tmp_path / 'builtin_extensions'
    backend.mkdir()
    frontend.mkdir()
    builtin.mkdir()
    monkeypatch.setattr(plugin_service, 'BACKEND_PLUGINS_DIR', str(backend))
    monkeypatch.setattr(plugin_service, 'FRONTEND_PLUGINS_DIR', str(frontend))
    monkeypatch.setattr(plugin_service, 'BUILTIN_EXTENSIONS_DIR', str(builtin))
    return {'backend': backend, 'frontend': frontend, 'builtin': builtin}


def _write_builtin(builtin_dir, slug='serverkit-demo', version='1.0.0',
                   display_name='Demo Extension'):
    """Create a minimal frontend-only builtin extension on disk."""
    folder = builtin_dir / slug
    (folder / 'frontend').mkdir(parents=True)
    manifest = {
        'name': slug,
        'display_name': display_name,
        'version': version,
        'description': 'A demo builtin extension.',
        'author': 'ServerKit',
        'category': 'utility',
        'permissions': ['filesystem'],
        'contributions': {
            'nav': [{'id': 'demo', 'label': 'Demo', 'route': '/demo',
                     'category': 'system', 'icon': '<circle cx="12" cy="12" r="8"/>'}],
            'routes': [{'path': 'demo', 'component': 'DemoPage'}],
            'page_titles': {'/demo': 'Demo'},
            'command_palette': [{'label': 'Demo', 'path': '/demo',
                                 'category': 'Pages', 'keywords': 'demo'}],
        },
    }
    (folder / 'plugin.json').write_text(json.dumps(manifest), encoding='utf-8')
    (folder / 'frontend' / 'index.jsx').write_text(
        'export function DemoPage() { return null; }\n', encoding='utf-8')
    return folder, manifest


# --------------------------------------------------------------------------- #
# Zip-slip defense
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize('evil', [
    '../../etc/passwd',
    'a/../../b',
    '..\\..\\windows\\system32',
    'C:\\Windows\\system32',   # drive-qualified absolute path
])
def test_safe_extract_path_rejects_traversal(tmp_path, evil):
    with pytest.raises(ValueError):
        plugin_service._safe_extract_path(str(tmp_path), evil)


def test_safe_extract_path_allows_normal(tmp_path):
    out = plugin_service._safe_extract_path(str(tmp_path), 'sub/dir/file.py')
    assert out.startswith(str(tmp_path))


def test_safe_extract_path_neutralizes_leading_slash(tmp_path):
    # A rooted POSIX path is not an error — the leading slash is stripped so
    # the entry lands *inside* the destination rather than at the filesystem
    # root. The guarantee is containment, not rejection.
    out = plugin_service._safe_extract_path(str(tmp_path), '/etc/cron.d/x')
    assert out.startswith(str(tmp_path))
    assert out.endswith(os.path.join('etc', 'cron.d', 'x'))


# --------------------------------------------------------------------------- #
# Builtin install + reinstall metadata refresh
# --------------------------------------------------------------------------- #

def test_install_builtin_creates_active_plugin(app, plugin_dirs):
    _write_builtin(plugin_dirs['builtin'])

    listed = plugin_service.list_builtin_extensions()
    assert len(listed) == 1
    assert listed[0]['slug'] == 'serverkit-demo'
    assert listed[0]['status'] == 'not_installed'

    plugin = plugin_service.install_builtin_extension('serverkit-demo')
    assert plugin.status == InstalledPlugin.STATUS_ACTIVE
    assert plugin.has_frontend is True
    assert plugin.has_backend is False
    # Contributions survive the round-trip through the manifest.
    assert plugin.manifest['contributions']['nav'][0]['route'] == '/demo'

    # The pre-bundled frontend was written into the (temp) plugins dir.
    assert (plugin_dirs['frontend'] / 'serverkit-demo' / 'index.jsx').exists()


def test_reinstall_refreshes_metadata(app, plugin_dirs):
    folder, manifest = _write_builtin(plugin_dirs['builtin'])
    plugin_service.install_builtin_extension('serverkit-demo')

    # An active plugin can't be reinstalled directly — disable it first.
    existing = InstalledPlugin.query.filter_by(slug='serverkit-demo').first()
    plugin_service.disable_plugin(existing.id)

    # Bump the manifest and reinstall.
    manifest['version'] = '2.0.0'
    manifest['display_name'] = 'Demo Extension v2'
    (folder / 'plugin.json').write_text(json.dumps(manifest), encoding='utf-8')

    plugin = plugin_service.install_builtin_extension('serverkit-demo')
    assert plugin.version == '2.0.0'
    assert plugin.display_name == 'Demo Extension v2'
    assert plugin.status == InstalledPlugin.STATUS_ACTIVE
    # Still a single row — reinstall updates in place.
    assert InstalledPlugin.query.filter_by(slug='serverkit-demo').count() == 1


def test_reinstall_active_plugin_is_rejected(app, plugin_dirs):
    _write_builtin(plugin_dirs['builtin'])
    plugin_service.install_builtin_extension('serverkit-demo')
    with pytest.raises(ValueError, match='already installed'):
        plugin_service.install_builtin_extension('serverkit-demo')


# --------------------------------------------------------------------------- #
# Contributions endpoint envelope
# --------------------------------------------------------------------------- #

def test_contributions_endpoint_envelope(app, client, auth_headers, plugin_dirs):
    _write_builtin(plugin_dirs['builtin'])
    plugin_service.install_builtin_extension('serverkit-demo')

    resp = client.get('/api/v1/plugins/contributions', headers=auth_headers)
    assert resp.status_code == 200
    data = resp.get_json()

    # The envelope always carries every key.
    for key in ('nav', 'routes', 'page_titles', 'command_palette', 'widgets',
                'layouts', 'ai'):
        assert key in data

    # Contributions are tagged with the source plugin slug.
    assert any(n.get('plugin') == 'serverkit-demo' and n.get('route') == '/demo'
               for n in data['nav'])
    assert any(r.get('plugin') == 'serverkit-demo' and r.get('component') == 'DemoPage'
               for r in data['routes'])
    assert data['page_titles'].get('/demo') == 'Demo'


def test_disabled_plugin_drops_from_contributions(app, client, auth_headers, plugin_dirs):
    _write_builtin(plugin_dirs['builtin'])
    plugin = plugin_service.install_builtin_extension('serverkit-demo')

    plugin_service.disable_plugin(plugin.id)
    resp = client.get('/api/v1/plugins/contributions', headers=auth_headers)
    assert resp.status_code == 200
    assert not any(n.get('plugin') == 'serverkit-demo' for n in resp.get_json()['nav'])


# --------------------------------------------------------------------------- #
# Disable guard: a disabled plugin's routes return 503
# --------------------------------------------------------------------------- #

def test_disable_guard_returns_503(app):
    from flask import Blueprint, jsonify

    p = InstalledPlugin(
        name='guard-test', display_name='Guard Test', slug='guard-test',
        version='1.0.0', status=InstalledPlugin.STATUS_ACTIVE, has_backend=True,
    )
    p.manifest = {}
    db.session.add(p)
    db.session.commit()

    bp = Blueprint('guard_test_bp', __name__)

    @bp.route('/ping')
    def ping():
        return jsonify({'ok': True})

    plugin_service._attach_status_guard(bp, 'guard-test')
    app.register_blueprint(bp, url_prefix='/api/v1/guard-test')

    c = app.test_client()
    assert c.get('/api/v1/guard-test/ping').status_code == 200

    p.status = InstalledPlugin.STATUS_DISABLED
    db.session.commit()
    r = c.get('/api/v1/guard-test/ping')
    assert r.status_code == 503
    assert r.get_json()['status'] == 'disabled'
