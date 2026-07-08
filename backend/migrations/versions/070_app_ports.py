"""Typed application port declarations (Appliance tier, plan 35).

Adds ``applications.ports`` — a JSON list of typed port declarations
({container, host, protocol, ...}) that the appliance-tier ports+blockers rail
reads. Nullable; NULL means "no declared ports" (legacy apps use ``port``).

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 070_app_ports
Revises: 069_email_bounce_state
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = '070_app_ports'
down_revision = '069_email_bounce_state'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'applications' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('applications')}
    if 'ports' not in cols:
        op.add_column('applications', sa.Column('ports', sa.Text(), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'applications' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('applications')}
    if 'ports' in cols:
        op.drop_column('applications', 'ports')
