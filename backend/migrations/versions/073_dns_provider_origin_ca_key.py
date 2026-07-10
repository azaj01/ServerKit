"""Cloudflare Origin CA private key (plan 36 Origin CA).

Adds ``dns_provider_configs.origin_ca_key`` — the private key the panel
generated for the CSR when issuing an Origin certificate for this provider's
zones. Stored so the matching certificate can be installed on the origin.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 073_dns_provider_origin_ca_key
Revises: 072_app_bootstrap_done
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = '073_dns_provider_origin_ca_key'
down_revision = '072_app_bootstrap_done'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'dns_provider_configs' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('dns_provider_configs')}
    if 'origin_ca_key' not in cols:
        op.add_column('dns_provider_configs',
                      sa.Column('origin_ca_key', sa.Text(), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'dns_provider_configs' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('dns_provider_configs')}
    if 'origin_ca_key' in cols:
        op.drop_column('dns_provider_configs', 'origin_ca_key')
