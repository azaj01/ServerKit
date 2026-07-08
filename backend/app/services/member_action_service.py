"""Member action templates — the safe write escape hatch (plan 19 Phase 5).

A member action is a CURATED, parameterized action a workspace member may trigger
for an app they can reach. It is the only member-write path beyond the plan's
Phase-4 matrix, and it is deliberately narrow:

  - No free text ever reaches a shell. Every parameter is validated against a
    typed schema (enum / bounded int) before the executor runs.
  - Each template declares (id, label, param schema, executor, min_role). The
    min_role reuses the same capability tiers as the rest of the plan
    (can_operate_app for 'member', can_admin_app for 'admin').
  - Every run is audit-logged.
  - The whole surface is feature-flagged (config MEMBER_ACTIONS_ENABLED).

The registry ships one concrete template today — `set-backup-frequency`, which
adjusts an app's backup schedule through the existing BackupPolicyService (no new
side-channel). The cron "ping this app's scheduler every N minutes" template
named in the plan is deferred until plan 21 #10 lands its ScheduledJob wiring;
adding it is just another registry entry.
"""
from app.services.resource_grant_service import ResourceGrantService
from app.services.audit_service import AuditService


class ActionError(ValueError):
    """Raised for an unknown action, a disabled surface, or invalid params."""


# --------------------------------------------------------------------------- #
# Parameter validation — typed, bounded, no free text.
# --------------------------------------------------------------------------- #

def _validate_params(schema, raw):
    """Validate `raw` against `schema` (name -> spec). Returns a clean dict of only
    the declared params, coerced to their type. Raises ActionError on any problem."""
    raw = raw or {}
    out = {}
    for name, spec in schema.items():
        required = spec.get('required', False)
        if name not in raw or raw[name] in (None, ''):
            if required:
                raise ActionError(f"Missing required parameter '{name}'")
            if 'default' in spec:
                out[name] = spec['default']
            continue
        value = raw[name]
        kind = spec['type']
        if kind == 'enum':
            if value not in spec['choices']:
                raise ActionError(
                    f"Parameter '{name}' must be one of {spec['choices']}")
            out[name] = value
        elif kind == 'int':
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise ActionError(f"Parameter '{name}' must be an integer")
            if 'min' in spec and value < spec['min']:
                raise ActionError(f"Parameter '{name}' must be >= {spec['min']}")
            if 'max' in spec and value > spec['max']:
                raise ActionError(f"Parameter '{name}' must be <= {spec['max']}")
            out[name] = value
        else:  # pragma: no cover - guards against a malformed registry entry
            raise ActionError(f"Unsupported parameter type '{kind}'")
    return out


# --------------------------------------------------------------------------- #
# Executors — each takes (app, params) and returns a JSON-safe result. They only
# ever call vetted service methods; they never build a shell string.
# --------------------------------------------------------------------------- #

# Backup frequency enum -> the cron the schedule actually stores (runs at 02:00).
_FREQUENCY_CRON = {
    'daily': '0 2 * * *',
    'weekly': '0 2 * * 0',
    'monthly': '0 2 1 * *',
}


def _exec_set_backup_frequency(app, params):
    from app.services.backup_policy_service import BackupPolicyService
    cron = _FREQUENCY_CRON[params['frequency']]
    policy = BackupPolicyService.get_or_create_policy('application', app.id)
    BackupPolicyService.update_policy(policy, {'enabled': True, 'schedule_cron': cron})
    return {'frequency': params['frequency'], 'schedule_cron': cron, 'enabled': True}


# --------------------------------------------------------------------------- #
# The registry.
# --------------------------------------------------------------------------- #

MEMBER_ACTIONS = {
    'set-backup-frequency': {
        'id': 'set-backup-frequency',
        'label': 'Set backup frequency',
        'description': "Enable protection and set how often this app is backed up.",
        'min_role': 'member',
        'param_schema': {
            'frequency': {
                'type': 'enum',
                'choices': ['daily', 'weekly', 'monthly'],
                'required': True,
                'label': 'Frequency',
            },
        },
        'executor': _exec_set_backup_frequency,
    },
}


def is_enabled():
    """Feature flag — the whole member-action surface can be turned off.

    Two independent kill switches, both must allow (plan 29 #13): the
    ``MEMBER_ACTIONS_ENABLED`` app config (deployment-level, default ON) AND the
    admin-visible ``security_member_actions_enabled`` system setting (default ON).
    Either set to false disables the surface."""
    from app.services.settings_service import SettingsService
    from flask import current_app
    if not current_app.config.get('MEMBER_ACTIONS_ENABLED', True):
        return False
    val = SettingsService.get('security_member_actions_enabled', None)
    return True if val is None else bool(val)


def _public(template):
    """The client-safe view of a template (no executor callable)."""
    return {
        'id': template['id'],
        'label': template['label'],
        'description': template['description'],
        'min_role': template['min_role'],
        'param_schema': template['param_schema'],
    }


def list_actions():
    """Every registered template (client-safe), or [] when the surface is off."""
    if not is_enabled():
        return []
    return [_public(t) for t in MEMBER_ACTIONS.values()]


def _authorized(user, app, min_role):
    """Whether `user` may run a template whose min_role is `min_role` on `app`."""
    if min_role == 'admin':
        return ResourceGrantService.can_admin_app(user, app)
    return ResourceGrantService.can_operate_app(user, app)


def run(user, app, action_id, raw_params):
    """Validate + authorize + execute + audit one member action.

    Returns (result_dict, None) on success or (None, (error_message, status)) so
    the caller can shape the JSON error response consistently."""
    if not is_enabled():
        return None, ('Member actions are disabled', 403)
    template = MEMBER_ACTIONS.get(action_id)
    if template is None:
        return None, ('Unknown action', 404)
    if not _authorized(user, app, template['min_role']):
        return None, ('Access denied', 403)
    try:
        params = _validate_params(template['param_schema'], raw_params)
    except ActionError as e:
        return None, (str(e), 400)

    result = template['executor'](app, params)

    AuditService.log_app_action(
        action=f'member_action.{action_id}',
        user_id=user.id,
        app_id=app.id,
        app_name=app.name,
        details={'params': params},
    )
    return {'action': action_id, 'result': result}, None
