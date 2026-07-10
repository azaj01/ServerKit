"""One-shot appliance bootstrap flag (Appliance tier, plan 35).

Adds ``applications.bootstrap_done`` (default False) — set once the appliance
``bootstrap`` step has run for an app, so it is never re-run on subsequent
deploys.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 072_app_bootstrap_done
Revises: 071_app_volume_declared_size
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = '072_app_bootstrap_done'
down_revision = '071_app_volume_declared_size'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'applications' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('applications')}
    if 'bootstrap_done' not in cols:
        op.add_column('applications',
                      sa.Column('bootstrap_done', sa.Boolean(), nullable=False,
                                server_default='0'))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'applications' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('applications')}
    if 'bootstrap_done' in cols:
        op.drop_column('applications', 'bootstrap_done')
