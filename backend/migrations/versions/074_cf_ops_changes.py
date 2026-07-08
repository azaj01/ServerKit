"""Per-zone Cloudflare-ops activity ledger (plan 36 #10).

Adds ``cf_ops_changes`` — the ops-layer sibling of ``dns_changes`` — recording
every Cloudflare zone-operations write ServerKit makes (settings, DNSSEC, WAF,
redirect/transform rules, Origin CA, Workers, Tunnels, storage), keyed by
``provider_zone_id`` for the per-zone Activity tab.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema (the table may already exist).

Revision ID: 074_cf_ops_changes
Revises: 073_dns_provider_origin_ca_key
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = '074_cf_ops_changes'
down_revision = '073_dns_provider_origin_ca_key'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'cf_ops_changes' not in tables:
        op.create_table(
            'cf_ops_changes',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('dns_provider_config_id', sa.Integer(), nullable=True),
            sa.Column('provider_zone_id', sa.String(length=128), nullable=True),
            sa.Column('product', sa.String(length=32), nullable=False),
            sa.Column('action', sa.String(length=32), nullable=False),
            sa.Column('target', sa.String(length=256), nullable=True),
            sa.Column('result', sa.String(length=16), nullable=False,
                      server_default='ok'),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['dns_provider_config_id'],
                                    ['dns_provider_configs.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_cf_ops_changes_dns_provider_config_id',
                        'cf_ops_changes', ['dns_provider_config_id'])
        op.create_index('ix_cf_ops_changes_provider_zone_id',
                        'cf_ops_changes', ['provider_zone_id'])
        op.create_index('ix_cf_ops_changes_created_at',
                        'cf_ops_changes', ['created_at'])


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'cf_ops_changes' in set(inspector.get_table_names()):
        op.drop_table('cf_ops_changes')
