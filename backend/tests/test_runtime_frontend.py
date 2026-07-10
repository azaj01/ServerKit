"""Runtime extension frontend loading — server-side contract (plan 25 Phase 2).

Covers the halves the backend owns:
  - install-time bundle hashing (#6): sha256 of the runtime ESM bundle recorded
    in the plugin config store,
  - the /plugins/contributions `frontends` descriptor map exposing entry + hashes,
  - the kill switch (Decision 4): `extensions.runtime_frontend` off -> no `frontends`,
  - dual-path coexistence: a baked (.jsx) builtin + a runtime (.mjs) extension in
    one session -> only the runtime one appears in `frontends`,
  - config PUT preserving the panel-managed `_frontend_hashes` key.

The frontend halves (blob-import, hash-mismatch refusal, error-boundary render)
are exercised by the JS render smoke test / screenshots fixture; here we lock the
data contract they depend on.

RECOVERY NOTE (plan 42): this entire runtime-frontend backend contract did NOT
survive the data loss and is hollow in the current tree — the whole module is
skipped, with the reconstruction preserved so it can be un-skipped once the
feature is restored. Missing surface:
  - contribution_service.get_active_contributions() emits no ``frontends`` map
    (and no ``sdk_version``),
  - no ``_frontend_hashes`` key / install-time ESM sha256 recording in the plugin
    config store,
  - no ``extensions.runtime_frontend`` kill switch is consulted.
"""
import json
import zipfile
from io import BytesIO
from types import SimpleNamespace

import pytest

from app import db
from app.models.plugin import InstalledPlugin
from app.services import contribution_service, plugin_service, registry_service
from app.services.settings_service import SettingsService

pytestmark = pytest.mark.skip(
    reason="plan 42: hollow feature - the runtime-frontend backend contract "
           "(frontends descriptor map, _frontend_hashes install-time ESM sha256, "
           "extensions.runtime_frontend kill switch) was lost in the data loss")

_BUNDLE = 'export function Page(){return null;}'
_ICON = '<circle cx="12" cy="12" r="8"/>'


@pytest.fixture
def plugin_dirs(tmp_path, monkeypatch):
    """Redirect plugin install roots at throwaway tmp dirs so installs never
    touch the real backend/frontend/builtin plugin trees."""
    backend = tmp_path / 'backend_plugins'
    frontend = tmp_path / 'frontend_plugins'
    builtin = tmp_path / 'builtin_extensions'
    for d in (backend, frontend, builtin):
        d.mkdir()
    monkeypatch.setattr(plugin_service, 'BACKEND_PLUGINS_DIR', str(backend))
    monkeypatch.setattr(plugin_service, 'FRONTEND_PLUGINS_DIR', str(frontend))
    monkeypatch.setattr(plugin_service, 'BUILTIN_EXTENSIONS_DIR', str(builtin))
    return SimpleNamespace(backend=backend, frontend=frontend, builtin=builtin)


def _runtime_zip(slug='serverkit-runtime', bundle=_BUNDLE, **kw):
    """Build an install zip for a runtime-frontend extension: a plugin.json whose
    frontend is a prebuilt ESM bundle at frontend/dist/index.mjs."""
    manifest = {
        'name': slug,
        'display_name': 'Runtime Demo',
        'version': '1.0.0',
        'description': ('A minimal extension whose frontend is a prebuilt ESM bundle at\n'
                        '    frontend/dist/index.mjs (the runtime-load convention).'),
        'category': 'utility',
        'sdk_version': '^1.0.0',
        'frontend_entry': 'dist/index.mjs',
        'contributions': {
            'nav': [{'label': 'Runtime Demo', 'route': 'runtime-demo',
                     'category': 'system', 'icon': _ICON}],
            'routes': [{'path': 'runtime-demo', 'component': 'Page'}],
        },
    }
    manifest.update(kw)

    buf = BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('plugin.json', json.dumps(manifest))
        zf.writestr('frontend/dist/index.mjs', bundle)
    buf.seek(0)
    return buf


def _install_runtime(**kw):
    buf = _runtime_zip(**kw)
    return plugin_service.install_from_zip(buf.getvalue(), source_name='runtime-extension')


# ---------------------------------------------------------------------------
# install-time bundle hashing (#6)
# ---------------------------------------------------------------------------

def test_install_records_bundle_sha256(plugin_dirs):
    import hashlib
    plugin = _install_runtime()
    expected = hashlib.sha256(_BUNDLE.encode()).hexdigest()
    row = InstalledPlugin.query.filter_by(slug='serverkit-runtime').first()
    hashes = (row.config or {}).get('_frontend_hashes') or {}
    assert hashes.get('dist/index.mjs') == expected


# ---------------------------------------------------------------------------
# /plugins/contributions `frontends` descriptor map
# ---------------------------------------------------------------------------

def test_contributions_exposes_frontends_descriptor(plugin_dirs):
    _install_runtime()
    contrib = contribution_service.get_active_contributions()
    fe = contrib['frontends']['serverkit-runtime']
    assert fe['entry'] == 'dist/index.mjs'
    assert 'hashes' in fe


# ---------------------------------------------------------------------------
# kill switch (Decision 4)
# ---------------------------------------------------------------------------

def test_kill_switch_removes_frontends(plugin_dirs):
    _install_runtime()
    SettingsService.set('extensions.runtime_frontend', False)
    contrib = contribution_service.get_active_contributions()
    assert not contrib.get('frontends')


# ---------------------------------------------------------------------------
# dual-path coexistence: baked builtin (.jsx) + runtime (.mjs)
# ---------------------------------------------------------------------------

def test_baked_and_runtime_coexist(plugin_dirs):
    _install_runtime()
    # A baked builtin contributes via a .jsx component, not a runtime bundle, so
    # it must NOT appear in the runtime `frontends` map.
    baked = InstalledPlugin(slug='serverkit-baked', name='Baked',
                            status=InstalledPlugin.STATUS_ACTIVE,
                            manifest={'frontend_entry': 'components/Baked.jsx'})
    db.session.add(baked)
    db.session.commit()
    contrib = contribution_service.get_active_contributions()
    assert 'serverkit-runtime' in contrib['frontends']
    assert 'serverkit-baked' not in contrib['frontends']


# ---------------------------------------------------------------------------
# config PUT preserves the panel-managed `_frontend_hashes`
# ---------------------------------------------------------------------------

def test_config_put_preserves_frontend_hashes(plugin_dirs):
    _install_runtime()
    row = InstalledPlugin.query.filter_by(slug='serverkit-runtime').first()
    before = (row.config or {}).get('_frontend_hashes')
    plugin_service.update_plugin_config('serverkit-runtime', {'user_key': 'value'})
    row = InstalledPlugin.query.filter_by(slug='serverkit-runtime').first()
    after = (row.config or {}).get('_frontend_hashes')
    assert after == before
    assert (row.config or {}).get('user_key') == 'value'
