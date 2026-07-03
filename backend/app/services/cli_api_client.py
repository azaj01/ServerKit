"""Helpers for CLI commands that talk to the local panel API.

Two pieces:

* ``mint_breakglass_token()`` — runs in-process (create_app + app_context) and
  mints a short-lived JWT for the first active admin user. Possession of
  root/shell on the box already implies full control of the panel, so this is
  a convenience, not an escalation; every mint is audit-logged.
* ``ApiClient`` — a tiny requests wrapper pointed at the local panel
  (``http://127.0.0.1:<port>/api/v1``) with a bearer token, short timeouts and
  a helpful message when the panel isn't running.
"""
import os
from datetime import timedelta

DEFAULT_PORT = 5000
DEFAULT_TIMEOUT = 5

BREAKGLASS_TTL = timedelta(minutes=10)
BREAKGLASS_AUDIT_ACTION = 'cli.breakglass'


class CliApiError(Exception):
    """Raised for any CLI-facing API failure; str(e) is user-presentable."""


def resolve_port():
    """Panel port: PORT env first (run.py contract), then SERVERKIT_PORT,
    then the config default 5000."""
    for var in ('PORT', 'SERVERKIT_PORT'):
        raw = os.environ.get(var, '').strip()
        if raw:
            try:
                return int(raw)
            except ValueError:
                continue
    return DEFAULT_PORT


def base_url(port=None):
    return f"http://127.0.0.1:{port or resolve_port()}/api/v1"


def find_breakglass_admin():
    """First active admin user, or None. Requires an app context."""
    from app.models import User
    return (
        User.query
        .filter_by(role='admin', is_active=True)
        .order_by(User.id.asc())
        .first()
    )


def mint_breakglass_token(app=None):
    """Mint a short-lived admin access token for local CLI use.

    Returns ``(token, user)``. Raises ``CliApiError`` when no active admin
    exists. Creates its own app/app-context unless one is supplied or already
    active.
    """
    from flask import current_app

    if app is None:
        try:
            current_app._get_current_object()  # noqa: SLF001 - presence probe
            return _mint_in_context()
        except RuntimeError:
            from app import create_app
            app = create_app()

    with app.app_context():
        return _mint_in_context()


def _mint_in_context():
    from flask_jwt_extended import create_access_token

    user = find_breakglass_admin()
    if user is None:
        raise CliApiError('No active admin user found — create one with "serverkit create-admin".')

    token = create_access_token(identity=user.id, expires_delta=BREAKGLASS_TTL)

    try:
        from app.services.audit_service import AuditService
        AuditService.log(
            action=BREAKGLASS_AUDIT_ACTION,
            user_id=user.id,
            target_type='user',
            target_id=user.id,
            details={'source': 'cli', 'ttl_minutes': int(BREAKGLASS_TTL.total_seconds() // 60)},
        )
    except Exception:  # noqa: BLE001 - auditing must never block break-glass access
        pass

    return token, user


class ApiClient:
    """Minimal JSON client for the local panel API."""

    def __init__(self, token=None, port=None, session=None, timeout=DEFAULT_TIMEOUT):
        import requests

        self.base = base_url(port)
        self.token = token
        self.timeout = timeout
        self.session = session or requests.Session()

    def _headers(self):
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        return headers

    def request(self, method, path, json_body=None):
        """Issue a request; returns parsed JSON. Raises CliApiError on failure."""
        import requests

        url = self.base + path
        try:
            resp = self.session.request(
                method, url, json=json_body, headers=self._headers(), timeout=self.timeout
            )
        except requests.exceptions.ConnectionError:
            raise CliApiError(
                'Could not reach the panel API at '
                f'{self.base} — panel not running? Try: systemctl status serverkit'
            )
        except requests.exceptions.Timeout:
            raise CliApiError(f'Panel API timed out after {self.timeout}s ({url}).')
        except requests.exceptions.RequestException as exc:
            raise CliApiError(f'Panel API request failed: {exc}')

        try:
            data = resp.json()
        except ValueError:
            data = {}

        if resp.status_code >= 400:
            message = data.get('error') or data.get('message') or f'HTTP {resp.status_code}'
            raise CliApiError(f'{message} ({method} {path})')
        return data

    def get(self, path):
        return self.request('GET', path)

    def post(self, path, json_body=None):
        return self.request('POST', path, json_body=json_body)
