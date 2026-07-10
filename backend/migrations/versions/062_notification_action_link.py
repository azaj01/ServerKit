"""Notification deep links (plan 24 Phase 5).

Adds ``action_path`` + ``action_label`` to ``notifications``: a relative deep
link to the notification's subject, computed at send time (catalog link builder
or producer override) and persisted so a later route move never breaks old rows.
Bell/history navigate to it; email/chat resolve it to an absolute URL.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 062_notification_action_link
Revises: 061_chat_webhook_connections
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '062_notification_action_link'
down_revision = '061_chat_webhook_connections'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'notifications' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('notifications')}
    if 'action_path' not in cols:
        op.add_column('notifications',
                      sa.Column('action_path', sa.String(length=512),
                                nullable=True))
    if 'action_label' not in cols:
        op.add_column('notifications',
                      sa.Column('action_label', sa.String(length=120),
                                nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'notifications' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('notifications')}
    if 'action_label' in cols:
        op.drop_column('notifications', 'action_label')
    if 'action_path' in cols:
        op.drop_column('notifications', 'action_path')
