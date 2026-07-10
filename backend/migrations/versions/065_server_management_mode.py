"""Server management mode — managed | observed (plan 27, Decision 1).

Adds ``servers.management_mode`` (default ``managed``) so a paired box can be
adopted read-only ("observed") without ServerKit fighting another panel over
web-server config ownership. Existing rows backfill to ``managed`` — no server
is ever auto-downgraded (Decision 4).

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 065_server_management_mode
Revises: 064_server_surveys
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '065_server_management_mode'
down_revision = '064_server_surveys'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'servers' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('servers')}
    if 'management_mode' not in cols:
        op.add_column('servers',
                      sa.Column('management_mode', sa.String(length=16),
                                nullable=False, server_default='managed'))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'servers' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('servers')}
    if 'management_mode' in cols:
        op.drop_column('servers', 'management_mode')
