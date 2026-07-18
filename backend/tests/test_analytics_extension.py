"""serverkit-analytics (Web Analytics) extension tests.

Loads the builtin the way production does: ``plugin_service.
_ensure_builtin_backend_importable`` registers ``builtin-extensions/
serverkit-analytics/backend`` as the dashed package ``app.plugins.
serverkit-analytics``. The models module is imported at module top so its
``ext_serverkit_analytics_*`` tables register on ``db.metadata`` before the
``app`` fixture runs ``db.create_all()``.

Nothing here shells out or talks to Docker; the collector, ingestion buffer,
rollups, and log parsing are exercised against the in-memory test DB. Bots,
rate-limits, and visitor hashing are pure-Python and tested directly.
"""
import importlib
import json
import os

import pytest

from app.services import plugin_service

SLUG = 'serverkit-analytics'
EXT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'builtin-extensions', SLUG,
)


def _load_ext():
    assert plugin_service._ensure_builtin_backend_importable(SLUG), (
        f'builtin extension backend not importable from {EXT_DIR}')
    mods = {}
    for name in ('config', 'models', 'ingest_service', 'rollup_service',
                 'lifecycle', 'jobs', 'analytics'):
        mods[name] = importlib.import_module(f'app.plugins.{SLUG}.{name}')
    return mods


_M = _load_ext()
config_mod = _M['config']
models_mod = _M['models']
ingest_mod = _M['ingest_service']
rollup_mod = _M['rollup_service']
lifecycle_mod = _M['lifecycle']
jobs_mod = _M['jobs']
bp_mod = _M['analytics']

AnalyticsSite = models_mod.AnalyticsSite
AnalyticsEvent = models_mod.AnalyticsEvent
AnalyticsDaily = models_mod.AnalyticsDaily
AnalyticsLogCursor = models_mod.AnalyticsLogCursor

# A realistic desktop UA so happy-path hits aren't bot/empty-UA filtered.
UA_CHROME = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
             '(KHTML, like Gecko) Chrome/120.0 Safari/537.36')


# --------------------------------------------------------------------------- #
# helpers / fixtures
# --------------------------------------------------------------------------- #
def _mk_plugin_row(config=None, status=None):
    from app import db
    from app.models.plugin import InstalledPlugin
    row = InstalledPlugin(
        name=SLUG, display_name='Web Analytics', slug=SLUG, version='1.0.0',
        status=status or InstalledPlugin.STATUS_ACTIVE,
    )
    row.config = config or {}
    db.session.add(row)
    db.session.commit()
    return row


def _mk_admin():
    from app import db
    from app.models.user import User
    from werkzeug.security import generate_password_hash
    u = User(email='analyticsadmin@t.local', username='analyticsadmin',
             password_hash=generate_password_hash('x'),
             role=User.ROLE_ADMIN, is_active=True)
    db.session.add(u)
    db.session.commit()
    return u


def _mk_viewer():
    from app import db
    from app.models.user import User
    from werkzeug.security import generate_password_hash
    u = User(email='analyticsviewer@t.local', username='analyticsviewer',
             password_hash=generate_password_hash('x'),
             role=User.ROLE_VIEWER, is_active=True)
    db.session.add(u)
    db.session.commit()
    return u


def _auth(user):
    from flask_jwt_extended import create_access_token
    return {'Authorization': f'Bearer {create_access_token(identity=user.id)}'}


@pytest.fixture(autouse=True)
def _clean_ingest_state():
    """Reset the process-global ingest buffer + rate limiter between tests."""
    ingest_mod.reset_buffer()
    ingest_mod.reset_rate_limits()
    yield
    ingest_mod.reset_buffer()
    ingest_mod.reset_rate_limits()


@pytest.fixture
def analytics_client(app):
    if 'analytics' not in app.blueprints:
        app.register_blueprint(bp_mod.analytics_bp, url_prefix='/api/v1/analytics')
    return app.test_client()


def _mk_site(**kwargs):
    from app import db
    kwargs.setdefault('name', 'Test Site')
    kwargs.setdefault('hostnames', 'example.com')
    site = AnalyticsSite(**kwargs)
    db.session.add(site)
    db.session.commit()
    return site


def _collect(client, site_key, path='/home', ua=UA_CHROME, extra_headers=None,
             body=None, **payload):
    headers = {'User-Agent': ua, 'Content-Type': 'text/plain'}
    if extra_headers:
        headers.update(extra_headers)
    if body is None:
        data = {'k': site_key, 'p': path}
        data.update(payload)
        body = json.dumps(data)
    return client.post('/api/v1/analytics/collect', data=body, headers=headers)


# --------------------------------------------------------------------------- #
# manifest
# --------------------------------------------------------------------------- #
def _manifest():
    with open(os.path.join(EXT_DIR, 'plugin.json'), encoding='utf-8') as f:
        return json.load(f)


