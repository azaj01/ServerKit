"""Registry fetch/cache, checksum-verified install, version gates, update flow."""
import hashlib
import io
import json
import zipfile

import pytest

from app import db
from app.models.plugin import InstalledPlugin
from app.services import plugin_service, registry_service
from app.utils import version as version_util


@pytest.fixture(autouse=True)
def _reset_registry_cache():
    registry_service._cache.update({'ts': 0.0, 'entries': None, 'source': None})
    yield
    registry_service._cache.update({'ts': 0.0, 'entries': None, 'source': None})


@pytest.fixture
def plugin_dirs(tmp_path, monkeypatch):
    backend = tmp_path / 'b'
    frontend = tmp_path / 'f'
    for d in (backend, frontend):
        d.mkdir()
    monkeypatch.setattr(plugin_service, 'BACKEND_PLUGINS_DIR', str(backend))
    monkeypatch.setattr(plugin_service, 'FRONTEND_PLUGINS_DIR', str(frontend))
    return {'backend': backend, 'frontend': frontend}


def _make_plugin_zip(slug='regext', version='2.0.0'):
    """A minimal, valid backend-less plugin zip (frontend-only)."""
    manifest = {
        'name': slug, 'display_name': 'Registry Ext', 'version': version,
        'category': 'utility',
        'contributions': {'nav': [{'id': slug, 'label': 'Reg', 'route': '/reg'}]},
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('plugin.json', json.dumps(manifest))
        zf.writestr('frontend/index.jsx', 'export function P(){return null;}\n')
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# Registry fetch / cache (offline-tolerant → bundled fallback)
# --------------------------------------------------------------------------- #

def test_bundled_registry_lists_serverkit_gui(app):
    # No SERVERKIT_REGISTRY_URL in tests → bundled index is used.
    entries = registry_service.list_extensions()
    slugs = {e['slug'] for e in entries}
    assert 'serverkit-gui' in slugs
    assert registry_service.registry_source_label() == 'bundled'


def test_registry_catalog_carries_install_state(app):
    catalog = registry_service.list_catalog()
    gui = next(e for e in catalog if e['slug'] == 'serverkit-gui')
    assert gui['installed'] is False
    assert gui['status'] == 'not_installed'
    assert gui['source_kind'] == 'registry'


def test_registry_endpoint(app, client, auth_headers):
    resp = client.get('/api/v1/marketplace/registry', headers=auth_headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert any(e['slug'] == 'serverkit-gui' for e in data['extensions'])


# --------------------------------------------------------------------------- #
# Version helpers + compat gates
# --------------------------------------------------------------------------- #

def test_version_helpers():
    assert version_util.compare_versions('2.0.0', '1.9.9') == 1
    assert version_util.compare_versions('1.0.0', '1.0.0') == 0
    assert version_util.version_satisfies('1.7.5', min_version='1.7.0') is True
    assert version_util.version_satisfies('1.6.0', min_version='1.7.0') is False
    assert version_util.version_satisfies('2.5.0', max_version='2.0.0') is False


def test_registry_install_blocked_by_min_panel_version(app, plugin_dirs, monkeypatch):
    monkeypatch.setattr(registry_service, '_cache', {
        'ts': 9e18, 'source': 'test',
        'entries': [registry_service._normalize({
            'slug': 'future-ext', 'display_name': 'Future', 'version': '1.0.0',
            'source': 'https://example.com/x.zip', 'min_panel_version': '999.0.0',
        })],
    })
    with pytest.raises(ValueError, match='needs panel'):
        plugin_service.install_registry_extension('future-ext')


# --------------------------------------------------------------------------- #
# Checksum-verified install
# --------------------------------------------------------------------------- #

def test_checksum_mismatch_rejected(app, plugin_dirs, monkeypatch):
    zip_bytes = _make_plugin_zip()
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(zip_bytes))

    with pytest.raises(ValueError, match='Checksum mismatch'):
        plugin_service.install_from_url('https://x/y.zip', expected_sha256='deadbeef')

    # Nothing was installed.
    assert InstalledPlugin.query.filter_by(slug='regext').first() is None


def test_checksum_match_installs(app, plugin_dirs, monkeypatch):
    zip_bytes = _make_plugin_zip()
    digest = hashlib.sha256(zip_bytes).hexdigest()
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(zip_bytes))

    plugin = plugin_service.install_from_url('https://x/y.zip', expected_sha256=digest)
    assert plugin.status == InstalledPlugin.STATUS_ACTIVE
    assert plugin.version == '2.0.0'
    # A plain URL install keeps the historical stamp.
    assert plugin.source_type == 'url'


