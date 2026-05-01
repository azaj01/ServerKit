"""
Plugins API - Install, manage, and uninstall ServerKit plugins.

Supports installing plugins from:
  - GitHub repo URLs (resolves latest release automatically)
  - GitHub release URLs (specific version)
  - Direct zip download URLs
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app.services.audit_service import AuditService
from app.models.audit_log import AuditLog

plugins_bp = Blueprint('plugins', __name__)


def get_current_user():
    from flask_jwt_extended import get_jwt_identity
    from app.models.user import User
    return User.query.get(get_jwt_identity())


@plugins_bp.route('/', methods=['GET'])
@jwt_required()
def list_plugins():
    """List all installed plugins."""
    from app.services.plugin_service import list_plugins
    status = request.args.get('status')
    plugins = list_plugins(status=status)
    return jsonify({'plugins': [p.to_dict() for p in plugins]})


@plugins_bp.route('/<int:plugin_id>', methods=['GET'])
@jwt_required()
def get_plugin(plugin_id):
    """Get details of an installed plugin."""
    from app.services.plugin_service import get_plugin
    plugin = get_plugin(plugin_id)
    if not plugin:
        return jsonify({'error': 'Plugin not found'}), 404
    return jsonify(plugin.to_dict())


@plugins_bp.route('/install', methods=['POST'])
@jwt_required()
def install_plugin():
    """Install a plugin from a URL.

    Body: { "url": "https://github.com/user/repo" }

    Accepts:
      - GitHub repo URL (downloads latest release)
      - GitHub release URL (specific version)
      - Direct .zip URL
    """
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json()
    if not data or 'url' not in data:
        return jsonify({'error': 'url required'}), 400

    url = data['url'].strip()
    if not url:
        return jsonify({'error': 'url cannot be empty'}), 400

    from app.services.plugin_service import install_from_url
    try:
        plugin = install_from_url(url, user_id=user.id)
        AuditService.log(
            action=AuditLog.ACTION_RESOURCE_CREATE,
            user_id=user.id,
            target_type='plugin',
            target_id=plugin.id,
            details={'name': plugin.name, 'version': plugin.version, 'url': url}
        )
        return jsonify(plugin.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Installation failed: {e}'}), 500


@plugins_bp.route('/install-local', methods=['POST'])
@jwt_required()
def install_plugin_local():
    """Install a plugin from a local directory on the panel host.

    Body: { "path": "/abs/path/to/plugin-folder" }

    Intended for plugin development: point at the working tree, install,
    iterate. The path must exist on the panel host's filesystem and
    contain a plugin.json. The folder is zipped in memory and run
    through the same install pipeline as URL/upload installs, so
    behavior matches.
    """
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json() or {}
    path = (data.get('path') or '').strip()
    if not path:
        return jsonify({'error': 'path required'}), 400

    from app.services.plugin_service import install_from_path
    try:
        plugin = install_from_path(path, user_id=user.id)
        AuditService.log(
            action=AuditLog.ACTION_RESOURCE_CREATE,
            user_id=user.id,
            target_type='plugin',
            target_id=plugin.id,
            details={'name': plugin.name, 'version': plugin.version, 'path': path, 'source': 'local'}
        )
        return jsonify(plugin.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Installation failed: {e}'}), 500


@plugins_bp.route('/install-upload', methods=['POST'])
@jwt_required()
def install_plugin_upload():
    """Install a plugin from an uploaded zip file.

    Multipart: file=<plugin.zip>

    Cap at 50 MB. Anything that needs to be bigger probably belongs in
    a release artifact installed via /install instead.
    """
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded (use multipart field "file")'}), 400

    f = request.files['file']
    if not f or not f.filename:
        return jsonify({'error': 'No file uploaded'}), 400

    raw = f.read()
    max_bytes = 50 * 1024 * 1024
    if len(raw) > max_bytes:
        return jsonify({'error': f'Upload exceeds {max_bytes // (1024 * 1024)} MB cap'}), 413

    from app.services.plugin_service import install_from_zip
    try:
        plugin = install_from_zip(raw, user_id=user.id, source_name=f.filename)
        AuditService.log(
            action=AuditLog.ACTION_RESOURCE_CREATE,
            user_id=user.id,
            target_type='plugin',
            target_id=plugin.id,
            details={
                'name': plugin.name, 'version': plugin.version,
                'filename': f.filename, 'source': 'upload',
            }
        )
        return jsonify(plugin.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Installation failed: {e}'}), 500


@plugins_bp.route('/<int:plugin_id>', methods=['DELETE'])
@jwt_required()
def uninstall_plugin(plugin_id):
    """Uninstall a plugin (removes files and DB record)."""
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    from app.services.plugin_service import uninstall_plugin, get_plugin
    plugin = get_plugin(plugin_id)
    if not plugin:
        return jsonify({'error': 'Plugin not found'}), 404

    plugin_name = plugin.name
    uninstall_plugin(plugin_id)

    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_DELETE,
        user_id=user.id,
        target_type='plugin',
        target_id=plugin_id,
        details={'name': plugin_name}
    )
    return jsonify({'message': f'Plugin {plugin_name} uninstalled. Restart to fully unload backend routes.'})


@plugins_bp.route('/<int:plugin_id>/enable', methods=['POST'])
@jwt_required()
def enable_plugin(plugin_id):
    """Enable a disabled plugin."""
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    from app.services.plugin_service import enable_plugin
    plugin = enable_plugin(plugin_id)
    if not plugin:
        return jsonify({'error': 'Plugin not found'}), 404
    return jsonify(plugin.to_dict())


@plugins_bp.route('/<int:plugin_id>/disable', methods=['POST'])
@jwt_required()
def disable_plugin(plugin_id):
    """Disable a plugin without removing it."""
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    from app.services.plugin_service import disable_plugin
    plugin = disable_plugin(plugin_id)
    if not plugin:
        return jsonify({'error': 'Plugin not found'}), 404
    return jsonify(plugin.to_dict())