def test_manifest_passes_validator():
    m = _manifest()
    assert plugin_service._validate_manifest(m) is True
    assert m['name'] == SLUG
    assert m['entry_point'] == 'analytics:analytics_bp'
    assert m['url_prefix'] == '/api/v1/analytics'
    assert m['models'] == 'models:register'
    nav = m['contributions']['nav'][0]
    assert nav['route'] == '/analytics' and nav['id'] == 'analytics'
    assert m['contributions']['page_titles']['/analytics'] == 'Web Analytics'


def test_manifest_permissions_known_and_no_dashes():
    from app.plugins_sdk import permissions as sdk_perms
    m = _manifest()
    assert sdk_perms.unknown_permissions(m['permissions']) == []
    assert set(m['permissions']) == {'db', 'network', 'filesystem'}
    assert '—' not in m['description'] and '–' not in m['description']


def test_manifest_jobs_and_schedules_pair_up():
    m = _manifest()
    job_kinds = {j['kind'] for j in m['jobs']}
    sched_kinds = {s['kind'] for s in m['schedules']}
    assert sched_kinds <= job_kinds
    assert {'analytics.rollup', 'analytics.retention_prune',
            'analytics.log_tail'} <= job_kinds


def test_lifecycle_and_job_refs_resolve():
    m = _manifest()
    for ref in m['lifecycle'].values():
        module_name, func_name = ref.split(':')
        mod = importlib.import_module(f'app.plugins.{SLUG}.{module_name}')
        assert callable(getattr(mod, func_name, None)), ref
    for job in m['jobs']:
        module_name, func_name = job['handler'].split(':')
        mod = importlib.import_module(f'app.plugins.{SLUG}.{module_name}')
        assert callable(getattr(mod, func_name, None)), job['handler']


def test_entry_point_resolves_to_blueprint():
    assert getattr(bp_mod, 'analytics_bp', None) is not None
    assert bp_mod.analytics_bp.name == 'analytics'


def test_config_schema_keys_match_defaults():
    m = _manifest()
    schema_keys = set(m['config_schema'].keys())
    assert schema_keys == set(config_mod.DEFAULTS.keys())


# --------------------------------------------------------------------------- #
# config accessor
# --------------------------------------------------------------------------- #
def test_get_cfg_returns_defaults_without_row(app):
    cfg = config_mod.get_cfg()
    assert cfg['raw_retention_days'] == 30
    assert cfg['honor_dnt'] is True
    assert cfg['collect_rate_per_min'] == 600


def test_get_cfg_merges_saved_over_defaults(app):
    _mk_plugin_row(config={'raw_retention_days': 7, 'geo_enabled': True})
    cfg = config_mod.get_cfg()
    assert cfg['raw_retention_days'] == 7      # overridden
    assert cfg['geo_enabled'] is True          # overridden
    assert cfg['rollup_retention_months'] == 13  # still default


def test_cfg_int_clamps(app):
    _mk_plugin_row(config={'collect_rate_per_min': 5})
    assert config_mod.cfg_int('collect_rate_per_min', minimum=10) == 10


def test_cfg_bool_accepts_strings(app):
    _mk_plugin_row(config={'honor_dnt': 'false'})
    assert config_mod.cfg_bool('honor_dnt') is False


# --------------------------------------------------------------------------- #
# lifecycle
# --------------------------------------------------------------------------- #
def test_on_install_seeds_config_defaults(app):
    row = _mk_plugin_row(config={})
    lifecycle_mod.on_install(row)
    assert row.config['raw_retention_days'] == 30
    assert row.config['log_ingestion_enabled'] is True


def test_on_install_does_not_clobber_saved(app):
    row = _mk_plugin_row(config={'raw_retention_days': 90})
    lifecycle_mod.on_install(row)
    assert row.config['raw_retention_days'] == 90  # preserved
    assert 'buffer_max' in row.config              # new key seeded


def test_on_uninstall_is_safe_without_integrations(app):
    row = _mk_plugin_row()
    # wp_integration / nginx_integration may not import cleanly yet; must not raise.
    lifecycle_mod.on_uninstall(row, purge=True)


# --------------------------------------------------------------------------- #
# ping route (proves the blueprint mounts; 503 status guard covered separately)
# --------------------------------------------------------------------------- #
def test_ping_route(analytics_client):
    resp = analytics_client.get('/api/v1/analytics/ping')
    assert resp.status_code == 200
    assert resp.get_json()['plugin'] == SLUG


