"""Email bounce/complaint suppression state (plan 33 Phase 4, roadmap #24).

Adds ``email_bounce_state`` — one row per address a provider reported a bounce
or complaint for. Drives the auto-mute of a hard-bouncing address and the
"email bouncing" badge in a user's notification settings.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema (the table may already exist).

Revision ID: 069_email_bounce_state
Revises: 068_server_allow_agent_update_observed
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa

revision = '069_email_bounce_state'
down_revision = '068_server_allow_agent_update_observed'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'email_bounce_state' not in tables:
        op.create_table(
            'email_bounce_state',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('email', sa.String(length=255), nullable=False),
            sa.Column('consecutive_bounces', sa.Integer(), nullable=False,
                      server_default='0'),
            sa.Column('total_events', sa.Integer(), nullable=False,
                      server_default='0'),
            sa.Column('muted', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('muted_at', sa.DateTime(), nullable=True),
            sa.Column('last_kind', sa.String(length=20), nullable=True),
            sa.Column('last_reason', sa.String(length=500), nullable=True),
            sa.Column('last_event_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_email_bounce_state_email', 'email_bounce_state',
                        ['email'], unique=True)
        op.create_index('ix_email_bounce_state_muted', 'email_bounce_state',
                        ['muted'])


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'email_bounce_state' in set(inspector.get_table_names()):
        op.drop_table('email_bounce_state')
