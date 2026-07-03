"""Per-site micro-cache toggle (task #21).

Adds:
- applications.micro_cache_enabled (Boolean, nullable)

NULL/False = off (today's behavior). When enabled, the app's nginx vhost is
rendered with short-TTL fastcgi/proxy cache directives plus auth/admin/cart
bypasses (see NginxService._with_micro_cache).

Idempotent: MigrationService runs _fix_missing_columns() + db.create_all() on boot
before Alembic, so guard on the live schema.

Revision ID: 053_micro_cache
Revises: 052_site_bandwidth
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa

revision = '053_micro_cache'
down_revision = '052_site_bandwidth'
branch_labels = None
depends_on = None

_COLUMN = 'micro_cache_enabled'


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'applications' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('applications')}
    if _COLUMN not in cols:
        op.add_column('applications', sa.Column(_COLUMN, sa.Boolean(), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'applications' not in set(inspector.get_table_names()):
        return
    cols = {c['name'] for c in inspector.get_columns('applications')}
    if _COLUMN in cols:
        op.drop_column('applications', _COLUMN)