# --------------------------------------------------------------------------- #
# models + purge
# --------------------------------------------------------------------------- #
def test_models_register_and_tables_exist(app):
    from app import db
    from sqlalchemy import inspect
    assert set(models_mod.register(db)) == {
        AnalyticsSite, AnalyticsEvent, AnalyticsDaily, AnalyticsLogCursor}
    tables = [t for t in inspect(db.engine).get_table_names()
              if t.startswith('ext_serverkit_analytics')]
    assert 'ext_serverkit_analytics_sites' in tables
    assert 'ext_serverkit_analytics_events' in tables
    assert 'ext_serverkit_analytics_daily' in tables
    assert 'ext_serverkit_analytics_log_cursors' in tables


def test_purge_drops_only_prefixed_tables(app):
    from app import db
    from app.services import extension_lifecycle
    from sqlalchemy import inspect
    from types import SimpleNamespace
    dropped = extension_lifecycle.purge_models(SimpleNamespace(slug=SLUG))
    assert dropped >= 4
    remaining = [t for t in inspect(db.engine).get_table_names()
                 if t.startswith('ext_serverkit_analytics')]
    assert remaining == []
    assert 'users' in inspect(db.engine).get_table_names()  # core survives
    db.create_all()  # restore for later tests in this module


def test_site_key_is_generated_and_unique(app):
    a = _mk_site(name='A')
    b = _mk_site(name='B')
    assert a.site_key and b.site_key and a.site_key != b.site_key


# --------------------------------------------------------------------------- #
# ingest units: bot filter, UA parse, visitor hash, helpers
# --------------------------------------------------------------------------- #
def test_is_bot_matches_common_agents():
    assert ingest_mod.is_bot('curl/7.68.0')
    assert ingest_mod.is_bot('Googlebot/2.1')
    assert ingest_mod.is_bot('python-requests/2.31')
    assert not ingest_mod.is_bot(UA_CHROME)


def test_parse_ua_classifies():
    browser, os_family, device = ingest_mod.parse_ua(UA_CHROME)
    assert browser == 'Chrome'
    assert os_family == 'Windows'
    assert device == 'desktop'
    iphone = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
              'AppleWebKit/605 (KHTML, like Gecko) Version/17 Mobile/15E Safari/604')
    b2, os2, d2 = ingest_mod.parse_ua(iphone)
    assert os2 == 'iOS' and d2 == 'mobile'


def test_visitor_hash_stable_and_scoped(app):
    h1 = ingest_mod.visitor_hash(1, '1.2.3.4', UA_CHROME)
    h2 = ingest_mod.visitor_hash(1, '1.2.3.4', UA_CHROME)
    h_other_site = ingest_mod.visitor_hash(2, '1.2.3.4', UA_CHROME)
    h_other_ip = ingest_mod.visitor_hash(1, '9.9.9.9', UA_CHROME)
    assert h1 == h2                 # deterministic within the day
    assert len(h1) == 32
    assert h1 != h_other_site       # scoped by site
    assert h1 != h_other_ip         # scoped by ip
    assert '1.2.3.4' not in h1      # raw ip never leaks into the digest


def test_referrer_host_and_clean_path():
    assert ingest_mod.referrer_host('https://google.com/search?q=x') == 'google.com'
    assert ingest_mod.referrer_host('') is None
    assert ingest_mod._clean_path('https://example.com/a/b?x=1#frag') == '/a/b'
    assert ingest_mod._clean_path('') == '/'
    assert ingest_mod._clean_path('noslash') == '/noslash'


# --------------------------------------------------------------------------- #
# collector route
# --------------------------------------------------------------------------- #
def test_collect_happy_path_buffers_and_flushes(app, analytics_client):
    site = _mk_site()
    resp = _collect(analytics_client, site.site_key, path='/home', r='https://google.com/')
    assert resp.status_code == 204
    assert ingest_mod.buffer_size() == 1
    written = ingest_mod.flush_buffer(app)
    assert written == 1
    ev = AnalyticsEvent.query.filter_by(site_id=site.id).one()
    assert ev.url_path == '/home'
    assert ev.referrer_host == 'google.com'
    assert ev.ua_family == 'Chrome'
    assert ev.source == 'js'
    assert ev.visitor_hash and len(ev.visitor_hash) == 32


def test_collect_unknown_key_404(app, analytics_client):
    resp = _collect(analytics_client, 'nope-not-a-real-key')
    assert resp.status_code == 404
    assert ingest_mod.buffer_size() == 0


def test_collect_disabled_site_403(app, analytics_client):
    site = _mk_site(enabled=False)
    resp = _collect(analytics_client, site.site_key)
    assert resp.status_code == 403


def test_collect_missing_key_400(app, analytics_client):
    resp = analytics_client.post('/api/v1/analytics/collect',
                                 data=json.dumps({'p': '/x'}),
                                 headers={'User-Agent': UA_CHROME})
    assert resp.status_code == 400


def test_collect_malformed_json_400(app, analytics_client):
    resp = analytics_client.post('/api/v1/analytics/collect',
                                 data='{not json',
                                 headers={'User-Agent': UA_CHROME})
    assert resp.status_code == 400


