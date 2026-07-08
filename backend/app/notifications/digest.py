"""Notification digest rollups — per-user cadence (plan 24 Phase 3).

Instead of one email per event, a user can opt into a *digest*: the bus routes
digestable deliveries (and quiet-hours catch-ups) onto the
``notification_deliveries`` table with status ``queued_digest`` (never enqueued),
and this job periodically groups a user's held deliveries into ONE branded email,
sends it, and flips those rows to ``sent`` with the digest's message id.

Cadence lives on ``NotificationPreferences.digest_cadence`` ('off'|'daily'|
'weekly'); ``digest_last_sent_at`` records the last send so the hourly tick only
mails a user once their window has elapsed.

Guards (Decision 3 / #9): an empty digest never sends (and never stamps the
clock, so nothing is silently swallowed); a one-item digest borrows that item's
own subject line rather than shaming the reader with a "1 update" email.

Entry points:
  - ``run_due(now=None)``      — the hourly tick; mails every user whose window
                                 elapsed. This is what the ScheduledJob calls.
  - ``send_user_digest(uid)``  — build + send one user's digest now.
  - ``run_digest_job(work_unit=None)`` — job-handler-shaped wrapper for run_due.
"""
import logging
from collections import OrderedDict
from datetime import datetime, timedelta

from app import db
from app.models.notification_preferences import NotificationPreferences
from app.models.user import User
from app.notifications import rendering
from app.notifications.models import Notification, NotificationDelivery

logger = logging.getLogger(__name__)

# How long between digests for each cadence.
_CADENCE_DELTA = {
    'daily': timedelta(days=1),
    'weekly': timedelta(days=7),
}

# Preference categories -> human labels for the digest section headers.
_CATEGORY_LABELS = {
    'system': 'System',
    'security': 'Security',
    'backups': 'Backups',
    'apps': 'Apps',
}
# Deterministic section order (unknown categories append, alpha).
_CATEGORY_ORDER = ['security', 'backups', 'apps', 'system']


# --------------------------------------------------------------------------- #
# Selection
# --------------------------------------------------------------------------- #

def pending_for_user(user_id):
    """This user's held (``queued_digest``) email deliveries, oldest first."""
    return (NotificationDelivery.query
            .filter_by(recipient_user_id=user_id,
                       channel=NotificationDelivery.CHANNEL_EMAIL,
                       status=NotificationDelivery.STATUS_QUEUED_DIGEST)
            .order_by(NotificationDelivery.created_at.asc())
            .all())


def _cadence_delta(cadence):
    return _CADENCE_DELTA.get((cadence or 'off').strip().lower())


def is_due(prefs, now=None):
    """Whether ``prefs``' digest window has elapsed (or never sent)."""
    delta = _cadence_delta(prefs.digest_cadence)
    if delta is None:  # 'off' or unknown -> never due
        return False
    if prefs.digest_last_sent_at is None:
        return True
    return (now or datetime.utcnow()) - prefs.digest_last_sent_at >= delta


# --------------------------------------------------------------------------- #
# Build + render
# --------------------------------------------------------------------------- #

def build_digest(user, deliveries):
    """Group ``deliveries`` (with their notifications) into digest sections.

    Returns ``{'subject', 'groups', 'total', 'user'}`` or None if nothing to
    say (all deliveries orphaned of their notification)."""
    buckets = OrderedDict()
    total = 0
    first_title = None
    for delivery in deliveries:
        notification = delivery.notification
        if notification is None:
            continue
        total += 1
        if first_title is None:
            first_title = notification.title
        category = notification.category or 'system'
        buckets.setdefault(category, []).append({
            'severity': notification.severity or 'info',
            'title': notification.title,
            'when': notification.created_at.strftime('%b %d, %H:%M') if notification.created_at else None,
            'action_url': notification.action_path or None,
        })

    if total == 0:
        return None

    ordered = sorted(
        buckets.items(),
        key=lambda kv: (_CATEGORY_ORDER.index(kv[0]) if kv[0] in _CATEGORY_ORDER
                        else len(_CATEGORY_ORDER), kv[0]),
    )
    groups = [{'label': _CATEGORY_LABELS.get(cat, cat.replace('_', ' ').title()),
               'category': cat, 'items': items}
              for cat, items in ordered]

    # Single-item digests borrow the item's own subject (#9 — no "1 update" mail).
    if total == 1:
        subject = first_title
    else:
        subject = f'ServerKit digest — {total} updates'

    return {'subject': subject, 'groups': groups, 'total': total, 'user': user}


