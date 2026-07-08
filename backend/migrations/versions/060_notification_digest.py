"""Notification digests — per-user cadence (plan 24 Phase 3).

Adds ``digest_cadence`` ('off'|'daily'|'weekly', default 'off' — preserves the
pre-digest immediate-send behavior) and ``digest_last_sent_at`` to
``notification_preferences``. The digest itself reuses the existing
``notification_deliveries`` table via a new status value ``queued_digest`` (no
schema change for the status — it's a plain string column).

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 060_notification_digest
Revises: 059_notification_prefs_events
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '060_notification_digest'
down_revision = '059_notification_prefs_events'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'notification_preferences' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('notification_preferences')}
    if 'digest_cadence' not in cols:
        op.add_column('notification_preferences',
                      sa.Column('digest_cadence', sa.String(length=12),
                                nullable=True, server_default='off'))
    if 'digest_last_sent_at' not in cols:
        op.add_column('notification_preferences',
                      sa.Column('digest_last_sent_at', sa.DateTime(),
                                nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'notification_preferences' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('notification_preferences')}
    if 'digest_last_sent_at' in cols:
        op.drop_column('notification_preferences', 'digest_last_sent_at')
    if 'digest_cadence' in cols:
        op.drop_column('notification_preferences', 'digest_cadence')
