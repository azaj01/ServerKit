"""Deep-link helpers for notifications (plan 24).

A notification's ``action_path`` is stored relative (e.g. ``/domains``) so a
route move never breaks old rows. For channels that need an absolute URL (email,
chat) we resolve it against the panel's canonical domain at render time.
"""
import logging

logger = logging.getLogger(__name__)


def panel_base_url():
    """Absolute base URL of the panel, or '' when no canonical domain is set."""
    try:
        from app.services.settings_service import SettingsService
        domain = (SettingsService.get('canonical_domain', '') or '').strip()
        if not domain:
            return ''
        scheme = 'https' if SettingsService.get('canonical_https_enabled', False) else 'http'
        return f'{scheme}://{domain}'
    except Exception:  # pragma: no cover - settings unavailable
        return ''


def absolute_url(path):
    """Turn an ``action_path`` into an absolute URL. Returns None for a falsy
    path; returns the path unchanged if already absolute or if no base is set."""
    if not path:
        return None
    if path.startswith('http://') or path.startswith('https://'):
        return path
    base = panel_base_url()
    if not base:
        return path  # relative fallback — the in-app bell is the primary surface
    return base.rstrip('/') + '/' + path.lstrip('/')


def manage_url():
    """The 'manage notifications' footer link, absolute when possible."""
    resolved = absolute_url('/settings/notifications')
    return resolved if (resolved and resolved.startswith('http')) else None
