from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app.services.marketplace_service import MarketplaceService
from app.services.audit_service import AuditService
from app.models.audit_log import AuditLog

marketplace_bp = Blueprint('marketplace', __name__)


def get_current_user():
    from flask_jwt_extended import get_jwt_identity
    from app.models.user import User
    return User.query.get(get_jwt_identity())


@marketplace_bp.route('', methods=['GET'])
@marketplace_bp.route('/', methods=['GET'])
@jwt_required()
def list_extensions():
    category = request.args.get('category')
    search = request.args.get('search')
    extensions = MarketplaceService.list_extensions(category=category, search=search)
    return jsonify({'extensions': [e.to_dict() for e in extensions]})


@marketplace_bp.route('/categories', methods=['GET'])
@jwt_required()
def get_categories():
    return jsonify({'categories': MarketplaceService.get_categories()})


@marketplace_bp.route('/<int:ext_id>', methods=['GET'])
@jwt_required()
def get_extension(ext_id):
    ext = MarketplaceService.get_extension(ext_id)
    if not ext:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(ext.to_dict())


@marketplace_bp.route('', methods=['POST'])
@marketplace_bp.route('/', methods=['POST'])
@jwt_required()
def create_extension():
    user = get_current_user()
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({'error': 'name required'}), 400
    try:
        ext = MarketplaceService.create_extension(data, user.id)
        AuditService.log(
            action=AuditLog.ACTION_RESOURCE_CREATE,
            user_id=user.id,
            target_type='marketplace_extension',
            target_id=ext.id,
            details={'name': ext.name, 'slug': ext.slug, 'version': ext.version},
        )
        return jsonify(ext.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@marketplace_bp.route('/<int:ext_id>', methods=['PUT'])
@jwt_required()
def update_extension(ext_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json()
    ext = MarketplaceService.update_extension(ext_id, data)
    if not ext:
        return jsonify({'error': 'Not found'}), 404
    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_UPDATE,
        user_id=user.id,
        target_type='marketplace_extension',
        target_id=ext.id,
        details={'name': ext.name, 'slug': ext.slug, 'updated_fields': sorted((data or {}).keys())},
    )
    return jsonify(ext.to_dict())


@marketplace_bp.route('/<int:ext_id>/publish', methods=['POST'])
@jwt_required()
def publish_extension(ext_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    ext = MarketplaceService.publish_extension(ext_id)
    if not ext:
        return jsonify({'error': 'Not found'}), 404
    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_UPDATE,
        user_id=user.id,
        target_type='marketplace_extension',
        target_id=ext.id,
        details={'name': ext.name, 'slug': ext.slug, 'status': ext.status, 'operation': 'publish'},
    )
    return jsonify(ext.to_dict())


@marketplace_bp.route('/<int:ext_id>', methods=['DELETE'])
@jwt_required()
def delete_extension(ext_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    ext = MarketplaceService.get_extension(ext_id)
    audit_details = {'name': ext.name if ext else None, 'slug': ext.slug if ext else None}
    if not MarketplaceService.delete_extension(ext_id):
        return jsonify({'error': 'Not found'}), 404
    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_DELETE,
        user_id=user.id,
        target_type='marketplace_extension',
        target_id=ext_id,
        details=audit_details,
    )
    return jsonify({'message': 'Extension deleted'})


# --- Installation ---

@marketplace_bp.route('/<int:ext_id>/install', methods=['POST'])
@jwt_required()
def install_extension(ext_id):
    user = get_current_user()
    # Marketplace installs now trigger a real plugin install when the
    # extension carries a source URL — that runs arbitrary downloaded
    # code and writes to disk, so it must require admin. /plugins/install
    # already enforces this; we mirror the check here.
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json() or {}
    try:
        install = MarketplaceService.install_extension(ext_id, user.id, data.get('config'))
        AuditService.log(
            action=AuditLog.ACTION_RESOURCE_INSTALL,
            user_id=user.id,
            target_type='marketplace_extension',
            target_id=ext_id,
            details={
                'install_id': install.id,
                'extension_id': install.extension_id,
                'extension_name': install.extension.display_name if install.extension else None,
                'version': install.installed_version,
            },
        )
        return jsonify(install.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@marketplace_bp.route('/installs/<int:install_id>', methods=['DELETE'])
@jwt_required()
def uninstall_extension(install_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    install = MarketplaceService.get_install(install_id)
    audit_details = {
        'extension_id': install.extension_id if install else None,
        'extension_name': install.extension.display_name if install and install.extension else None,
    }
    if not MarketplaceService.uninstall_extension(install_id):
        return jsonify({'error': 'Not found'}), 404
    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_UNINSTALL,
        user_id=user.id,
        target_type='marketplace_extension_install',
        target_id=install_id,
        details=audit_details,
    )
    return jsonify({'message': 'Extension uninstalled'})


@marketplace_bp.route('/installs/<int:install_id>/config', methods=['PUT'])
@jwt_required()
def update_config(install_id):
    user = get_current_user()
    data = request.get_json() or {}
    install = MarketplaceService.update_extension_config(install_id, data.get('config', {}))
    if not install:
        return jsonify({'error': 'Not found'}), 404
    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_UPDATE,
        user_id=user.id if user else None,
        target_type='marketplace_extension_install',
        target_id=install.id,
        details={
            'extension_id': install.extension_id,
            'extension_name': install.extension.display_name if install.extension else None,
            'operation': 'update_config',
        },
    )
    return jsonify(install.to_dict())


@marketplace_bp.route('/my-extensions', methods=['GET'])
@jwt_required()
def my_extensions():
    user = get_current_user()
    installs = MarketplaceService.get_user_extensions(user.id)
    return jsonify({'extensions': [i.to_dict() for i in installs]})


@marketplace_bp.route('/<int:ext_id>/rate', methods=['POST'])
@jwt_required()
def rate_extension(ext_id):
    data = request.get_json() or {}
    rating = data.get('rating')
    if rating is None or not (1 <= rating <= 5):
        return jsonify({'error': 'Rating must be 1-5'}), 400
    ext = MarketplaceService.rate_extension(ext_id, rating)
    if not ext:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(ext.to_dict())
