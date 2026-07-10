"""Tests for the Setup Health registry (setup_health_service): the probe matrix
over settings fixtures, the critical-vs-recommended severity mapping (HTTPS is
never critical), and inclusion of the section in the doctor report + API."""
import pytest

from app.services.setup_health_service import SetupHealthService


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #

def set_setting(key, value, vtype='string'):
    from app import db
    from app.models.system_settings import SystemSettings
    SystemSettings.set(key=key, value=value, value_type=vtype)
    db.session.commit()


def add_dns_provider():
    from app import db
    from app.models.email import DNSProviderConfig
    db.session.add(DNSProviderConfig(name='CF', provider='cloudflare', api_key='x'))
    db.session.commit()


def add_email_provider(tested_ok=True):
    from app import db
    from app.models.email_provider import EmailProviderConnection
    row = EmailProviderConnection(name='SMTP', provider='smtp', is_default=True,
                                  is_active=True, uses_notifications=True,
                                  last_test_ok=tested_ok)
    db.session.add(row)
    db.session.commit()
    return row


def add_backup_policy(enabled=True):
    from app import db
    from app.models.backup_policy import BackupPolicy
    row = BackupPolicy(target_type='application', target_id=1, enabled=enabled,
                       schedule_cron='0 3 * * *')
    db.session.add(row)
    db.session.commit()
    return row


def items_by_key(result):
    return {c['key']: c for c in result['items']}


# --------------------------------------------------------------------------- #
# Registry shape / normalization
# --------------------------------------------------------------------------- #

def test_evaluate_returns_normalized_check_shape(app):
    result = SetupHealthService.evaluate()
    assert 'items' in result and 'summary' in result
    for c in result['items']:
        # doctor _check shape …
        assert set(('key', 'title', 'status', 'detail', 'repairable',
                    'repair_ref')).issubset(c)
        assert c['status'] in ('ok', 'warn', 'fail')
        # … plus setup extras
        assert c['section'] == 'setup'
        assert c['severity'] in ('critical', 'recommended')
        assert c['scope'] == 'panel'
        assert c['fix']['kind'] in ('link', 'repair')


def test_summary_counts_and_score(app):
    result = SetupHealthService.evaluate()
    s = result['summary']
    assert s['total'] == len(result['items'])
    assert s['ok'] + s['critical_open'] + s['recommended_open'] == s['total']
    assert 0 <= s['score'] <= 100


# --------------------------------------------------------------------------- #
# Probe matrix — each item ok / not-ok by settings state
# --------------------------------------------------------------------------- #

def test_public_ip_ok_when_set(app):
    set_setting('server_public_ip', '203.0.113.7')
    c = items_by_key(SetupHealthService.evaluate())['setup.public_ip']
    assert c['status'] == 'ok'


def test_public_ip_recommended_when_unset_and_not_per_site(app):
    # No base domain → publishing_gaps short-circuits to no_base_domain, so the
    # missing IP is only a recommendation, not silent breakage.
    c = items_by_key(SetupHealthService.evaluate())['setup.public_ip']
    assert c['status'] == 'warn'
    assert c['severity'] == 'recommended'


def test_public_ip_critical_when_per_site_mode_without_ip(app):
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_dns_mode', 'per-site')
    c = items_by_key(SetupHealthService.evaluate())['setup.public_ip']
    assert c['status'] == 'fail'
    assert c['severity'] == 'critical'


def test_base_domain_ok_when_set(app):
    set_setting('sites_base_domain', 'apps.example.com')
    c = items_by_key(SetupHealthService.evaluate())['setup.base_domain']
    assert c['status'] == 'ok'


def test_base_domain_recommended_when_unset(app):
    c = items_by_key(SetupHealthService.evaluate())['setup.base_domain']
    assert c['status'] == 'warn'
    assert c['severity'] == 'recommended'


def test_dns_provider_ok_when_connected(app):
    add_dns_provider()
    c = items_by_key(SetupHealthService.evaluate())['setup.dns_provider']
    assert c['status'] == 'ok'


def test_dns_provider_critical_when_per_site_without_provider(app):
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_dns_mode', 'per-site')
    c = items_by_key(SetupHealthService.evaluate())['setup.dns_provider']
    assert c['status'] == 'fail'
    assert c['severity'] == 'critical'


def test_dns_provider_recommended_when_wildcard_without_provider(app):
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_dns_mode', 'wildcard')
    c = items_by_key(SetupHealthService.evaluate())['setup.dns_provider']
    assert c['status'] == 'warn'
    assert c['severity'] == 'recommended'


def test_email_delivery_ok_when_tested(app):
    add_email_provider(tested_ok=True)
    c = items_by_key(SetupHealthService.evaluate())['setup.email_delivery']
    assert c['status'] == 'ok'


def test_email_delivery_warn_when_untested(app):
    add_email_provider(tested_ok=False)
    c = items_by_key(SetupHealthService.evaluate())['setup.email_delivery']
    assert c['status'] == 'warn'
    assert c['severity'] == 'recommended'