def test_registry_install_stamps_registry_source_type(app, plugin_dirs, monkeypatch):
    """install_registry_extension records where the plugin really came from."""
    zip_bytes = _make_plugin_zip()
    digest = hashlib.sha256(zip_bytes).hexdigest()
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(zip_bytes))
    monkeypatch.setattr(registry_service, '_cache', {
        'ts': 9e18, 'source': 'test',
        'entries': [registry_service._normalize({
            'slug': 'regext', 'display_name': 'Registry Ext', 'version': '2.0.0',
            'source': 'https://x/regext.zip', 'sha256': digest,
            'min_panel_version': '0.0.1',
        })],
    })

    plugin = plugin_service.install_registry_extension('regext')
    assert plugin.status == InstalledPlugin.STATUS_ACTIVE
    assert plugin.source_type == 'registry'
    assert plugin.source_url == 'https://x/regext.zip'


# --------------------------------------------------------------------------- #
# Update flow
# --------------------------------------------------------------------------- #

def test_update_flow(app, plugin_dirs, monkeypatch):
    # Install v1.0.0 first.
    v1 = _make_plugin_zip(slug='regext', version='1.0.0')
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(v1))
    plugin = plugin_service.install_from_url('https://x/regext.zip')
    assert plugin.version == '1.0.0'
    assert plugin.source_type == 'url'

    # Registry advertises v2.0.0 for the same slug.
    monkeypatch.setattr(registry_service, '_cache', {
        'ts': 9e18, 'source': 'test',
        'entries': [registry_service._normalize({
            'slug': 'regext', 'display_name': 'Registry Ext', 'version': '2.0.0',
            'source': 'https://x/regext.zip', 'min_panel_version': '0.0.1',
        })],
    })

    updates = {u['slug']: u for u in plugin_service.check_for_updates()}
    assert updates['regext']['update_available'] is True
    assert updates['regext']['available_version'] == '2.0.0'
    assert updates['regext']['compatible'] is True

    # Serve v2 bytes and run the update (reinstall over active → force).
    v2 = _make_plugin_zip(slug='regext', version='2.0.0')
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(v2))
    updated = plugin_service.update_plugin(plugin.id)
    assert updated.version == '2.0.0'
    assert InstalledPlugin.query.filter_by(slug='regext').count() == 1
    # The update itself came from the registry — the row now says so.
    assert updated.source_type == 'registry'


def test_update_keeps_registry_source_type(app, plugin_dirs, monkeypatch):
    """A registry-installed plugin stays source_type='registry' after update."""
    v1 = _make_plugin_zip(slug='regext', version='1.0.0')
    digest_v1 = hashlib.sha256(v1).hexdigest()
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(v1))
    monkeypatch.setattr(registry_service, '_cache', {
        'ts': 9e18, 'source': 'test',
        'entries': [registry_service._normalize({
            'slug': 'regext', 'display_name': 'Registry Ext', 'version': '1.0.0',
            'source': 'https://x/regext.zip', 'sha256': digest_v1,
            'min_panel_version': '0.0.1',
        })],
    })
    plugin = plugin_service.install_registry_extension('regext')
    assert plugin.source_type == 'registry'

    # Registry moves to v2; run the update.
    v2 = _make_plugin_zip(slug='regext', version='2.0.0')
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(v2))
    monkeypatch.setattr(registry_service, '_cache', {
        'ts': 9e18, 'source': 'test',
        'entries': [registry_service._normalize({
            'slug': 'regext', 'display_name': 'Registry Ext', 'version': '2.0.0',
            'source': 'https://x/regext.zip',
            'sha256': hashlib.sha256(v2).hexdigest(),
            'min_panel_version': '0.0.1',
        })],
    })
    updated = plugin_service.update_plugin(plugin.id)
    assert updated.version == '2.0.0'
    assert updated.source_type == 'registry'


def test_update_preserves_builtin_source_type(app, plugin_dirs, monkeypatch):
    """A registry-driven update must not clobber a builtin/local/upload stamp."""
    v1 = _make_plugin_zip(slug='regext', version='1.0.0')
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(v1))
    plugin = plugin_service.install_from_url('https://x/regext.zip')
    plugin.source_type = 'builtin'
    db.session.commit()

    v2 = _make_plugin_zip(slug='regext', version='2.0.0')
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(v2))
    monkeypatch.setattr(registry_service, '_cache', {
        'ts': 9e18, 'source': 'test',
        'entries': [registry_service._normalize({
            'slug': 'regext', 'display_name': 'Registry Ext', 'version': '2.0.0',
            'source': 'https://x/regext.zip',
            'sha256': hashlib.sha256(v2).hexdigest(),
            'min_panel_version': '0.0.1',
        })],
    })
    updated = plugin_service.update_plugin(plugin.id)
    assert updated.version == '2.0.0'
    assert updated.source_type == 'builtin'


