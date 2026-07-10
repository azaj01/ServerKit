"""Reversible DNS cutover snapshots (plan 27 Phase 6 #13, Decision 6).

Adds ``dns_cutover_snapshots`` — a point-in-time capture of a domain's live DNS
records taken right before a migration cutover, so a revert can re-apply the
original records. The after-only DNS change ledger can't power revert; this can.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema (the table may already exist).

Revision ID: 066_dns_cutover_snapshots
Revises: 065_server_management_mode
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa

revision = '066_dns_cutover_snapshots'
down_revision = '065_server_management_mode'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'dns_cutover_snapshots' not in tables:
        op.create_table(
            'dns_cutover_snapshots',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('domain', sa.String(length=256), nullable=False),
            sa.Column('provider', sa.String(length=64), nullable=True),
            sa.Column('provider_zone_id', sa.String(length=128), nullable=True),
            sa.Column('records_json', sa.Text(), nullable=True),
            sa.Column('status', sa.String(length=16), nullable=False,
                      server_default='captured'),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('applied_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_dns_cutover_snapshots_domain',
                        'dns_cutover_snapshots', ['domain'], unique=False)
        op.create_index('ix_dns_cutover_snapshots_created_at',
                        'dns_cutover_snapshots', ['created_at'], unique=False)


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())
    if 'dns_cutover_snapshots' in tables:
        op.drop_index('ix_dns_cutover_snapshots_created_at',
                      table_name='dns_cutover_snapshots')
        op.drop_index('ix_dns_cutover_snapshots_domain',
                      table_name='dns_cutover_snapshots')
        op.drop_table('dns_cutover_snapshots')
