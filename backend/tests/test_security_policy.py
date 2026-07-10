"""Proving tests for SecurityPolicyService — the require-2FA enrollment policy
(plan 29 Phase 2: ok/nudge/enforce, SSO-exempt, activation-anchored grace).

Reconstructed alongside the lost service; there was no surviving test, so this
file is the executable contract.
"""
from datetime import datetime, timedelta

from werkzeug.security import generate_password_hash

from app import db
from app.models import User
from app.services.security_policy_service import (
    SecurityPolicyService as SPS,
    SETTING_ENABLED_AT,
    SETTING_REQUIRE_2FA,
)


def _user(username='u', *, provider='local', totp=False, created_days_ago=1):
    u = User(
        email=f'{username}@t.local', username=username,
        password_hash=generate_password_hash('x'), role='developer',
        is_active=True, auth_provider=provider, totp_enabled=totp,
        created_at=datetime.utcnow() - timedelta(days=created_days_ago),
    )
    db.session.add(u)
    db.session.commit()
    return u


def test_policy_off_is_always_ok(app):
    u = _user('off')
    assert SPS.require_2fa_enabled() is False
    assert SPS.evaluate(u) == SPS.OK


def test_enabling_stamps_activation_once(app):
    from app.services.settings_service import SettingsService
    assert SettingsService.get(SETTING_ENABLED_AT) in (None, '')
    SPS.set_require_2fa(True)
    first = SettingsService.get(SETTING_ENABLED_AT)
    assert first  # stamped on off->on
    # Re-affirming ON does not move the anchor.
    SPS.set_require_2fa(True)
    assert SettingsService.get(SETTING_ENABLED_AT) == first
    assert SPS.require_2fa_enabled() is True


def test_veteran_gets_full_grace_on_flip(app):
    """A 100-day-old account without 2FA is only NUDGEd right after the policy
    flips on — the grace clock starts at activation, not account age."""
    u = _user('vet', created_days_ago=100)
    SPS.set_require_2fa(True)
    assert SPS.evaluate(u) == SPS.NUDGE
    # ...and enforcement only bites once the window from activation elapses.
    past_window = datetime.utcnow() + timedelta(days=SPS.GRACE_PERIOD_DAYS + 1)
    assert SPS.evaluate(u, now=past_window) == SPS.ENFORCE


def test_enforced_after_grace(app):
    # Old account so the anchor is the (backdated) activation, not created_at.
    u = _user('late', created_days_ago=100)
    SPS.set_require_2fa(True)
    # Backdate the activation so the grace window is already gone.
    from app.services.settings_service import SettingsService
    SettingsService.set(
        SETTING_ENABLED_AT,
        (datetime.utcnow() - timedelta(days=SPS.GRACE_PERIOD_DAYS + 3)).isoformat(),
    )
    assert SPS.evaluate(u) == SPS.ENFORCE


def test_user_with_2fa_is_ok(app):
    u = _user('has2fa', totp=True)
    SPS.set_require_2fa(True)
    from app.services.settings_service import SettingsService
    SettingsService.set(
        SETTING_ENABLED_AT,
        (datetime.utcnow() - timedelta(days=99)).isoformat(),
    )
    # Even past the grace window, an enrolled user is fine.
    assert SPS.evaluate(u) == SPS.OK
    assert SPS.user_has_2fa(u) is True


def test_sso_user_is_exempt(app):
    u = _user('sso', provider='google')
    SPS.set_require_2fa(True)
    from app.services.settings_service import SettingsService
    SettingsService.set(
        SETTING_ENABLED_AT,
        (datetime.utcnow() - timedelta(days=99)).isoformat(),
    )
    assert SPS.is_sso_user(u) is True
    assert SPS.evaluate(u) == SPS.OK


def test_grace_anchor_is_max_of_created_and_activation(app):
    # Account younger than the policy activation -> anchor on the account.
    young = _user('young', created_days_ago=0)
    SPS.set_require_2fa(True)
    from app.services.settings_service import SettingsService
    activation = datetime.utcnow() - timedelta(days=30)
    SettingsService.set(SETTING_ENABLED_AT, activation.isoformat())
    anchor = SPS.grace_anchor(young)
    # young.created_at (now-ish) is later than the 30-day-old activation.
    assert anchor >= young.created_at - timedelta(seconds=2)


def test_status_snapshot_shape(app):
    u = _user('snap')
    SPS.set_require_2fa(True)
    snap = SPS.status(u)
    assert snap['required'] is True
    assert snap['result'] in (SPS.NUDGE, SPS.ENFORCE)
    assert snap['has_2fa'] is False
    assert snap['grace_deadline'] is not None
