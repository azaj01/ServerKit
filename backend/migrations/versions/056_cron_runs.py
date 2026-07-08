"""Cron run records.

Adds the cron_runs table: one row per tracked execution of a panel cron job
(job_id, timing, exit code, status, output tail). See app/models/cron_run.py and
the serverkit-cron-run shim.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 056_cron_runs
Revises: 055_manifest_env_refs
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '056_cron_runs'
down_revision = '055_manifest_env_refs'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'cron_runs' not in tables:
        op.create_table(
            'cron_runs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('job_id', sa.String(length=64), nullable=False),
            sa.Column('started_at', sa.DateTime(), nullable=True),
            sa.Column('finished_at', sa.DateTime(), nullable=True),
            sa.Column('exit_code', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(length=16), nullable=False,
                      server_default='running'),
            sa.Column('output_tail', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_cron_runs_job_id', 'cron_runs', ['job_id'])
        op.create_index('ix_cron_runs_created_at', 'cron_runs', ['created_at'])


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'cron_runs' in set(inspector.get_table_names()):
        op.drop_table('cron_runs')