def test_collect_oversized_body_413(app, analytics_client):
    site = _mk_site()
    big = json.dumps({'k': site.site_key, 'p': '/x', 'pad': 'A' * 9000})
    resp = _collect(analytics_client, site.site_key, body=big)
    assert resp.status_code == 413


def test_collect_bot_ua_dropped(app, analytics_client):
    site = _mk_site()
    resp = _collect(analytics_client, site.site_key, ua='curl/7.68.0')
    assert resp.status_code == 204
    assert ingest_mod.buffer_size() == 0  # accepted but not stored


def test_collect_empty_ua_dropped(app, analytics_client):
    site = _mk_site()
    resp = _collect(analytics_client, site.site_key, ua='')
    assert resp.status_code == 204
    assert ingest_mod.buffer_size() == 0


def test_collect_honors_dnt(app, analytics_client):
    site = _mk_site()
    resp = _collect(analytics_client, site.site_key, extra_headers={'DNT': '1'})
    assert resp.status_code == 204
    assert ingest_mod.buffer_size() == 0


def test_collect_per_site_dnt_override(app, analytics_client):
    # Global honor_dnt default True; a site opting OUT still records a DNT hit.
    site = _mk_site(honor_dnt=False)
    resp = _collect(analytics_client, site.site_key, extra_headers={'DNT': '1'})
    assert resp.status_code == 204
    assert ingest_mod.buffer_size() == 1


def test_collect_rate_limited_429(app, analytics_client):
    _mk_plugin_row(config={'collect_rate_per_min': 2})
    site = _mk_site()
    assert _collect(analytics_client, site.site_key).status_code == 204
    assert _collect(analytics_client, site.site_key).status_code == 204
    assert _collect(analytics_client, site.site_key).status_code == 429


def test_collect_origin_allowlist_enforced(app, analytics_client):
    site = _mk_site(allowed_origins='https://example.com')
    ok = _collect(analytics_client, site.site_key,
                  extra_headers={'Origin': 'https://example.com'})
    assert ok.status_code == 204
    assert ok.headers.get('Access-Control-Allow-Origin') == 'https://example.com'
    bad = _collect(analytics_client, site.site_key,
                   extra_headers={'Origin': 'https://evil.test'})
    assert bad.status_code == 403


def test_collect_reflects_origin_by_default(app, analytics_client):
    site = _mk_site()  # no allowlist => reflect
    resp = _collect(analytics_client, site.site_key,
                    extra_headers={'Origin': 'https://anything.test'})
    assert resp.headers.get('Access-Control-Allow-Origin') == 'https://anything.test'


def test_collect_options_preflight(app, analytics_client):
    resp = analytics_client.options('/api/v1/analytics/collect',
                                    headers={'Origin': 'https://example.com'})
    assert resp.status_code == 204
    assert resp.headers.get('Access-Control-Allow-Methods') == 'POST, OPTIONS'


def test_collect_stores_query_only_when_enabled(app, analytics_client):
    _mk_plugin_row(config={'store_query_strings': True})
    site = _mk_site()
    _collect(analytics_client, site.site_key, path='/search', q='term=hats')
    ingest_mod.flush_buffer(app)
    ev = AnalyticsEvent.query.filter_by(site_id=site.id).one()
    assert ev.url_query == 'term=hats'


def test_tracker_js_served_public(app, analytics_client):
    resp = analytics_client.get('/api/v1/analytics/tracker.js')
    assert resp.status_code == 200
    assert 'javascript' in resp.headers['Content-Type']
    assert resp.headers.get('Access-Control-Allow-Origin') == '*'
    assert resp.headers.get('Cache-Control') == 'no-cache'


# --------------------------------------------------------------------------- #
# retention prune
# --------------------------------------------------------------------------- #
def test_retention_prune_deletes_old_events(app):
    from app import db
    from datetime import datetime, timedelta
    site = _mk_site()
    old = AnalyticsEvent(site_id=site.id, type='pageview', url_path='/old',
                         ts=datetime.utcnow() - timedelta(days=99), source='js')
    fresh = AnalyticsEvent(site_id=site.id, type='pageview', url_path='/new',
                           ts=datetime.utcnow(), source='js')
    db.session.add_all([old, fresh])
    db.session.commit()
    _mk_plugin_row(config={'raw_retention_days': 30})
    result = rollup_mod.run_retention_prune()
    assert result['deleted_events'] == 1
    remaining = [e.url_path for e in AnalyticsEvent.query.filter_by(site_id=site.id)]
    assert remaining == ['/new']


def test_retention_job_handler_never_raises(app):
    _mk_plugin_row()
    out = jobs_mod.retention_prune(job=None)
    assert 'deleted_events' in out or 'error' in out
