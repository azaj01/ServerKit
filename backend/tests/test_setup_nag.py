"""Tests for the single Setup Health nag + snooze/dismiss (plan 22 Phase 6):
the weekly digest fires only while non-snoozed critical items exist and only
when the critical set changed; snoozed items still render but are muted, don't
count as open, and don't trigger the nag."""
import pytest

from app.services.setup_health_service import (
    NAG_JOB_KIND,
    NAG_MARKER_KEY,
    NAG_SCHEDULE_NAME,
    PANEL_SNOOZE_KEY,
    SetupHealthService,
)


def set_setting(key, value, vtype='string'):
    from app import db
    from app.models.system_settings import SystemSettings
    SystemSettings.set(key=key, value=value, value_type=vtype)
    db.session.commit()


def force_critical():
    """A settings state that yields a critical (fail) panel item:
    per-site DNS mode + a base but no provider/IP → setup.dns_provider fail."""
    set_setting('sites_base_domain', 'apps.example.com')
    set_setting('sites_dns_mode', 'per-site')


@pytest.fixture
def admin(app):
    from werkzeug.security import generate_password_hash
    from app import db
    from app.models import User
    u = User(email='nag@t.local', username='nagadmin',
             password_hash=generate_password_hash('x'),
             role=User.ROLE_ADMIN, is_active=True)
    db.session.add(u)
    db.session.commit()
    return u


# --------------------------------------------------------------------------- #
# Snooze mutes an item (still renders, not counted, no nag)
# --------------------------------------------------------------------------- #

def test_panel_snooze_mutes_item_and_drops_open_count(app):
    force_critical()
    before = SetupHealthService.evaluate(scope='panel')
    dns = {c['key']: c for c in before['items']}['setup.dns_provider']
    assert dns['status'] == 'fail'
    assert before['summary']['critical_open'] >= 1

    SetupHealthService.snooze('setup.dns_provider', days=14)
    after = SetupHealthService.evaluate(scope='panel')
    dns = {c['key']: c for c in after['items']}['setup.dns_provider']
    # Still rendered, but muted …
    assert dns['snoozed'] is True
    assert dns['snoozed_until']
    # … and no longer counted as open.
    assert after['summary']['critical_open'] == before['summary']['critical_open'] - 1
    assert after['summary']['snoozed'] >= 1


def test_unsnooze_restores_open_count(app):
    force_critical()
    SetupHealthService.snooze('setup.dns_provider', days=14)
    SetupHealthService.unsnooze('setup.dns_provider')
    after = SetupHealthService.evaluate(scope='panel')
    dns = {c['key']: c for c in after['items']}['setup.dns_provider']
    assert not dns.get('snoozed')


def test_expired_snooze_is_ignored(app):
    force_critical()
    # Write an already-expired snooze directly.
    import json
    set_setting(PANEL_SNOOZE_KEY, json.dumps({'setup.dns_provider': '2000-01-01T00:00:00'}))
    after = SetupHealthService.evaluate(scope='panel')
    dns = {c['key']: c for c in after['items']}['setup.dns_provider']
    assert not dns.get('snoozed')  # expired → active again


def test_user_snooze_lives_on_the_user_row(app, admin):
    SetupHealthService.snooze('setup.account_security', days=7, user=admin)
    assert admin.setup_snoozes  # persisted on the row, not the settings map
    res = SetupHealthService.evaluate(scope='user', user=admin)
    item = {c['key']: c for c in res['items']}['setup.account_security']
    assert item['snoozed'] is True


def test_snooze_unknown_item_errors(app):
    assert 'error' in SetupHealthService.snooze('setup.nonexistent')


# --------------------------------------------------------------------------- #
# The nag job — critical-only, fingerprint-throttled, snooze-aware
# --------------------------------------------------------------------------- #

def _capture_notify(monkeypatch):
    import app.plugins_sdk as sdk
    sent = []
    monkeypatch.setattr(sdk.notify, 'send',
                        lambda event, to, data=None, **kw: sent.append((event, to, data)))
    return sent


