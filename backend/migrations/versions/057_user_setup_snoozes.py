"""Per-user Setup Health item snoozes.

Adds users.setup_snoozes (Text, JSON { item_key: iso_expiry }) so a user can mute
a personal setup item (e.g. "secure your account"). Panel-item snoozes live in a
SettingsService map, not here. See app/services/setup_health_service.py (plan 22
Phase 6).

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 057_user_setup_snoozes
Revises: 056_cron_runs
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '057_user_setup_snoozes'
down_revision = '056_cron_runs'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'users' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('users')}
    if 'setup_snoozes' not in cols:
        op.add_column('users', sa.Column('setup_snoozes', sa.Text(), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'users' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('users')}
    if 'setup_snoozes' in cols:
        op.drop_column('users', 'setup_snoozes')
