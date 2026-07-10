"""Bounce / complaint suppression (plan 33 Phase 4, roadmap #24).

Restored in plan 42 Phase 3. Proves the ``EmailBounceState`` model round-trip,
the provider-agnostic payload mapping, the signed inbound webhook (404 while
unconfigured, signature rejection, records + correlates by provider message-id),
the auto-mute threshold + complaint-immediate-mute + unmute, and that a muted
address is skipped by the bus's email channel.
"""
import hashlib
import hmac
import json

import pytest

from app import db
from app.models import User
from app.models.email_bounce import EmailBounceState
from app.notifications.models import Notification, NotificationDelivery
from app.services.bounce_service import BounceService, MUTE_THRESHOLD
from app.services.settings_service import SettingsService

SECRET = 'test-inbound-secret'
INBOUND_URL = '/api/v1/notifications/inbound/email'


def _sign(body_bytes):
    return 'sha256=' + hmac.new(SECRET.encode(), body_bytes, hashlib.sha256).hexdigest()


def _configure_secret(app):
    with app.app_context():
        SettingsService.set('notify.inbound_secret', SECRET)


def _post_signed(client, payload, provider='generic'):
    body = json.dumps(payload).encode('utf-8')
    return client.post(
        f'{INBOUND_URL}?provider={provider}',
        data=body,
        content_type='application/json',
        headers={'X-ServerKit-Signature': _sign(body)},
    )


# ----------------------------------------------------------------------
# Model
# ----------------------------------------------------------------------

class TestModel:
    def test_round_trip(self, app):
        with app.app_context():
            st = EmailBounceState(email='a@example.com', consecutive_bounces=2,
                                  total_events=2, muted=True)
            db.session.add(st)
            db.session.commit()
            d = st.to_dict()
            assert d['email'] == 'a@example.com'
            assert d['muted'] is True
            assert d['consecutive_bounces'] == 2
            assert d['total_events'] == 2
            assert d['muted_at'] is None  # never set
            assert 'EmailBounceState' in repr(st)


# ----------------------------------------------------------------------
# Payload mapping (the adapter seam)
# ----------------------------------------------------------------------

class TestPayloadMapping:
    def test_generic_normalizes_email(self):
        mapped = BounceService.map_payload('generic', {
            'message_id': 'm1', 'kind': 'bounce',
            'reason': 'mailbox full', 'email': 'A@Example.com',
        })
        assert mapped == {
            'message_id': 'm1', 'kind': 'bounce',
            'reason': 'mailbox full', 'email': 'a@example.com',
        }

    def test_non_bounce_event_ignored(self):
        assert BounceService.map_payload('generic', {'kind': 'delivered'}) is None

    def test_sendgrid_spamreport_is_complaint(self):
        mapped = BounceService.map_payload('sendgrid', {
            'event': 'spamreport', 'email': 'x@example.com', 'sg_message_id': 'sg1',
        })
        assert mapped['kind'] == EmailBounceState.KIND_COMPLAINT
        assert mapped['message_id'] == 'sg1'

    def test_postmark_bounce(self):
        mapped = BounceService.map_payload('postmark', {
            'RecordType': 'Bounce', 'Email': 'p@example.com',
            'MessageID': 'pm1', 'Description': 'blocked',
        })
        assert mapped['kind'] == EmailBounceState.KIND_BOUNCE
        assert mapped['email'] == 'p@example.com'


# ----------------------------------------------------------------------
# Inbound webhook
# ----------------------------------------------------------------------

