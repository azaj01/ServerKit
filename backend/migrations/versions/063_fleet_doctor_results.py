"""Fleet doctor per-server results (Fleet Parity Sweep, plan 26 Phase 2).

Adds ``fleet_doctor_results`` — one row per ``(server_id, check_key)`` so the
fleet health sweep records per-server outcomes as ROWS, not a panel-host blob
(Decision 3). The panel-host doctor keeps its ``doctor_last_report`` settings
blob; the report API merges the two.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema (the table may already exist).

Revision ID: 063_fleet_doctor_results
Revises: 062_notification_action_link
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '063_fleet_doctor_results'
down_revision = '062_notification_action_link'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'fleet_doctor_results' not in tables:
        op.create_table(
            'fleet_doctor_results',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('server_id', sa.String(length=36), nullable=False),
            sa.Column('check_key', sa.String(length=160), nullable=False),
            sa.Column('status', sa.String(length=16), nullable=False,
                      server_default='ok'),
            sa.Column('title', sa.String(length=200), nullable=True),
            sa.Column('detail', sa.Text(), nullable=True),
            sa.Column('repairable', sa.Boolean(), nullable=False,
                      server_default=sa.false()),
            sa.Column('repair_ref', sa.Text(), nullable=True),
            sa.Column('ran_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['server_id'], ['servers.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('server_id', 'check_key',
                                name='uq_fleet_doctor_server_check'),
        )
        op.create_index('ix_fleet_doctor_results_server_id',
                        'fleet_doctor_results', ['server_id'])
        op.create_index('ix_fleet_doctor_results_check_key',
                        'fleet_doctor_results', ['check_key'])
        op.create_index('ix_fleet_doctor_results_ran_at',
                        'fleet_doctor_results', ['ran_at'])


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'fleet_doctor_results' in set(inspector.get_table_names()):
        op.drop_table('fleet_doctor_results')
