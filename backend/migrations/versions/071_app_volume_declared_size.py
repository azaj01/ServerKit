"""Declared volume size (Appliance tier, plan 35).

Adds ``app_volumes.declared_size`` — the operator/manifest-declared size cap for
a volume (e.g. "10Gi"), distinct from ``size_bytes`` (the last-measured actual
usage). Nullable.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 071_app_volume_declared_size
Revises: 070_app_ports
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = '071_app_volume_declared_size'
down_revision = '070_app_ports'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'app_volumes' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('app_volumes')}
    if 'declared_size' not in cols:
        op.add_column('app_volumes',
                      sa.Column('declared_size', sa.String(length=40),
                                nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'app_volumes' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('app_volumes')}
    if 'declared_size' in cols:
        op.drop_column('app_volumes', 'declared_size')
