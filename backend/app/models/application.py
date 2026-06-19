from datetime import datetime
from app import db


class Application(db.Model):
    __tablename__ = 'applications'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    app_type = db.Column(db.String(50), nullable=False)  # 'php', 'wordpress', 'flask', 'django', 'docker', 'static'
    status = db.Column(db.String(20), default='stopped')  # 'running', 'stopped', 'error', 'deploying'

    # Configuration
    php_version = db.Column(db.String(10), nullable=True)  # '8.0', '8.1', '8.2', '8.3'
    python_version = db.Column(db.String(10), nullable=True)  # '3.9', '3.10', '3.11', '3.12'
    port = db.Column(db.Integer, nullable=True)
    root_path = db.Column(db.String(500), nullable=True)

    # Docker specific
    docker_image = db.Column(db.String(200), nullable=True)
    container_id = db.Column(db.String(100), nullable=True)

    # Source / lifecycle: github (repo clone), template (built-in template),
    # manual (local path already on server), upload (zip upload managed by ServerKit)
    source = db.Column(db.String(20), default='github', nullable=False)

    # Manual / local service configuration
    compose_file = db.Column(db.String(200), nullable=True)
    systemd_unit = db.Column(db.String(100), nullable=True)
    managed_by = db.Column(db.String(20), nullable=True)  # 'docker_compose', 'systemd'

    # Upload versioning
    version = db.Column(db.Integer, default=0, nullable=False)
    upload_path = db.Column(db.String(500), nullable=True)

    # Private URL feature
    private_slug = db.Column(db.String(50), unique=True, nullable=True, index=True)
    private_url_enabled = db.Column(db.Boolean, default=False)

    # Environment linking
    environment_type = db.Column(db.String(20), default='standalone')  # 'production', 'development', 'staging', 'standalone'
    linked_app_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=True)
    shared_config = db.Column(db.Text, nullable=True)  # JSON string for shared resources

    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_deployed_at = db.Column(db.DateTime, nullable=True)

    # Foreign keys
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=True, index=True)
    # Workspace scoping (#33). Nullable: existing rows are backfilled to a default
    # workspace by migration 015; new rows are stamped on create.
    workspace_id = db.Column(db.Integer, db.ForeignKey('workspaces.id'), nullable=True, index=True)

    # Relationships
    # Use 'subquery' to eagerly load domains in a single query, avoiding N+1
    domains = db.relationship('Domain', backref='application', lazy='subquery', cascade='all, delete-orphan')
    linked_app = db.relationship('Application', remote_side=[id], backref='linked_from', foreign_keys=[linked_app_id])
    server = db.relationship('Server', backref=db.backref('applications', lazy='dynamic'))

    def to_dict(self, include_linked=False):
        import json
        result = {
            'id': self.id,
            'name': self.name,
            'app_type': self.app_type,
            'status': self.status,
            'php_version': self.php_version,
            'python_version': self.python_version,
            'port': self.port,
            'root_path': self.root_path,
            'docker_image': self.docker_image,
            'container_id': self.container_id,
            'source': self.source,
            'compose_file': self.compose_file,
            'systemd_unit': self.systemd_unit,
            'managed_by': self.managed_by,
            'version': self.version,
            'upload_path': self.upload_path,
            'private_slug': self.private_slug,
            'private_url_enabled': self.private_url_enabled,
            'environment_type': self.environment_type,
            'linked_app_id': self.linked_app_id,
            'shared_config': json.loads(self.shared_config) if self.shared_config else None,
            'has_linked_app': self.linked_app_id is not None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'last_deployed_at': self.last_deployed_at.isoformat() if self.last_deployed_at else None,
            'user_id': self.user_id,
            'server_id': self.server_id,
            'workspace_id': self.workspace_id,
            'server_name': self.server.name if self.server else 'Local server',
            'domains': [d.to_dict() for d in self.domains]
        }

        # Lightweight image-scan badge (latest scan only)
        latest_scan = self.image_scans.first()
        if latest_scan:
            result['image_scan'] = {
                'status': latest_scan.status,
                'highest_severity': latest_scan.highest_severity,
                'severity_counts': latest_scan.get_counts(),
                'scanned_at': latest_scan.completed_at.isoformat() if latest_scan.completed_at else None,
            }
        else:
            result['image_scan'] = None
        if include_linked and self.linked_app:
            result['linked_app'] = {
                'id': self.linked_app.id,
                'name': self.linked_app.name,
                'environment_type': self.linked_app.environment_type,
                'status': self.linked_app.status
            }
        return result

    def __repr__(self):
        return f'<Application {self.name}>'
