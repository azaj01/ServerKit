"""Preference resolution matrix (plan 24 Phase 2).

Proves the first-match-wins order for a channel firing:
    user per-event override > user category/severity prefs > org default > catalog
plus the critical-always invariant and back-compat for rows without an
``events_json`` map.

RECOVERY NOTE (plan 42): the original pyc unmarshalled only partially (salvage
truncates at ``TestOrgDefaults``). Two tiers of the matrix did NOT survive the
data loss and are hollow in the current tree:

  * the *user per-event override* tier — ``NotificationPreferences`` has no
    ``events_json`` column and no ``set_events()`` method, and
    ``NotificationBusService._plan`` never consults a per-event map.
  * the *org default* tier — resolution never consults ``SettingsService`` for
    an org-wide channel default.

Those tiers are marked skip-hollow below. The surviving middle of the chain
(user severity/category prefs + the critical-always invariant + back-compat for
rows without an events map) is reconstructed as real coverage.
"""
import pytest
from werkzeug.security import generate_password_hash

from app import db
from app.models import User
from app.models.notification_preferences import NotificationPreferences
from app.notifications.models import Notification, NotificationDelivery
from app.notifications.service import NotificationBusService
from app.queue_bus.service import QueueBusService
from app.services.settings_service import SettingsService


@pytest.fixture(autouse=True)
def reset_broker(app):
    QueueBusService.reset_broker()


def _make_user(username='alice', email='alice@example.com', role='developer'):
    user = User(
        email=email, username=username,
        password_hash=generate_password_hash('x'),
        role=role, is_active=True,
    )
    db.session.add(user)
    db.session.commit()
    return user


def _prefs(user, **fields):
    prefs = NotificationPreferences.get_or_create(user.id)
    for key, value in fields.items():
        if key == 'channels':
            prefs.set_channels(value)
        elif key == 'severities':
            prefs.set_severities(value)
        elif key == 'categories':
            prefs.set_categories(value)
        elif key == 'events':
            # Per-event override map (plan 24 Phase 2) — hollow post-recovery.
            prefs.set_events(value)
        else:
            setattr(prefs, key, value)
    db.session.commit()
    return prefs


def _channels_for(user):
    return {d.channel for d in NotificationDelivery.query
            .filter_by(recipient_user_id=user.id).all()}


def _clear():
    NotificationDelivery.query.delete()
    Notification.query.delete()
    db.session.commit()


# ---------------------------------------------------------------------------
# surviving: severity / category gating + critical-always invariant
# ---------------------------------------------------------------------------

def test_critical_always_delivers_even_when_severity_muted():
    """The critical-always invariant: a 'critical' severity reaches the user
    even when their severity prefs would otherwise mute it."""
    u = _make_user()
    _prefs(u, enabled=True, severities=['info'])  # neither warning nor critical listed

    NotificationBusService.send('probe.event', to=u, severity='critical', category='system')
    assert 'email' in _channels_for(u)
    assert 'inapp' in _channels_for(u)


def test_noncritical_muted_by_severity_pref():
    u = _make_user()
    _prefs(u, enabled=True, severities=['info'])  # warning not listed

    NotificationBusService.send('probe.event', to=u, severity='warning', category='system')
    assert _channels_for(u) == set()


def test_muted_category_is_dropped():
    u = _make_user()
    _prefs(u, enabled=True,
           categories={'system': False, 'security': True, 'backups': True, 'apps': True})

    NotificationBusService.send('probe.event', to=u, severity='warning', category='system')
    assert _channels_for(u) == set()


def test_backcompat_row_without_events_map_resolves_by_prefs():
    """Back-compat: a preferences row with no per-event override map still
    resolves purely off the user's severity/category prefs."""
    u = _make_user()
    _prefs(u, enabled=True)  # defaults: severities critical+warning, all categories on

    NotificationBusService.send('probe.event', to=u, severity='warning', category='apps')
    assert 'email' in _channels_for(u)


# ---------------------------------------------------------------------------
# hollow: user per-event override tier (events_json / set_events)
# ---------------------------------------------------------------------------

@pytest.mark.skip(reason="plan 42: hollow feature - NotificationPreferences.events_json "
                         "column + set_events() and the per-event override tier in "
                         "NotificationBusService._plan were lost in the data loss")
def test_per_event_override_beats_category_pref():
    u = _make_user()
    # Category 'apps' muted at the category tier, but explicitly on for this event.
    _prefs(u, enabled=True,
           categories={'system': True, 'security': True, 'backups': True, 'apps': False},
           events={'app.deployed': {'channels': ['email']}})

    NotificationBusService.send('app.deployed', to=u, category='apps', severity='info')
    assert 'email' in _channels_for(u)  # per-event override wins over category mute


# ---------------------------------------------------------------------------
# hollow: org default tier (SettingsService-driven default channels)
# ---------------------------------------------------------------------------

@pytest.mark.skip(reason="plan 42: hollow feature - resolution never consults "
                         "SettingsService for an org-wide default-channels tier; that "
                         "layer did not survive the data loss")
class TestOrgDefaults:
    def test_org_default_channels_apply_when_user_has_none(self):
        SettingsService.set('notifications.default_channels', ['email'])
        u = _make_user()
        _prefs(u, enabled=True, channels=[])  # user sets no channels
        NotificationBusService.send('probe.event', to=u, severity='warning', category='system')
        assert 'email' in _channels_for(u)  # falls back to org default
