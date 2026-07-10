"""Tests for the security-posture setup items + the require-2FA policy
(plan 22 Phase 5): the enrollment-state matrix, login enforcement (nudge vs
enforce vs SSO-exempt), and the account-security snooze round trip.

Reconstructed for plan 42 Phase 1 from the fragmented ``test_setup_security`` pyc
+ the surviving ``security_policy_service`` / ``setup_health_service``. The pyc
called a ``enrollment_state`` classmethod; the surviving service exposes the same
ok/nudge/enforce evaluation as ``SecurityPolicyService.evaluate`` (the method was
renamed and the grace window is now a fixed ``GRACE_PERIOD_DAYS`` anchored on
``max(created_at, policy_enabled_at)`` rather than a ``*_grace_days`` setting).
The reconstructed tests track that current contract.
"""
from datetime import datetime, timedelta

from app.services.security_policy_service import (
    SETTING_ENABLED_AT,
    SecurityPolicyService,
)
from app.services.setup_health_service import SetupHealthService


def _mk_user(db, username, *, totp=False, active=True, created_days_ago=0,
             auth_provider='local'):
    from app.models import User
    from werkzeug.security import generate_password_hash
    u = User(email=f'{username}@t.local', username=username,
             password_hash=generate_password_hash('pw'), role='developer',
             is_active=active, totp_enabled=totp, auth_provider=auth_provider)
    u.created_at = datetime.utcnow() - timedelta(days=created_days_ago)
    db.session.add(u)
    db.session.commit()
    return u


def _set_policy(on, *, enabled_days_ago=None):
    """Turn the require-2FA policy on/off. When ``enabled_days_ago`` is given the
    activation stamp is back-dated to exercise the grace window from activation."""
    from app.services.settings_service import SettingsService
    SecurityPolicyService.set_require_2fa(on)
    if on and enabled_days_ago is not None:
        stamp = (datetime.utcnow() - timedelta(days=enabled_days_ago)).isoformat()
        SettingsService.set(SETTING_ENABLED_AT, stamp)


def test_policy_off_is_always_ok(app):
    """With the policy off, every account evaluates 'ok' regardless of 2FA."""
    from app import db
    _set_policy(False)
    u_off = _mk_user(db, 'sec_off', totp=False, created_days_ago=0)
    assert SecurityPolicyService.evaluate(u_off) == SecurityPolicyService.OK


def test_veteran_account_gets_full_grace_on_policy_flip(app):
    """Flipping the policy ON never insta-locks a long-lived account: the grace
    window is anchored on activation, so a veteran gets the full grace → nudge."""
    from app import db
    veteran = _mk_user(db, 'sec_vet', totp=False, created_days_ago=400)
    _set_policy(True)  # stamps activation = now
    assert SecurityPolicyService.evaluate(veteran) == SecurityPolicyService.NUDGE


def test_grace_enforces_past_window_from_activation(app):
    """Once the grace days elapse *since activation*, even a veteran account is
    enforced (activation stamped in the past, grace exceeded)."""
    from app import db
    veteran = _mk_user(db, 'sec_late', totp=False, created_days_ago=400)
    grace_later = SecurityPolicyService.GRACE_PERIOD_DAYS + 5
    _set_policy(True, enabled_days_ago=grace_later)
    assert SecurityPolicyService.evaluate(veteran) == SecurityPolicyService.ENFORCE


def test_sso_account_is_exempt(app):
    """An SSO account delegates the second factor to its IdP → policy-exempt."""
    from app import db
    sso = _mk_user(db, 'sec_sso', totp=False, created_days_ago=400,
                   auth_provider='oidc')
    _set_policy(True, enabled_days_ago=SecurityPolicyService.GRACE_PERIOD_DAYS + 5)
    assert SecurityPolicyService.evaluate(sso) == SecurityPolicyService.OK


def test_account_security_snooze_round_trip(app, client):
    """Dismissing the nudge snoozes ``setup.account_security`` on the account row;
    the account endpoint then reports it snoozed, and un-snoozing clears it."""
    from app import db
    from flask_jwt_extended import create_access_token
    user = _mk_user(db, 'sec_snooze', totp=False)
    hdrs = {'Authorization': f'Bearer {create_access_token(identity=user.id)}'}

    def acct_item():
        r = client.get('/api/v1/setup-health/account', headers=hdrs)
        assert r.status_code == 200
        items = {c['key']: c for c in r.get_json()['items']}
        return items['setup.account_security']

    assert acct_item().get('snoozed') is not True

    r = client.post('/api/v1/setup-health/snooze', headers=hdrs,
                    json={'key': 'setup.account_security'})
    assert r.status_code == 200
    assert acct_item()['snoozed'] is True

    r = client.delete('/api/v1/setup-health/snooze', headers=hdrs,
                      json={'key': 'setup.account_security'})
    assert r.status_code == 200
    assert acct_item()['snoozed'] is False
