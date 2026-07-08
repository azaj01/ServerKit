"""Panel security policy — the require-2FA enrollment policy (plan 29 Phase 2).

Evaluates, per user, whether the panel's *require two-factor* policy is satisfied,
still within its grace window, or must be enforced now. The three outcomes are:

    'ok'      — no action needed (policy off, user already has 2FA, or SSO-exempt)
    'nudge'   — policy on, no 2FA yet, but still inside the grace window
    'enforce' — policy on, no 2FA, grace window elapsed → gate the session

The grace window is anchored on ``max(user.created_at, policy_enabled_at)`` so
flipping the policy ON never insta-locks a veteran account (plan 29 Decision 4).
``policy_enabled_at`` is stamped the moment the policy transitions off→on and
lives in the same SettingsService map as the toggle itself — no new table.

SSO accounts (``auth_provider`` other than ``local``) are exempt: their identity
provider owns the second factor (plan 29, security_policy_service ok/nudge/enforce
+ SSO-exempt).
"""
from datetime import datetime, timedelta

from app.services.settings_service import SettingsService

# Setting keys (plain SettingsService map — no dedicated model).
SETTING_REQUIRE_2FA = 'security_require_2fa'
SETTING_ENABLED_AT = 'security_require_2fa_enabled_at'


class SecurityPolicyService:
    """Stateless evaluation of the require-2FA policy."""

    OK = 'ok'
    NUDGE = 'nudge'
    ENFORCE = 'enforce'

    # How long a user has to enroll once the policy applies to them.
    GRACE_PERIOD_DAYS = 7

    # ------------------------------------------------------------------
    # Policy state (SettingsService-backed)
    # ------------------------------------------------------------------
    @staticmethod
    def _as_bool(value):
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        return str(value).strip().lower() in ('1', 'true', 'yes', 'on')

    @classmethod
    def require_2fa_enabled(cls):
        """Whether the admin has turned the require-2FA policy on."""
        return cls._as_bool(SettingsService.get(SETTING_REQUIRE_2FA, False))

    @classmethod
    def policy_enabled_at(cls):
        """When the policy last transitioned off→on, or None if never / off."""
        raw = SettingsService.get(SETTING_ENABLED_AT, None)
        if not raw:
            return None
        if isinstance(raw, datetime):
            return raw
        try:
            return datetime.fromisoformat(str(raw))
        except (ValueError, TypeError):
            return None

    @classmethod
    def set_require_2fa(cls, enabled, user_id=None):
        """Set the require-2FA toggle. Stamps ``policy_enabled_at`` on an off→on
        transition (and only then) so the grace clock starts at activation."""
        enabled = bool(enabled)
        was_enabled = cls.require_2fa_enabled()
        SettingsService.set(SETTING_REQUIRE_2FA, 'true' if enabled else 'false', user_id)
        if enabled and not was_enabled:
            SettingsService.set(SETTING_ENABLED_AT, datetime.utcnow().isoformat(), user_id)
        return enabled

    # ------------------------------------------------------------------
    # Per-user grace window
    # ------------------------------------------------------------------
    @classmethod
    def grace_anchor(cls, user):
        """The later of the account's creation and the policy's activation.

        Anchoring on the max means a long-lived account still gets the FULL grace
        window when the policy is first switched on (plan 29 Decision 4)."""
        anchor = getattr(user, 'created_at', None) or datetime.utcnow()
        enabled_at = cls.policy_enabled_at()
        if enabled_at and enabled_at > anchor:
            anchor = enabled_at
        return anchor

    @classmethod
    def grace_deadline(cls, user):
        """When enforcement kicks in for ``user``."""
        return cls.grace_anchor(user) + timedelta(days=cls.GRACE_PERIOD_DAYS)

    @classmethod
    def in_grace(cls, user, now=None):
        now = now or datetime.utcnow()
        return now < cls.grace_deadline(user)

    # ------------------------------------------------------------------
    # User attributes
    # ------------------------------------------------------------------
    @staticmethod
    def is_sso_user(user):
        """SSO accounts delegate the second factor to their IdP → policy-exempt."""
        provider = (getattr(user, 'auth_provider', None) or 'local').lower()
        return provider != 'local'

    @staticmethod
    def user_has_2fa(user):
        """True if the user has ANY second factor enrolled (TOTP or a passkey)."""
        if getattr(user, 'totp_enabled', False):
            return True
        try:
            return user.passkeys.filter_by(is_active=True).count() > 0
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------
    @classmethod
    def evaluate(cls, user, now=None):
        """Return 'ok' | 'nudge' | 'enforce' for ``user`` under the current policy."""
        if user is None:
            return cls.OK
        if not cls.require_2fa_enabled():
            return cls.OK
        if cls.user_has_2fa(user):
            return cls.OK
        if cls.is_sso_user(user):
            return cls.OK
        if cls.in_grace(user, now=now):
            return cls.NUDGE
        return cls.ENFORCE

    @classmethod
    def status(cls, user, now=None):
        """A JSON-friendly policy snapshot for the current user."""
        result = cls.evaluate(user, now=now)
        required = cls.require_2fa_enabled()
        deadline = cls.grace_deadline(user) if (required and user is not None) else None
        return {
            'result': result,
            'required': required,
            'has_2fa': cls.user_has_2fa(user) if user is not None else False,
            'exempt': cls.is_sso_user(user) if user is not None else False,
            'grace_deadline': deadline.isoformat() if deadline else None,
        }
