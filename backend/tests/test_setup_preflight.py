"""Tests for creation-time preflight warnings (SiteDomainService.creation_warnings
+ the give_subdomain response): create-with-gaps returns codes, create-clean
returns empty, and the legacy `warning` string is still populated."""
import pytest

from app.services.site_domain_service import SiteDomainService


def set_setting(key, value, vtype='string'):
    from app import db
    from app.models.system_settings import SystemSettings
    SystemSettings.set(key=key, value=value, value_type=vtype)
    db.session.commit()


@pytest.fixture(autouse=True)
def _no_slow_dns(monkeypatch):
    """Keep the resolvability probe deterministic + offline: default to 'does not
    resolve' unless a test says otherwise."""
    monkeypatch.setattr(SiteDomainService, '_host_resolves',
                        staticmethod(lambda host, timeout=2.0: False))


# --------------------------------------------------------------------------- #
# creation_warnings — codes + fix shape
# --------------------------------------------------------------------------- #

def test_no_base_domain_yields_that_code(app):
    # Force an empty base domain (testing config defaults to lvh.me).
    from app.models.system_settings import SystemSettings
    monkey = SystemSettings.get  # noqa: F841
    set_setting('sites_base_domain', '')
    # base_domain() falls back to config lvh.me even when the setting is '', so
    # patch it to empty to exercise the no_base_domain gap.
    import app.services.site_domain_service as m
    orig = m.SiteDomainService.base_domain
    m.SiteDomainService.base_domain = classmethod(lambda cls: '')
    try:
        warnings = SiteDomainService.creation_warnings()
    finally:
        m.SiteDomainService.base_domain = orig
    codes = {w['code'] for w in warnings}
    assert 'no_base_domain' in codes
    w = next(w for w in warnings if w['code'] == 'no_base_domain')
    assert w['fix'] == {'kind': 'link', 'to': '/settings/site'}


def test_http_only_gap_present_when_base_set_without_https(app):
    set_setting('sites_base_domain', 'apps.example.com')
    codes = {w['code'] for w in SiteDomainService.creation_warnings()}
    assert 'http_only' in codes  # base set, HTTPS off → recommended gap


def test_unresolved_host_adds_host_unresolved_code(app):
    set_setting('sites_base_domain', 'apps.example.com')
    warnings = SiteDomainService.creation_warnings('blog.apps.example.com')
    codes = {w['code'] for w in warnings}
    assert 'host_unresolved' in codes
    w = next(w for w in warnings if w['code'] == 'host_unresolved')
    assert w['fix'] == {'kind': 'link', 'to': '/monitoring/doctor'}


def test_resolving_host_does_not_add_unresolved(app, monkeypatch):
    set_setting('sites_base_domain', 'apps.example.com')
    monkeypatch.setattr(SiteDomainService, '_host_resolves',
                        staticmethod(lambda host, timeout=2.0: True))
    codes = {w['code'] for w in SiteDomainService.creation_warnings('blog.apps.example.com')}
    assert 'host_unresolved' not in codes


def test_dev_host_is_never_probed(app):
    set_setting('sites_base_domain', 'apps.example.com')
    # lvh.me is a dev name — skipped by the resolvability probe entirely.
    codes = {w['code'] for w in SiteDomainService.creation_warnings('thing.lvh.me')}
    assert 'host_unresolved' not in codes


def test_clean_setup_returns_no_gaps(app, monkeypatch):
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_https_enabled', 'true', vtype='boolean')
    monkeypatch.setattr(SiteDomainService, '_host_resolves',
                        staticmethod(lambda host, timeout=2.0: True))
    # No canonical/panel overlap, wildcard mode default → no gaps.
    warnings = SiteDomainService.creation_warnings('blog.apps.example.com')
    assert warnings == []


# --------------------------------------------------------------------------- #
# give_subdomain response carries both the legacy string and the array
# --------------------------------------------------------------------------- #

@pytest.fixture
def app_row(app):
    from werkzeug.security import generate_password_hash
    from app import db
    from app.models import User
    from app.models.application import Application
    u = User(email='pf@test.local', username='pfuser',
             password_hash=generate_password_hash('x'),
             role=User.ROLE_ADMIN, is_active=True)
    db.session.add(u)
    db.session.flush()
    a = Application(name='pfsite', app_type='static', user_id=u.id,
                    root_path='/srv/pfsite')
    db.session.add(a)
    db.session.commit()
    return a


def test_give_subdomain_returns_warnings_array_and_legacy_warning(app, app_row, monkeypatch):
    # A real base domain so a subdomain is actually assigned; keep nginx writes
    # from touching the host by stubbing the vhost writer.
    set_setting('sites_base_domain', 'apps.example.com')
    monkeypatch.setattr(SiteDomainService, 'write_app_vhost',
                        classmethod(lambda cls, a, force_type=None: {'nginx': None, 'warning': None}))

    result = SiteDomainService.give_subdomain(app_row, label='blog')
    assert result['success'] is True
    assert result['host'] == 'blog.apps.example.com'
    # The array is present and carries structured codes …
    assert isinstance(result['warnings'], list)
    codes = {w['code'] for w in result['warnings']}
    assert 'host_unresolved' in codes  # unresolved by the autouse stub
    # … and the legacy single 'warning' key still exists (None here).
    assert 'warning' in result
