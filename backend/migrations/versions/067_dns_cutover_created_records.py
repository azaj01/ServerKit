"""Reversible DNS cutover — created-record tracking (plan 31 #1/#3, Decision 3).

Adds ``dns_cutover_snapshots.created_records_json`` — the records a cutover
CREATED (no same-(type,name) predecessor in the snapshot). Revert DELETES these
so the world is restored byte-for-byte, not just the captured values.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema (the column may already exist).

Revision ID: 067_dns_cutover_created_records
Revises: 066_dns_cutover_snapshots
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa

revision = '067_dns_cutover_created_records'
down_revision = '066_dns_cutover_snapshots'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'dns_cutover_snapshots' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('dns_cutover_snapshots')}
    if 'created_records_json' not in cols:
        op.add_column('dns_cutover_snapshots',
                      sa.Column('created_records_json', sa.Text(), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'dns_cutover_snapshots' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('dns_cutover_snapshots')}
    if 'created_records_json' in cols:
        op.drop_column('dns_cutover_snapshots', 'created_records_json')
