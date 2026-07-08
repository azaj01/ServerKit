"""Proving tests for notification digest rollups (plan 24 Phase 3).

Reconstructed alongside the lost ``app/notifications/digest.py``; no surviving
test, so this file is the executable contract for cadence windows, grouping,
the empty/single-item guards, and the queued_digest -> sent flip.
"""
from datetime import datetime, timedelta

import pytest
from werkzeug.security import generate_password_hash

from app import db
from app.models import User
from app.models.notification_preferences import NotificationPreferences
from app.notifications import digest
from app.notifications.models import Notification, NotificationDelivery


@pytest.fixture(autouse=True)
def _capture_transmit(monkeypatch):
    """Capture the outgoing digest email instead of hitting a real transport."""
    sent = {}

    def fake_transmit(to_addr, rendered):
        sent['to'] = to_addr
        sent['rendered'] = rendered
        return True, 'digest-msg-1', None

    monkeypatch.setattr(digest, '_transmit', fake_transmit)
    return sent


def _user(username='dg', cadence='daily', last_sent=None):
    u = User(email=f'{username}@t.local', username=username,
             password_hash=generate_password_hash('x'), role='developer', is_active=True)
    db.session.add(u)
    db.session.commit()
    prefs = NotificationPreferences.get_or_create(u.id)
    prefs.digest_cadence = cadence
    prefs.digest_last_sent_at = last_sent
    db.session.commit()
    return u


def _queue(user, event='backup.completed', category='backups', severity='success',
           title='Backup completed: blog', when=None):
    """Create a notification + a queued_digest email delivery for the user."""
    n = Notification(event_key=event, category=category, severity=severity, title=title)
    n.set_data({'message': title})
    if when is not None:
        n.created_at = when
    db.session.add(n)
    db.session.flush()
    d = NotificationDelivery(
        notification_id=n.id, recipient_user_id=user.id,
        channel=NotificationDelivery.CHANNEL_EMAIL, target=user.email,
        status=NotificationDelivery.STATUS_QUEUED_DIGEST,
    )
    db.session.add(d)
    db.session.commit()
    return d


# --------------------------------------------------------------------------- #
# Cadence windows
# --------------------------------------------------------------------------- #

def test_is_due_windows(app):
    off = _user('off_u', cadence='off')
    assert digest.is_due(NotificationPreferences.get_or_create(off.id)) is False

    fresh = _user('fresh_u', cadence='daily', last_sent=None)
    assert digest.is_due(NotificationPreferences.get_or_create(fresh.id)) is True

    recent = _user('recent_u', cadence='daily',
                   last_sent=datetime.utcnow() - timedelta(hours=1))
    assert digest.is_due(NotificationPreferences.get_or_create(recent.id)) is False

    stale = _user('stale_u', cadence='daily',
                  last_sent=datetime.utcnow() - timedelta(days=2))
    assert digest.is_due(NotificationPreferences.get_or_create(stale.id)) is True

    weekly_mid = _user('weekly_u', cadence='weekly',
                       last_sent=datetime.utcnow() - timedelta(days=3))
    assert digest.is_due(NotificationPreferences.get_or_create(weekly_mid.id)) is False


# --------------------------------------------------------------------------- #
# Send + flip
# --------------------------------------------------------------------------- #

def test_send_groups_flips_and_stamps(app, _capture_transmit):
    u = _user('grp')
    d1 = _queue(u, category='backups', severity='success', title='Backup completed: blog')
    d2 = _queue(u, event='security.alert', category='security', severity='critical',
                title='Security alert: brute force')
    d3 = _queue(u, event='app.deployed', category='apps', severity='success',
                title='Deployed: api')

    result = digest.send_user_digest(u.id)
    assert result['sent'] is True
    assert result['count'] == 3
    assert '3 updates' in result['subject']
    assert result['message_id'] == 'digest-msg-1'

    # All held deliveries flipped to sent with the digest's message id.
    for d in (d1, d2, d3):
        db.session.refresh(d)
        assert d.status == NotificationDelivery.STATUS_SENT
        assert d.provider_message_id == 'digest-msg-1'
        assert d.sent_at is not None

    # Clock stamped so the next tick won't re-send.
    prefs = NotificationPreferences.get_or_create(u.id)
    assert prefs.digest_last_sent_at is not None

    # Rendered HTML actually grouped by category (real template render).
    html = _capture_transmit['rendered']['html']
    assert 'Security' in html and 'Backups' in html and 'Apps' in html
    assert 'Security alert: brute force' in html
    assert _capture_transmit['to'] == u.email


def test_empty_digest_never_sends(app, _capture_transmit):
    u = _user('empty')
    result = digest.send_user_digest(u.id)
    assert result['sent'] is False
    assert result['reason'] == 'empty'
    # No transport call, no clock stamp.
    assert 'to' not in _capture_transmit
    prefs = NotificationPreferences.get_or_create(u.id)
    assert prefs.digest_last_sent_at is None


def test_single_item_uses_its_own_subject(app, _capture_transmit):
    u = _user('single')
    _queue(u, category='backups', title='Backup completed: solo-site')
    result = digest.send_user_digest(u.id)
    assert result['sent'] is True
    assert result['count'] == 1
    assert result['subject'] == 'Backup completed: solo-site'  # no "1 update" shame


def test_transient_send_failure_leaves_deliveries_queued(app, monkeypatch):
    u = _user('fail')
    d = _queue(u)
    monkeypatch.setattr(digest, '_transmit',
                        lambda to, rendered: (False, None, 'smtp down'))
    result = digest.send_user_digest(u.id)
    assert result['sent'] is False
    db.session.refresh(d)
    # Still queued for the next attempt — not marked sent.
    assert d.status == NotificationDelivery.STATUS_QUEUED_DIGEST
    prefs = NotificationPreferences.get_or_create(u.id)
    assert prefs.digest_last_sent_at is None


# --------------------------------------------------------------------------- #
# The hourly tick
# --------------------------------------------------------------------------- #

def test_run_due_only_mails_elapsed_users(app):
    due = _user('due_u', cadence='daily', last_sent=None)
    _queue(due)

    not_due = _user('notdue_u', cadence='daily',
                    last_sent=datetime.utcnow() - timedelta(minutes=5))
    _queue(not_due)

    off = _user('off2_u', cadence='off')
    _queue(off)

    summary = digest.run_due()
    assert summary['sent'] == 1  # only the elapsed daily user

    # The due user's delivery is sent; the others remain queued.
    due_deliveries = digest.pending_for_user(due.id)
    assert due_deliveries == []  # flipped out of queued_digest
    assert len(digest.pending_for_user(not_due.id)) == 1
    assert len(digest.pending_for_user(off.id)) == 1


def test_run_due_skips_users_with_no_pending(app):
    """A user whose window elapsed but has nothing queued is skipped (empty
    never sends) and their clock is NOT stamped."""
    u = _user('nopending', cadence='daily', last_sent=None)
    summary = digest.run_due()
    assert summary['sent'] == 0
    assert summary['skipped'] >= 1
    prefs = NotificationPreferences.get_or_create(u.id)
    assert prefs.digest_last_sent_at is None
