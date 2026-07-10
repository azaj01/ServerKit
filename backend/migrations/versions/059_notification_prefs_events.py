"""Notification preference depth — per-event channel overrides (plan 24 Phase 2).

Adds ``events_json`` to ``notification_preferences``: a JSON map
``{"<event_key>": {"<channel>": bool}}`` that is the top of the preference
resolution order (event override > category/severity > org default > catalog).
Back-compat: rows without the column default to ``{}`` (no overrides), so
existing users are unaffected.

Org-level defaults live in the ``system_settings`` key ``notify.defaults`` (no
schema change) — see SettingsService.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 059_notification_prefs_events
Revises: 058_backup_restore_drills
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '059_notification_prefs_events'
down_revision = '058_backup_restore_drills'
branch_labels = None
depends_on = None


def _cols(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'notification_preferences' in tables:
        cols = _cols(inspector, 'notification_preferences')
        if 'events_json' not in cols:
            op.add_column('notification_preferences', sa.Column(
                'events_json', sa.Text(), nullable=True, server_default='{}'))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'notification_preferences' in tables:
        cols = _cols(inspector, 'notification_preferences')
        if 'events_json' in cols:
            op.drop_column('notification_preferences', 'events_json')
