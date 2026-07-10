"""Bounce / complaint suppression service (plan 33 Phase 4, roadmap #24).

Turns an inbound provider webhook (SendGrid / Postmark / SES / Mailgun / a
generic shape) into ``EmailBounceState`` rows. Provider payloads are normalized
by :meth:`BounceService.map_payload` into a common
``{message_id, kind, reason, email}`` envelope; :meth:`record` upserts the
per-address state, correlates the event to the originating
``NotificationDelivery`` by provider message-id, and applies the auto-mute
policy (a hard bounce mutes after ``MUTE_THRESHOLD`` consecutive events; a spam
complaint mutes immediately). The bus's email channel calls
:meth:`is_muted` to skip a muted address.

Provider-agnostic by design: one adapter seam (``map_payload``) so a new
provider only adds a mapping branch — the panel already treats SMTP transport
as pluggable.
"""
from datetime import datetime

from app import db
from app.models.email_bounce import EmailBounceState
from app.notifications.models import NotificationDelivery

# Consecutive hard bounces before an address auto-mutes. A complaint mutes
# immediately regardless of this threshold.
MUTE_THRESHOLD = 3


def _norm_email(value):
    return (value or '').strip().lower() or None


class BounceService:
    MUTE_THRESHOLD = MUTE_THRESHOLD

    KIND_BOUNCE = EmailBounceState.KIND_BOUNCE
    KIND_COMPLAINT = EmailBounceState.KIND_COMPLAINT

    # ------------------------------------------------------------------
    # Provider payload mapping (the one adapter seam)
    # ------------------------------------------------------------------
    @staticmethod
    def map_payload(provider, payload):
        """Normalize ONE provider event into ``{message_id, kind, reason, email}``.

        Returns ``None`` when the event is not a bounce/complaint (e.g. a
        ``delivered`` webhook) so the caller can skip it. ``provider`` selects
        the mapping; unknown providers fall back to the generic shape.
        """
        if not isinstance(payload, dict):
            return None
        provider = (provider or 'generic').lower()
        mapper = {
            'sendgrid': BounceService._map_sendgrid,
            'postmark': BounceService._map_postmark,
            'ses': BounceService._map_ses,
            'mailgun': BounceService._map_mailgun,
        }.get(provider, BounceService._map_generic)
        mapped = mapper(payload)
        if not mapped:
            return None
        kind = mapped.get('kind')
        if kind not in (EmailBounceState.KIND_BOUNCE, EmailBounceState.KIND_COMPLAINT):
            return None
        email = _norm_email(mapped.get('email'))
        return {
            'message_id': (mapped.get('message_id') or '').strip() or None,
            'kind': kind,
            'reason': (mapped.get('reason') or None),
            'email': email,
        }

    @staticmethod
    def _map_generic(p):
        kind = (p.get('kind') or p.get('type') or '').strip().lower()
        if kind in ('complaint', 'complained', 'spam', 'spamreport'):
            kind = EmailBounceState.KIND_COMPLAINT
        elif kind in ('bounce', 'bounced', 'hard_bounce', 'failed', 'dropped'):
            kind = EmailBounceState.KIND_BOUNCE
        return {
            'message_id': p.get('message_id') or p.get('messageId'),
            'kind': kind,
            'reason': p.get('reason') or p.get('description'),
            'email': p.get('email') or p.get('recipient'),
        }

    @staticmethod
    def _map_sendgrid(p):
        event = (p.get('event') or '').strip().lower()
        if event in ('bounce', 'dropped'):
            kind = EmailBounceState.KIND_BOUNCE
        elif event in ('spamreport', 'spam_report'):
            kind = EmailBounceState.KIND_COMPLAINT
        else:
            return None
        return {
            'message_id': p.get('sg_message_id') or p.get('smtp-id') or p.get('message_id'),
            'kind': kind,
            'reason': p.get('reason') or p.get('type'),
            'email': p.get('email'),
        }

    @staticmethod
    def _map_postmark(p):
        record = (p.get('RecordType') or '').strip().lower()
        if record == 'bounce':
            kind = EmailBounceState.KIND_BOUNCE
        elif record == 'spamcomplaint':
            kind = EmailBounceState.KIND_COMPLAINT
        else:
            return None
        return {
            'message_id': p.get('MessageID'),
            'kind': kind,
            'reason': p.get('Description') or p.get('Details'),
            'email': p.get('Email'),
        }

    @staticmethod
    def _map_ses(p):
        ntype = (p.get('notificationType') or p.get('eventType') or '').strip().lower()
        mail = p.get('mail') or {}
        message_id = mail.get('messageId')
        if ntype == 'bounce':
            b = p.get('bounce') or {}
            recips = b.get('bouncedRecipients') or [{}]
            return {
                'message_id': message_id,
                'kind': EmailBounceState.KIND_BOUNCE,
                'reason': b.get('bounceSubType') or b.get('bounceType'),
                'email': recips[0].get('emailAddress'),
            }
        if ntype == 'complaint':
            c = p.get('complaint') or {}
            recips = c.get('complainedRecipients') or [{}]
            return {
                'message_id': message_id,
                'kind': EmailBounceState.KIND_COMPLAINT,
                'reason': c.get('complaintFeedbackType') or 'complaint',
                'email': recips[0].get('emailAddress'),
            }
        return None

    @staticmethod
    def _map_mailgun(p):
        data = p.get('event-data') or p
        event = (data.get('event') or '').strip().lower()
        if event in ('failed', 'bounced'):
            kind = EmailBounceState.KIND_BOUNCE
        elif event == 'complained':
            kind = EmailBounceState.KIND_COMPLAINT
        else:
            return None
        headers = ((data.get('message') or {}).get('headers')) or {}
        return {
            'message_id': headers.get('message-id') or data.get('id'),
            'kind': kind,
            'reason': data.get('reason') or (data.get('delivery-status') or {}).get('description'),
            'email': data.get('recipient'),
        }

    # ------------------------------------------------------------------
    # Recording + correlation
    # ------------------------------------------------------------------
    @staticmethod
    def _delivery_for(message_id):
        if not message_id:
            return None
        return (NotificationDelivery.query
                .filter_by(provider_message_id=message_id)
                .order_by(NotificationDelivery.id.desc())
                .first())

    @staticmethod
    def record(mapped):
        """Record one normalized bounce/complaint event.

        Correlates to the originating delivery by ``message_id`` — when the
        provider omits the recipient, the address is recovered from the matched
        ``NotificationDelivery.target``. Returns the ``EmailBounceState`` (or
        ``None`` if no address could be resolved).
        """
        if not mapped:
            return None
        kind = mapped.get('kind')
        message_id = mapped.get('message_id')
        delivery = BounceService._delivery_for(message_id)

        email = mapped.get('email')
        if not email and delivery is not None:
            email = _norm_email(delivery.target)
        email = _norm_email(email)
        if not email:
            return None

        now = datetime.utcnow()
        state = EmailBounceState.query.filter_by(email=email).first()
        if state is None:
            state = EmailBounceState(email=email, consecutive_bounces=0, total_events=0)
            db.session.add(state)

        state.total_events = (state.total_events or 0) + 1
        state.last_kind = kind
        state.last_reason = (mapped.get('reason') or None)
        if state.last_reason:
            state.last_reason = state.last_reason[:500]
        state.last_event_at = now

        if kind == EmailBounceState.KIND_COMPLAINT:
            # A spam complaint mutes immediately.
            if not state.muted:
                state.muted = True
                state.muted_at = now
        else:
            state.consecutive_bounces = (state.consecutive_bounces or 0) + 1
            if state.consecutive_bounces >= MUTE_THRESHOLD and not state.muted:
                state.muted = True
                state.muted_at = now

        db.session.commit()
        return state

    @staticmethod
    def ingest(provider, payload):
        """Map + record every bounce/complaint in a webhook payload.

        Accepts either a single event dict or a list of them (e.g. SendGrid
        batches). Returns the list of recorded ``EmailBounceState`` rows.
        """
        events = payload if isinstance(payload, list) else [payload]
        recorded = []
        for ev in events:
            mapped = BounceService.map_payload(provider, ev)
            if not mapped:
                continue
            state = BounceService.record(mapped)
            if state is not None:
                recorded.append(state)
        return recorded

    # ------------------------------------------------------------------
    # Queries used by the bus + the API surface
    # ------------------------------------------------------------------
    @staticmethod
    def state_for(email):
        email = _norm_email(email)
        if not email:
            return None
        return EmailBounceState.query.filter_by(email=email).first()

    @staticmethod
    def is_muted(email):
        state = BounceService.state_for(email)
        return bool(state and state.muted)

    @staticmethod
    def unmute(email):
        """Clear the mute + bounce streak for an address. Returns the row or None."""
        state = BounceService.state_for(email)
        if state is None:
            return None
        state.muted = False
        state.muted_at = None
        state.consecutive_bounces = 0
        db.session.commit()
        return state

    @staticmethod
    def list_bouncing(muted_only=True):
        """All addresses with a recorded bounce state (muted first)."""
        q = EmailBounceState.query
        if muted_only:
            q = q.filter_by(muted=True)
        return q.order_by(EmailBounceState.last_event_at.desc().nullslast()).all()
