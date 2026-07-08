"""Server survey snapshots (Adoption/Import/Coexistence, plan 27 Phase 2).

Adds ``server_surveys`` — one immutable row per read-only survey "flight" of a
paired server (Decision 3: snapshots, not live state). Each row records the
catalog version it was flown with and the normalized Server Map JSON, so any two
flights of the same server can be diffed.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema (the table may already exist).

Revision ID: 064_server_surveys
Revises: 063_fleet_doctor_results
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '064_server_surveys'
down_revision = '063_fleet_doctor_results'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'server_surveys' not in tables:
        op.create_table(
            'server_surveys',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('server_id', sa.String(length=36), nullable=False),
            sa.Column('catalog_version', sa.Integer(), nullable=False,
                      server_default='1'),
            sa.Column('taken_at', sa.DateTime(), nullable=False),
            sa.Column('map_json', sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(['server_id'], ['servers.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_server_surveys_server_id',
                        'server_surveys', ['server_id'])
        op.create_index('ix_server_surveys_taken_at',
                        'server_surveys', ['taken_at'])


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'server_surveys' in set(inspector.get_table_names()):
        op.drop_table('server_surveys')
