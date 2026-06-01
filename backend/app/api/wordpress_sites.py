"""
WordPress Sites API — environment sync, database snapshots, and Git integration.

ROUTING NOTE: the WordPress "hub" surface (list/create/get/delete sites,
environment CRUD, plugins, themes, core update) is owned by ``wordpress_bp``
(``app/api/wordpress.py``) — the Docker-stack model the UI actually creates
against. This blueprint owns ONLY the routes that do not overlap with it:
environment sync, database snapshots, clone-db, and Git integration. Both
blueprints mount at ``/api/v1/wordpress``; their route paths are kept disjoint
so neither shadows the other (a duplicate rule would be silently unreachable
because Flask resolves the first-registered match).
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import json

from app import db
from app.models.application import Application
from app.models.wordpress_site import WordPressSite, DatabaseSnapshot
from app.services.wordpress_env_service import WordPressEnvService
from app.services.db_sync_service import DatabaseSyncService
from app.services.git_wordpress_service import GitWordPressService

wordpress_sites_bp = Blueprint('wordpress_sites', __name__)


# =============================================================================
# Environment Sync
# =============================================================================

@wordpress_sites_bp.route('/sites/<int:site_id>/sync', methods=['POST'])
@jwt_required()
def sync_environment(site_id):
    """Sync an environment from its production source."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    if site.is_production:
        return jsonify({'error': 'Cannot sync a production site'}), 400

    result = WordPressEnvService.sync_environment(site_id, options=data)
    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Database Operations
# =============================================================================

@wordpress_sites_bp.route('/sites/<int:site_id>/snapshots', methods=['GET'])
@jwt_required()
def list_snapshots(site_id):
    """List database snapshots for a site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    snapshots = DatabaseSnapshot.query.filter_by(site_id=site_id).order_by(
        DatabaseSnapshot.created_at.desc()
    ).all()

    return jsonify({
        'snapshots': [s.to_dict() for s in snapshots],
        'total': len(snapshots)
    })


@wordpress_sites_bp.route('/sites/<int:site_id>/snapshots', methods=['POST'])
@jwt_required()
def create_snapshot(site_id):
    """Create a database snapshot."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = DatabaseSyncService.create_snapshot(
        db_name=site.db_name,
        name=data.get('name', f"{site.application.name}_{site.id}"),
        tag=data.get('tag'),
        commit_sha=site.last_deploy_commit,
        host=site.db_host,
        user=site.db_user,
        password=WordPressEnvService._get_db_password(site),
        exclude_tables=data.get('exclude_tables', [])
    )

    if result['success']:
        # Save to database
        snapshot = DatabaseSnapshot(
            site_id=site_id,
            name=result['snapshot']['name'],
            tag=data.get('tag'),
            file_path=result['snapshot']['file_path'],
            size_bytes=result['snapshot']['size_bytes'],
            compressed=result['snapshot']['compressed'],
            commit_sha=site.last_deploy_commit,
            tables_included=json.dumps(result['snapshot'].get('tables', [])),
            row_count=result['snapshot'].get('row_count', 0),
            status='completed'
        )
        db.session.add(snapshot)
        db.session.commit()

        return jsonify({
            'success': True,
            'snapshot': snapshot.to_dict()
        }), 201
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/snapshots/<int:snapshot_id>/restore', methods=['POST'])
@jwt_required()
def restore_snapshot(site_id, snapshot_id):
    """Restore a database snapshot."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    snapshot = DatabaseSnapshot.query.filter_by(id=snapshot_id, site_id=site_id).first()
    if not snapshot:
        return jsonify({'error': 'Snapshot not found'}), 404

    # Create a backup before restoring
    backup_result = DatabaseSyncService.create_snapshot(
        db_name=site.db_name,
        name=f"pre_restore_{snapshot_id}",
        tag='pre-restore',
        host=site.db_host,
        user=site.db_user,
        password=WordPressEnvService._get_db_password(site)
    )

    # Restore the snapshot
    result = DatabaseSyncService.restore_snapshot(
        file_path=snapshot.file_path,
        target_db=site.db_name,
        host=site.db_host,
        user=site.db_user,
        password=WordPressEnvService._get_db_password(site),
        create_db=False
    )

    if result['success']:
        return jsonify({
            'success': True,
            'message': 'Snapshot restored',
            'backup_path': backup_result.get('snapshot', {}).get('file_path') if backup_result.get('success') else None
        })
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/snapshots/<int:snapshot_id>', methods=['DELETE'])
@jwt_required()
def delete_snapshot(site_id, snapshot_id):
    """Delete a database snapshot."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    snapshot = DatabaseSnapshot.query.filter_by(id=snapshot_id, site_id=site_id).first()
    if not snapshot:
        return jsonify({'error': 'Snapshot not found'}), 404

    # Delete file
    DatabaseSyncService.delete_snapshot(snapshot.file_path)

    # Delete record
    db.session.delete(snapshot)
    db.session.commit()

    return jsonify({'success': True, 'message': 'Snapshot deleted'})


