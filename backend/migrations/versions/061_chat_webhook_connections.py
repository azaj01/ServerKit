"""Org-level chat/webhook connections (plan 24 Phase 4).

New ``chat_webhook_connections`` table: a shared Discord/Slack/Telegram room or
generic webhook that receives notifications matching its category filter.
Credentials are Fernet-encrypted per-field in ``credentials_json``. Replaces the
legacy global notifications.json chat config (imported once at boot) and the
deprecated per-user webhook URL fields.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 061_chat_webhook_connections
Revises: 060_notification_digest
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '061_chat_webhook_connections'
down_revision = '060_notification_digest'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'chat_webhook_connections' in set(inspector.get_table_names()):
        return
    op.create_table(
        'chat_webhook_connections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('credentials_json', sa.Text(), nullable=True),
        sa.Column('categories_json', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('is_default', sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column('imported', sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('last_tested_at', sa.DateTime(), nullable=True),
        sa.Column('last_test_ok', sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_chat_webhook_connections_is_default',
                    'chat_webhook_connections', ['is_default'])


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'chat_webhook_connections' in set(inspector.get_table_names()):
        op.drop_table('chat_webhook_connections')