def test_nag_fires_once_then_throttles(app, monkeypatch):
    force_critical()
    sent = _capture_notify(monkeypatch)

    first = SetupHealthService.run_nag_job(object())
    assert first['notified'] is True
    assert len(sent) == 1
    event, to, data = sent[0]
    assert event == 'setup.incomplete'
    assert to == 'admins'
    assert data['count'] >= 1

    # Second run, same critical set → throttled (no re-nag).
    second = SetupHealthService.run_nag_job(object())
    assert second['notified'] is False
    assert second.get('reason') == 'unchanged'
    assert len(sent) == 1


def test_nag_does_not_fire_without_criticals(app, monkeypatch):
    # No base/per-site config → no critical items.
    sent = _capture_notify(monkeypatch)
    res = SetupHealthService.run_nag_job(object())
    assert res['notified'] is False
    assert res['critical_open'] == 0
    assert sent == []


def test_snoozed_critical_does_not_trigger_nag(app, monkeypatch):
    force_critical()
    SetupHealthService.snooze('setup.dns_provider', days=30)
    # public_ip may also be critical in per-site mode; snooze it too.
    SetupHealthService.snooze('setup.public_ip', days=30)
    sent = _capture_notify(monkeypatch)
    res = SetupHealthService.run_nag_job(object())
    assert res['notified'] is False
    assert res['critical_open'] == 0
    assert sent == []


def test_nag_marker_resets_when_criticals_clear(app, monkeypatch):
    from app.services.settings_service import SettingsService
    force_critical()
    _capture_notify(monkeypatch)
    SetupHealthService.run_nag_job(object())
    assert SettingsService.get(NAG_MARKER_KEY)  # marker set

    # Resolve the criticals (wildcard mode, no per-site requirement).
    set_setting('sites_dns_mode', 'wildcard')
    SetupHealthService.run_nag_job(object())
    assert (SettingsService.get(NAG_MARKER_KEY) or '') == ''  # marker cleared


# --------------------------------------------------------------------------- #
# Schedule + API
# --------------------------------------------------------------------------- #

def test_nag_schedule_is_seeded(app):
    from app.jobs.builtin_handlers import seed_builtin_schedules
    from app.jobs.models import ScheduledJob
    seed_builtin_schedules()
    row = ScheduledJob.query.filter_by(name=NAG_SCHEDULE_NAME).first()
    assert row is not None
    assert row.kind == NAG_JOB_KIND
    assert row.interval_seconds == 604800


def test_setup_incomplete_in_catalog():
    from app.notifications import catalog
    entry = catalog.get('setup.incomplete')
    assert entry is not None
    assert entry['category'] == 'system'


def test_snooze_api_panel_requires_admin(app, client):
    from app import db
    from app.models import User
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash
    dev = User(email='d@t.local', username='devuser',
               password_hash=generate_password_hash('x'),
               role='developer', is_active=True)
    db.session.add(dev)
    db.session.commit()
    headers = {'Authorization': f'Bearer {create_access_token(identity=dev.id)}'}
    res = client.post('/api/v1/setup-health/snooze',
                      json={'key': 'setup.dns_provider'}, headers=headers)
    assert res.status_code == 403  # panel item, non-admin


def test_snooze_api_user_item_allows_self(app, client):
    from app import db
    from app.models import User
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash
    dev = User(email='d2@t.local', username='devuser2',
               password_hash=generate_password_hash('x'),
               role='developer', is_active=True)
    db.session.add(dev)
    db.session.commit()
    headers = {'Authorization': f'Bearer {create_access_token(identity=dev.id)}'}
    res = client.post('/api/v1/setup-health/snooze',
                      json={'key': 'setup.account_security', 'days': 7}, headers=headers)
    assert res.status_code == 200
    assert res.get_json()['scope'] == 'user'