@wordpress_sites_bp.route('/sites/<int:site_id>/clone-db', methods=['POST'])
@jwt_required()
def clone_database(site_id):
    """Clone the database to another environment."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    target_site_id = data.get('target_site_id')
    if not target_site_id:
        return jsonify({'error': 'target_site_id is required'}), 400

    target_site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == target_site_id,
        Application.user_id == user_id
    ).first()

    if not target_site:
        return jsonify({'error': 'Target site not found'}), 404

    result = DatabaseSyncService.clone_database(
        source_db=site.db_name,
        target_db=target_site.db_name,
        source_host=site.db_host,
        target_host=target_site.db_host,
        source_user=site.db_user,
        target_user=target_site.db_user,
        source_password=WordPressEnvService._get_db_password(site),
        target_password=WordPressEnvService._get_db_password(target_site),
        options=data.get('options', {})
    )

    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Git Integration
# =============================================================================

@wordpress_sites_bp.route('/sites/<int:site_id>/git', methods=['GET'])
@jwt_required()
def get_git_status(site_id):
    """Get Git integration status for a site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = GitWordPressService.get_git_status(site_id)
    return jsonify(result)


@wordpress_sites_bp.route('/sites/<int:site_id>/git', methods=['POST'])
@jwt_required()
def connect_repo(site_id):
    """Connect a Git repository to a site."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    repo_url = data.get('repo_url')
    if not repo_url:
        return jsonify({'error': 'repo_url is required'}), 400

    result = GitWordPressService.connect_repo(
        site_id=site_id,
        repo_url=repo_url,
        branch=data.get('branch', 'main'),
        paths=data.get('paths'),
        auto_deploy=data.get('auto_deploy', False)
    )

    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/git', methods=['DELETE'])
@jwt_required()
def disconnect_repo(site_id):
    """Disconnect Git repository from a site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = GitWordPressService.disconnect_repo(site_id)
    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/git/commits', methods=['GET'])
@jwt_required()
def get_commits(site_id):
    """Get recent commits from the connected repository."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    limit = request.args.get('limit', 20, type=int)
    result = GitWordPressService.get_recent_commits(site_id, limit=limit)
    return jsonify(result)


@wordpress_sites_bp.route('/sites/<int:site_id>/git/deploy', methods=['POST'])
@jwt_required()
def deploy_commit(site_id):
    """Deploy a specific commit or branch."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = GitWordPressService.deploy_from_commit(
        site_id=site_id,
        commit_sha=data.get('commit_sha'),
        branch=data.get('branch'),
        create_snapshot=data.get('create_snapshot', True)
    )

    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/git/dev-from-commit', methods=['POST'])
@jwt_required()
def create_dev_from_commit(site_id):
    """Create a development environment for a specific commit."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    commit_sha = data.get('commit_sha')
    if not commit_sha:
        return jsonify({'error': 'commit_sha is required'}), 400

    result = GitWordPressService.create_dev_for_commit(
        production_site_id=site_id,
        commit_sha=commit_sha,
        config=data.get('config', {}),
        user_id=user_id
    )

    if result['success']:
        return jsonify(result), 201
    else:
        return jsonify(result), 500
