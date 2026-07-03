"""Site imports.

Adds the site_imports table: one row per archive-to-app migration run
(cPanel first; DirectAdmin/Hestia later via the same importer registry).

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on
boot before Alembic, so guard on the live schema.

Revision ID: 051_site_imports
Revises: 050_managed_database_users
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa

revision = '051_site_imports'
down_revision = '050_managed_database_users'
branch_labels = None
depends_on = None

TABLE = 'site_imports'


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if TABLE in set(inspector.get_table_names()):
        return
    op.create_table(
        TABLE,
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source_type', sa.String(30), nullable=False,
                  server_default='cpanel'),
        sa.Column('status', sa.String(20), nullable=False,
                  server_default='created'),
        sa.Column('source', sa.Text(), nullable=True),
        sa.Column('options', sa.Text(), nullable=True),
        sa.Column('analysis', sa.Text(), nullable=True),
        sa.Column('result', sa.Text(), nullable=True),
        sa.Column('log_text', sa.Text(), nullable=True),
        sa.Column('current_step', sa.String(60), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'),
                  nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if TABLE not in set(inspector.get_table_names()):
        return
    op.drop_table(TABLE)