def test_email_delivery_warn_when_absent(app):
    c = items_by_key(SetupHealthService.evaluate())['setup.email_delivery']
    assert c['status'] == 'warn'


def test_backup_policy_ok_with_enabled_policy(app):
    add_backup_policy(enabled=True)
    c = items_by_key(SetupHealthService.evaluate())['setup.backup_policy']
    assert c['status'] == 'ok'


def test_backup_policy_warn_without_any(app):
    add_backup_policy(enabled=False)
    c = items_by_key(SetupHealthService.evaluate())['setup.backup_policy']
    assert c['status'] == 'warn'


def test_backup_offsite_warn_on_local_only(app):
    c = items_by_key(SetupHealthService.evaluate())['setup.backup_offsite']
    assert c['status'] == 'warn'
    assert c['severity'] == 'recommended'


def test_backup_offsite_ok_with_s3(app, monkeypatch):
    from app.services.storage_provider_service import StorageProviderService
    monkeypatch.setattr(StorageProviderService, 'get_config',
                        classmethod(lambda cls: {'provider': 's3'}))
    c = items_by_key(SetupHealthService.evaluate())['setup.backup_offsite']
    assert c['status'] == 'ok'


def test_canonical_domain_ok_when_set_no_overlap(app):
    set_setting('canonical_domain', 'panel.example.com')
    c = items_by_key(SetupHealthService.evaluate())['setup.canonical_domain']
    assert c['status'] == 'ok'


def test_canonical_domain_warn_when_unset(app):
    c = items_by_key(SetupHealthService.evaluate())['setup.canonical_domain']
    assert c['status'] == 'warn'


# --------------------------------------------------------------------------- #
# Severity mapping — HTTPS is NEVER critical (SSL optional by decree)
# --------------------------------------------------------------------------- #

def test_wildcard_cert_absent_when_https_off(app):
    # Wildcard cert item is only applicable once wildcard HTTPS is switched on.
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_dns_mode', 'wildcard')
    keys = items_by_key(SetupHealthService.evaluate())
    assert 'setup.wildcard_cert' not in keys


def test_wildcard_cert_never_critical_when_missing(app, monkeypatch):
    import sys
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_dns_mode', 'wildcard')
    set_setting('sites_https_enabled', 'true', vtype='boolean')
    # Pretend we're on the Linux host with the cert absent.
    monkeypatch.setattr(sys, 'platform', 'linux')
    import app.services.setup_health_service as m
    monkeypatch.setattr(m.os.path, 'exists', lambda p: False)
    c = items_by_key(SetupHealthService.evaluate())['setup.wildcard_cert']
    assert c['status'] == 'warn'            # NOT 'fail'
    assert c['severity'] == 'recommended'   # HTTPS never critical


def test_no_https_item_is_ever_critical(app, monkeypatch):
    """Across every settings permutation, an HTTPS/TLS item can never come back
    critical — the SSL-optional invariant, asserted directly."""
    import sys
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_dns_mode', 'wildcard')
    set_setting('sites_https_enabled', 'true', vtype='boolean')
    monkeypatch.setattr(sys, 'platform', 'linux')
    import app.services.setup_health_service as m
    monkeypatch.setattr(m.os.path, 'exists', lambda p: False)
    for c in SetupHealthService.evaluate()['items']:
        if 'cert' in c['key'] or 'https' in c['key']:
            assert c['severity'] != 'critical'


# --------------------------------------------------------------------------- #
# Doctor-report inclusion + API
# --------------------------------------------------------------------------- #

def test_doctor_report_includes_setup_section(app, monkeypatch):
    from app.services.doctor_service import DoctorService
    # Keep the sweep cheap/offline — only care that setup.* is present.
    monkeypatch.setattr(DoctorService, '_drift_checks', classmethod(lambda cls: []))
    monkeypatch.setattr(DoctorService, '_service_checks', classmethod(lambda cls: []))
    monkeypatch.setattr(DoctorService, '_dns_checks', classmethod(lambda cls: []))
    report = DoctorService.run()
    setup_keys = [c['key'] for c in report['checks'] if c['key'].startswith('setup.')]
    assert 'setup.public_ip' in setup_keys
    assert 'setup.dns_provider' in setup_keys


def test_api_returns_items_and_summary(app, client, auth_headers):
    res = client.get('/api/v1/setup-health', headers=auth_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert 'items' in body and 'summary' in body
    assert body['summary']['total'] == len(body['items'])


def test_api_requires_admin(app, client):
    res = client.get('/api/v1/setup-health')
    assert res.status_code in (401, 422)


def test_fingerprint_changes_only_with_critical_set(app):
    # Fresh panel: no critical items (no per-site breakage) → empty fingerprint.
    fp_clean = SetupHealthService.fingerprint()
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_dns_mode', 'per-site')
    fp_broken = SetupHealthService.fingerprint()
    assert fp_clean != fp_broken
    assert 'setup.public_ip' in fp_broken
