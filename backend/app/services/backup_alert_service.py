"""Edge-triggered restore-proof alerts (plan 23 Phase 5).

Drills and verification run on a schedule, so a naive "notify on failure" would
re-alert every sweep. These alerts are STATE-TRANSITION only: a failure fires
once (the first sweep that flips healthy→failed for a policy) and a recovery
fires once (the first success after a failure). The previous outcome per policy
is remembered in SettingsService, keyed by policy id.

Events (category ``backups``, admin-targeted):
  * ``backup.drill_failed`` / ``backup.drill_recovered``
  * ``backup.verify_failed`` / ``backup.verify_recovered``
"""
import logging

logger = logging.getLogger(__name__)

_DRILL_KEY = 'backup_alert_drill_{policy_id}'
_VERIFY_KEY = 'backup_alert_verify_{policy_id}'


class BackupAlertService:

    # ------------------------------------------------------------------ #
    # State store (best-effort)
    # ------------------------------------------------------------------ #

    @staticmethod
    def _get_state(key):
        try:
            from app.services.settings_service import SettingsService
            return SettingsService.get(key)
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _set_state(key, value):
        try:
            from app.services.settings_service import SettingsService
            SettingsService.set(key, value)
        except Exception as exc:  # noqa: BLE001
            logger.debug('could not persist backup alert state %s: %s', key, exc)

    @staticmethod
    def _policy_label(policy):
        return f'{policy.target_type}:{policy.target_id}'

    @staticmethod
    def _notify(event, data, policy=None):
        # Carry the policy target so the notification deep-links straight to its
        # protection panel (focus=policy:<target_type>:<target_id>, plan 33).
        if policy is not None:
            data = {**data, 'target_type': policy.target_type, 'target_id': policy.target_id}
        try:
            from app.plugins_sdk import notify
            notify.send(event, to='admins', data=data, category='backups')
        except Exception as exc:  # noqa: BLE001 — a notification must never break a sweep
            logger.debug('notify %s failed: %s', event, exc)

    # ------------------------------------------------------------------ #
    # Drill outcome
    # ------------------------------------------------------------------ #

    @classmethod
    def on_drill_result(cls, policy, status, error=None):
        """Record a drill's outcome and fire a failed/recovered notice only on a
        state transition. ``status`` is the RestoreDrill status."""
        outcome = 'failed' if status in ('failed', 'skipped_no_space') else 'success'
        key = _DRILL_KEY.format(policy_id=policy.id)
        prev = cls._get_state(key)
        label = cls._policy_label(policy)
        if outcome == 'failed' and prev != 'failed':
            cls._notify('backup.drill_failed', {
                'policy': label, 'target': label, 'status': status,
                'error_message': (error or status or 'drill failed')[:300],
                'message': (f'A restore drill for {label} {status}. The latest backup '
                            'may not be restorable — open Backups → the policy to '
                            'inspect the drill, or Monitoring → Doctor to re-run it.'),
            }, policy=policy)
        elif outcome == 'success' and prev == 'failed':
            cls._notify('backup.drill_recovered', {
                'policy': label, 'target': label,
                'message': f'Restore drills for {label} are passing again.',
            }, policy=policy)
        cls._set_state(key, outcome)

    # ------------------------------------------------------------------ #
    # Verification outcome
    # ------------------------------------------------------------------ #

    @classmethod
    def on_verify_result(cls, policy, run):
        """Record a run's verification outcome and fire on transition. A run is a
        verification failure if it has a ``verify_error`` or its offsite deep
        check reported a mismatch."""
        offsite = (run.get_metadata() or {}).get('offsite') or {}
        failed = bool(run.verify_error) or (offsite.get('deep_match') is False)
        outcome = 'failed' if failed else 'success'
        key = _VERIFY_KEY.format(policy_id=policy.id)
        prev = cls._get_state(key)
        label = cls._policy_label(policy)
        if outcome == 'failed' and prev != 'failed':
            detail = run.verify_error or 'The offsite copy did not match its stored checksum.'
            cls._notify('backup.verify_failed', {
                'policy': label, 'target': label,
                'error_message': detail[:300],
                'message': (f'The latest backup for {label} failed verification: {detail} '
                            'Open Backups → the policy to inspect it.'),
            }, policy=policy)
        elif outcome == 'success' and prev == 'failed':
            cls._notify('backup.verify_recovered', {
                'policy': label, 'target': label,
                'message': f'Backups for {label} are verifying cleanly again.',
            }, policy=policy)
        cls._set_state(key, outcome)
