"""Observed-mode agent:update break-glass (plan 31 #10, Decision 6).

Adds ``servers.allow_agent_update_observed`` (default False). Observed servers
refuse ``agent:update`` unless this per-server override is set, so plan 27's
read-only promise covers the agent binary itself instead of silently permitting
a re-flash.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 068_server_allow_agent_update_observed
Revises: 067_dns_cutover_created_records
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa

revision = '068_server_allow_agent_update_observed'
down_revision = '067_dns_cutover_created_records'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'servers' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('servers')}
    if 'allow_agent_update_observed' not in cols:
        op.add_column('servers',
                      sa.Column('allow_agent_update_observed', sa.Boolean(),
                                nullable=False, server_default='0'))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'servers' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('servers')}
    if 'allow_agent_update_observed' in cols:
        op.drop_column('servers', 'allow_agent_update_observed')