class TestInboundWebhook:
    def test_404_when_unconfigured(self, client):
        r = client.post(INBOUND_URL, data=b'{}', content_type='application/json')
        assert r.status_code == 404

    def test_401_on_bad_signature(self, app, client):
        _configure_secret(app)
        body = json.dumps({'kind': 'bounce', 'email': 'z@example.com'}).encode()
        r = client.post(INBOUND_URL, data=body, content_type='application/json',
                        headers={'X-ServerKit-Signature': 'sha256=deadbeef'})
        assert r.status_code == 401

    def test_records_with_valid_signature(self, app, client):
        _configure_secret(app)
        r = _post_signed(client, {
            'message_id': 'gen-1', 'kind': 'bounce',
            'reason': 'mailbox full', 'email': 'webhook@example.com',
        })
        assert r.status_code == 200
        body = r.get_json()
        assert body['recorded'] is True
        assert body['events'] == 1
        with app.app_context():
            st = EmailBounceState.query.filter_by(email='webhook@example.com').first()
            assert st is not None
            assert st.total_events == 1
            assert st.last_reason == 'mailbox full'

    def test_correlates_to_delivery_by_message_id(self, app, client):
        _configure_secret(app)
        with app.app_context():
            n = Notification(event_key='test.event', title='t')
            db.session.add(n)
            db.session.commit()
            d = NotificationDelivery(
                notification_id=n.id, channel='email',
                target='recipient@example.com', provider_message_id='corr-42')
            db.session.add(d)
            db.session.commit()

        # Payload carries the provider message-id but NO recipient — the address
        # must be recovered from the correlated delivery.
        r = _post_signed(client, {'message_id': 'corr-42', 'kind': 'bounce'})
        assert r.status_code == 200
        with app.app_context():
            st = EmailBounceState.query.filter_by(email='recipient@example.com').first()
            assert st is not None
            assert st.total_events == 1


# ----------------------------------------------------------------------
# Mute policy + bus skip + API surface
# ----------------------------------------------------------------------

class TestMuteAndApi:
    def test_bounce_threshold_auto_mutes(self, app):
        with app.app_context():
            for _ in range(MUTE_THRESHOLD):
                BounceService.record({'message_id': None, 'kind': 'bounce',
                                       'reason': 'x', 'email': 'hard@example.com'})
            assert BounceService.is_muted('hard@example.com') is True
            st = BounceService.state_for('hard@example.com')
            assert st.consecutive_bounces == MUTE_THRESHOLD

    def test_bounce_below_threshold_not_muted(self, app):
        with app.app_context():
            BounceService.record({'message_id': None, 'kind': 'bounce',
                                  'reason': 'x', 'email': 'soft@example.com'})
            assert BounceService.is_muted('soft@example.com') is False

    def test_complaint_mutes_immediately(self, app):
        with app.app_context():
            BounceService.record({'message_id': None, 'kind': 'complaint',
                                  'reason': 'spam', 'email': 'spam@example.com'})
            assert BounceService.is_muted('spam@example.com') is True

    def test_muted_address_skipped_by_email_channel(self, app):
        from app.notifications.channels.email import EmailAdapter
        with app.app_context():
            BounceService.record({'message_id': None, 'kind': 'complaint',
                                  'reason': 'spam', 'email': 'muted@example.com'})
            n = Notification(event_key='test.event', title='t')
            db.session.add(n)
            db.session.commit()
            d = NotificationDelivery(notification_id=n.id, channel='email',
                                     target='muted@example.com')
            db.session.add(d)
            db.session.commit()
            result = EmailAdapter().deliver(d, n)
            assert result.status == NotificationDelivery.STATUS_SKIPPED

    def test_unmute_own_email(self, app, client, auth_headers):
        with app.app_context():
            BounceService.record({'message_id': None, 'kind': 'complaint',
                                  'reason': 'spam', 'email': 'testadmin@test.local'})
            assert BounceService.is_muted('testadmin@test.local') is True
        r = client.post('/api/v1/notifications/preferences/email/unmute',
                        headers=auth_headers)
        assert r.status_code == 200
        assert r.get_json()['email_status']['muted'] is False
        with app.app_context():
            assert BounceService.is_muted('testadmin@test.local') is False

    def test_preferences_expose_email_status(self, app, client, auth_headers):
        with app.app_context():
            BounceService.record({'message_id': None, 'kind': 'bounce',
                                  'reason': 'x', 'email': 'testadmin@test.local'})
        r = client.get('/api/v1/notifications/preferences', headers=auth_headers)
        assert r.status_code == 200
        status = r.get_json()['email_status']
        assert status is not None
        assert status['email'] == 'testadmin@test.local'

    def test_admin_lists_bouncing(self, app, client, auth_headers):
        with app.app_context():
            BounceService.record({'message_id': None, 'kind': 'complaint',
                                  'reason': 'spam', 'email': 'dead@example.com'})
        r = client.get('/api/v1/notifications/admin/bouncing', headers=auth_headers)
        assert r.status_code == 200
        assert 'dead@example.com' in r.get_json()['emails']
