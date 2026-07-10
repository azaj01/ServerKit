"""Backup Trust — verification ladder, checksums, drill cadence + restore_drills.

Adds the "restore proof" columns (plan 23):
  * backup_runs: verify_level, verified_at, verify_error, checksum_sha256
  * backup_policies: drill_cadence, last_drill_at, last_drill_status
  * new restore_drills table (a scratch-mode restore, probe-verified, torn down)

Backfill: existing runs keep verify_level='none' (the column default); the
legacy `verified` boolean is preserved as-is and mapped forward in serialization
(BackupRun.effective_verify_level), so old rows aren't silently downgraded.

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 058_backup_restore_drills
Revises: 057_user_setup_snoozes
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = '058_backup_restore_drills'
down_revision = '057_user_setup_snoozes'
branch_labels = None
depends_on = None


def _cols(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'backup_runs' in tables:
        cols = _cols(inspector, 'backup_runs')
        if 'verify_level' not in cols:
            op.add_column('backup_runs', sa.Column(
                'verify_level', sa.String(length=12), nullable=False, server_default='none'))
        if 'verified_at' not in cols:
            op.add_column('backup_runs', sa.Column('verified_at', sa.DateTime(), nullable=True))
        if 'verify_error' not in cols:
            op.add_column('backup_runs', sa.Column('verify_error', sa.Text(), nullable=True))
        if 'checksum_sha256' not in cols:
            op.add_column('backup_runs', sa.Column('checksum_sha256', sa.String(length=64), nullable=True))

    if 'backup_policies' in tables:
        cols = _cols(inspector, 'backup_policies')
        if 'drill_cadence' not in cols:
            op.add_column('backup_policies', sa.Column(
                'drill_cadence', sa.String(length=12), nullable=False, server_default='off'))
        if 'last_drill_at' not in cols:
            op.add_column('backup_policies', sa.Column('last_drill_at', sa.DateTime(), nullable=True))
        if 'last_drill_status' not in cols:
            op.add_column('backup_policies', sa.Column('last_drill_status', sa.String(length=24), nullable=True))

    if 'restore_drills' not in tables:
        op.create_table(
            'restore_drills',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('policy_id', sa.Integer(), nullable=False),
            sa.Column('run_id', sa.Integer(), nullable=True),
            sa.Column('job_id', sa.String(length=36), nullable=True),
            sa.Column('status', sa.String(length=24), nullable=False, server_default='running'),
            sa.Column('trigger', sa.String(length=20), nullable=True),
            sa.Column('started_at', sa.DateTime(), nullable=True),
            sa.Column('finished_at', sa.DateTime(), nullable=True),
            sa.Column('duration_seconds', sa.Integer(), nullable=True),
            sa.Column('bytes_required', sa.BigInteger(), nullable=True),
            sa.Column('bytes_free', sa.BigInteger(), nullable=True),
            sa.Column('bytes_restored', sa.BigInteger(), nullable=True),
            sa.Column('scratch_ref', sa.Text(), nullable=True),
            sa.Column('probes_json', sa.Text(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(['policy_id'], ['backup_policies.id']),
            sa.ForeignKeyConstraint(['run_id'], ['backup_runs.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_restore_drills_policy_id', 'restore_drills', ['policy_id'])
        op.create_index('ix_restore_drills_run_id', 'restore_drills', ['run_id'])
        op.create_index('ix_restore_drills_job_id', 'restore_drills', ['job_id'])


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'restore_drills' in tables:
        op.drop_table('restore_drills')

    if 'backup_policies' in tables:
        cols = _cols(inspector, 'backup_policies')
        for col in ('drill_cadence', 'last_drill_at', 'last_drill_status'):
            if col in cols:
                op.drop_column('backup_policies', col)

    if 'backup_runs' in tables:
        cols = _cols(inspector, 'backup_runs')
        for col in ('verify_level', 'verified_at', 'verify_error', 'checksum_sha256'):
            if col in cols:
                op.drop_column('backup_runs', col)