def render_digest(digest, manage_url=None):
    """Render a built digest to ``{'subject', 'html', 'text'}``."""
    user = digest['user']
    recipient = {'name': (user.username or user.email) if user else None,
                 'email': user.email if user else None}
    ctx = rendering._build_context(
        subject=digest['subject'], severity='info', data={},
        recipient=recipient, urls={'manage': manage_url}, hostname=None,
    )
    ctx['groups'] = digest['groups']
    ctx['total'] = digest['total']
    try:
        html = rendering.env().get_template('email/digest.html').render(**ctx)
    except Exception as exc:  # never let a template bug swallow the digest
        logger.warning('Digest template failed (%s); using generic body', exc)
        html = rendering.env().get_template('email/generic.html').render(**ctx)
    return {'subject': digest['subject'], 'html': html, 'text': _text_twin(digest)}


def _text_twin(digest):
    """Programmatic plain-text alternative (like rendering's fallback)."""
    lines = [digest['subject'], '=' * min(len(digest['subject']), 60), '']
    for group in digest['groups']:
        lines.append(group['label'].upper())
        for item in group['items']:
            when = f" ({item['when']})" if item.get('when') else ''
            lines.append(f"  - [{item['severity']}] {item['title']}{when}")
        lines.append('')
    lines.append('-' * 40)
    lines.append('Manage your digest cadence in ServerKit → Settings → Notifications.')
    return '\n'.join(lines)


# --------------------------------------------------------------------------- #
# Transport (seam — tests override this)
# --------------------------------------------------------------------------- #

def _transmit(to_addr, rendered):
    """Send the digest email. Returns ``(success, message_id, error)``.

    Prefers a configured EmailProviderConnection; otherwise falls back to the
    legacy notifications.json SMTP path (reusing the email channel adapter)."""
    from app.notifications.providers import EmailProviderService
    try:
        provider = EmailProviderService.default_provider()
    except Exception:
        provider = None
    if provider is not None:
        result = EmailProviderService.send(
            provider, to_addr, rendered['subject'], rendered['html'], rendered['text'])
        return bool(result.get('success')), result.get('message_id'), result.get('error')

    from app.notifications.channels.email import EmailAdapter
    res = EmailAdapter()._send_legacy_smtp(to_addr, rendered)
    return res.ok, res.message_id, res.error


# --------------------------------------------------------------------------- #
# Send
# --------------------------------------------------------------------------- #

def _digest_address(user, prefs):
    return (prefs.email if prefs else None) or (user.email if user else None)


def send_user_digest(user_id, now=None, stamp_clock=True):
    """Build + send one user's digest. Returns a result dict.

    On success: the digested deliveries flip to ``sent`` (carrying the digest's
    message id) and ``digest_last_sent_at`` is stamped. An empty digest is a
    no-op that neither sends nor stamps the clock."""
    now = now or datetime.utcnow()
    user = User.query.get(user_id)
    if user is None:
        return {'sent': False, 'reason': 'no user', 'count': 0}

    deliveries = pending_for_user(user_id)
    if not deliveries:
        return {'sent': False, 'reason': 'empty', 'count': 0}

    prefs = NotificationPreferences.get_or_create(user_id)
    to_addr = _digest_address(user, prefs)
    if not to_addr:
        return {'sent': False, 'reason': 'no email address', 'count': len(deliveries)}

    digest = build_digest(user, deliveries)
    if digest is None:  # deliveries all orphaned of notifications
        return {'sent': False, 'reason': 'empty', 'count': 0}

    rendered = render_digest(digest)
    success, message_id, error = _transmit(to_addr, rendered)
    if not success:
        return {'sent': False, 'reason': error or 'send failed',
                'count': len(deliveries)}

    sent_at = datetime.utcnow()
    for delivery in deliveries:
        delivery.status = NotificationDelivery.STATUS_SENT
        delivery.sent_at = sent_at
        delivery.provider_message_id = message_id
        delivery.error = None
    if stamp_clock:
        prefs.digest_last_sent_at = now
    db.session.commit()
    return {'sent': True, 'count': len(deliveries), 'subject': digest['subject'],
            'message_id': message_id}


def run_due(now=None):
    """Hourly tick: send a digest to every user whose cadence window elapsed."""
    now = now or datetime.utcnow()
    rows = (NotificationPreferences.query
            .filter(NotificationPreferences.digest_cadence.in_(tuple(_CADENCE_DELTA)))
            .all())
    sent = skipped = 0
    for prefs in rows:
        if not is_due(prefs, now=now):
            continue
        result = send_user_digest(prefs.user_id, now=now)
        if result.get('sent'):
            sent += 1
        else:
            skipped += 1
    return {'sent': sent, 'skipped': skipped, 'candidates': len(rows)}


def run_digest_job(work_unit=None):
    """ScheduledJob handler shape (kind ``notifications.digest.run``)."""
    return run_due()