# --------------------------------------------------------------------------- #
# Registry URL resolution (live default vs explicit opt-out)
# --------------------------------------------------------------------------- #

def test_registry_url_defaults_to_public_index(monkeypatch):
    """Unset env → the curated serverkit-extensions raw index (the go-live
    default). conftest pins it EMPTY suite-wide, so simulate unset here."""
    monkeypatch.delenv('SERVERKIT_REGISTRY_URL', raising=False)
    assert registry_service._registry_url() == registry_service.DEFAULT_REGISTRY_URL
    assert 'serverkit-extensions' in registry_service.DEFAULT_REGISTRY_URL


def test_registry_url_empty_disables_remote(monkeypatch):
    """Explicitly-empty env disables the remote entirely (bundled only) —
    the hermetic-test/air-gapped escape hatch."""
    monkeypatch.setenv('SERVERKIT_REGISTRY_URL', '')
    assert registry_service._registry_url() == ''
    assert registry_service._fetch_remote() is None


def test_registry_url_env_override_wins(monkeypatch):
    monkeypatch.setenv('SERVERKIT_REGISTRY_URL', 'https://example.test/index.json')
    assert registry_service._registry_url() == 'https://example.test/index.json'


# --------------------------------------------------------------------------- #
# Index v2 fields — logo / repo / bundled
# --------------------------------------------------------------------------- #

def test_v2_entry_normalizes_logo_and_repo():
    """A v2 entry keeps logo/repo; an absolute logo passes through unchanged."""
    e = registry_service._normalize({
        'slug': 'gui', 'display_name': 'GUI', 'version': '1.0.0',
        'source': 'https://x/gui.zip',
        'repo': 'https://github.com/acme/gui',
        'logo': 'https://cdn.example/gui.svg',
    })
    assert e['repo'] == 'https://github.com/acme/gui'
    assert e['logo'] == 'https://cdn.example/gui.svg'
    assert e['bundled'] is False


def test_relative_logo_resolved_against_index_base():
    """A repo-relative logo becomes absolute against the index URL it came
    from (raw-GitHub index → raw asset URL)."""
    base = registry_service.DEFAULT_REGISTRY_URL  # .../main/index.json
    e = registry_service._normalize({
        'slug': 'gui', 'display_name': 'GUI', 'version': '1.0.0',
        'source': 'https://x/gui.zip',
        'logo': 'assets/gui/logo.svg',
    }, base_url=base)
    assert e['logo'] == (
        'https://raw.githubusercontent.com/jhd3197/serverkit-extensions/'
        'main/assets/gui/logo.svg'
    )


def test_v1_entry_unaffected_by_v2_defaults():
    """An entry with no v2 fields normalizes with safe defaults."""
    e = registry_service._normalize({
        'slug': 'old', 'display_name': 'Old', 'version': '1.0.0',
        'source': 'https://x/old.zip',
    })
    assert e['bundled'] is False
    assert e['repo'] == ''
    assert e['logo'] is None


def test_bundled_excluded_from_catalog_by_default(app, monkeypatch):
    monkeypatch.setattr(registry_service, '_cache', {
        'ts': 9e18, 'source': 'test',
        'entries': [
            registry_service._normalize({
                'slug': 'community-ext', 'display_name': 'Community', 'version': '1.0.0',
                'source': 'https://x/c.zip',
            }),
            registry_service._normalize({
                'slug': 'serverkit-wordpress', 'display_name': 'WordPress',
                'version': '1.0.0', 'bundled': True,
            }),
        ],
    })
    default_slugs = {e['slug'] for e in registry_service.list_catalog()}
    assert 'community-ext' in default_slugs
    assert 'serverkit-wordpress' not in default_slugs  # bundled hidden from Browse

    full_slugs = {e['slug'] for e in registry_service.list_catalog(include_bundled=True)}
    assert 'serverkit-wordpress' in full_slugs
    assert 'community-ext' in full_slugs


def test_registry_endpoint_include_bundled_flag(app, client, auth_headers, monkeypatch):
    monkeypatch.setattr(registry_service, '_cache', {
        'ts': 9e18, 'source': 'test',
        'entries': [
            registry_service._normalize({
                'slug': 'serverkit-wordpress', 'display_name': 'WordPress',
                'version': '1.0.0', 'bundled': True,
            }),
        ],
    })
    resp = client.get('/api/v1/marketplace/registry', headers=auth_headers)
    assert not any(e['slug'] == 'serverkit-wordpress' for e in resp.get_json()['extensions'])

    resp2 = client.get('/api/v1/marketplace/registry?include_bundled=true', headers=auth_headers)
    assert any(e['slug'] == 'serverkit-wordpress' for e in resp2.get_json()['extensions'])
