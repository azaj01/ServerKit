import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application, WordPressSite
from app.services.wordpress_service import WordPressService
from app import db

wordpress_bp = Blueprint('wordpress', __name__)


def _resolve_app(site_or_app_id):
    """Resolve an ID to an Application. Tries WordPressSite first, then Application."""
    wp_site = WordPressSite.query.get(site_or_app_id)
    if wp_site and wp_site.application:
        return wp_site.application
    return Application.query.get(site_or_app_id)


# ==================== WORDPRESS SITES HUB ENDPOINTS ====================

@wordpress_bp.route('/sites', methods=['GET'])
@jwt_required()
def list_sites():
    """List all WordPress sites (production sites with environment counts)."""
    result = WordPressService.get_sites()
    return jsonify(result), 200


@wordpress_bp.route('/sites', methods=['POST'])
@jwt_required()
def create_site():
    """Create a new WordPress site via Docker."""
    data = request.get_json() or {}
    name = data.get('name')
    admin_email = data.get('adminEmail', '')
    php_version = data.get('phpVersion') or None
    enable_page_cache = bool(data.get('enablePageCache'))
    enable_object_cache = bool(data.get('enableObjectCache'))

    if not name:
        return jsonify({'error': 'Site name is required'}), 400

    if php_version and php_version not in WordPressService.get_available_php_versions():
        return jsonify({'error': f'Unsupported PHP version: {php_version}'}), 400

    current_user_id = get_jwt_identity()
    result = WordPressService.create_site(
        name, admin_email, current_user_id,
        php_version=php_version,
        enable_page_cache=enable_page_cache,
        enable_object_cache=enable_object_cache,
    )

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@wordpress_bp.route('/sites/import', methods=['POST'])
@jwt_required()
def import_site():
    """Import an existing WordPress site from an uploaded SQL dump (multipart)."""
    import os
    import tempfile
    name = request.form.get('name')
    admin_email = request.form.get('adminEmail', '')
    old_url = request.form.get('oldUrl', '').strip()
    if not name:
        return jsonify({'error': 'Site name is required'}), 400
    if not old_url:
        return jsonify({'error': 'Original site URL (old_url) is required for search-replace'}), 400
    if 'sql' not in request.files:
        return jsonify({'error': 'A .sql or .sql.gz database dump is required'}), 400
    sql_file = request.files['sql']
    if not sql_file.filename:
        return jsonify({'error': 'No SQL file selected'}), 400
    fname = sql_file.filename.lower()
    if not (fname.endswith('.sql') or fname.endswith('.sql.gz') or fname.endswith('.gz')):
        return jsonify({'error': 'Dump must be a .sql or .sql.gz file'}), 400

    suffix = '.sql.gz' if fname.endswith('.gz') else '.sql'
    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix='wp_import_')
    os.close(fd)
    try:
        sql_file.save(tmp_path)
        current_user_id = get_jwt_identity()
        result = WordPressService.import_site(
            name=name,
            admin_email=admin_email,
            user_id=current_user_id,
            sql_path=tmp_path,
            old_url=old_url,
        )
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    return (jsonify(result), 201) if result.get('success') else (jsonify(result), 400)


@wordpress_bp.route('/sites/<int:site_id>', methods=['GET'])
@jwt_required()
def get_site(site_id):
    """Get site detail with environments."""
    result = WordPressService.get_site(site_id)
    if 'error' in result:
        return jsonify(result), 404
    return jsonify(result), 200


@wordpress_bp.route('/sites/<int:site_id>/clone', methods=['POST'])
@jwt_required()
def clone_site(site_id):
    """Clone a site into a new INDEPENDENT top-level site with fresh admin creds."""
    data = request.get_json() or {}
    new_name = data.get('name')
    if not new_name:
        return jsonify({'error': 'New site name is required'}), 400

    current_user_id = get_jwt_identity()
    result = WordPressService.clone_site(site_id, new_name, current_user_id)
    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@wordpress_bp.route('/sites/<int:site_id>/tags', methods=['PATCH'])
@jwt_required()
def set_site_tags(site_id):
    """Replace the tag list for a WordPress site."""
    data = request.get_json() or {}
    tags = data.get('tags')
    if tags is None or not isinstance(tags, list):
        return jsonify({'error': 'tags must be a list'}), 400

    site = WordPressSite.query.get(site_id)
    if not site:
        return jsonify({'error': 'Site not found'}), 404

    # Normalize: strings only, trimmed, non-empty, de-duplicated (order-preserving)
    seen = set()
    cleaned = []
    for t in tags:
        if not isinstance(t, str):
            continue
        v = t.strip()
        if v and v.lower() not in seen:
            seen.add(v.lower())
            cleaned.append(v)

    import json as _json
    site.tags = _json.dumps(cleaned)
    db.session.commit()
    return jsonify({'success': True, 'tags': cleaned}), 200


@wordpress_bp.route('/sites/<int:site_id>', methods=['DELETE'])
@jwt_required()
def delete_site(site_id):
    """Delete site and all its environments (takes a final backup by default)."""
    # Back up before delete unless explicitly opted out via ?create_backup=false
    create_backup = request.args.get('create_backup', 'true').lower() != 'false'
    result = WordPressService.delete_site(site_id, create_backup=create_backup)
    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@wordpress_bp.route('/sites/<int:site_id>/archive', methods=['POST'])
@jwt_required()
def archive_site(site_id):
    """Archive a site: stop the stack but keep all data. Reversible."""
    result = WordPressService.archive_site(site_id)
    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@wordpress_bp.route('/sites/<int:site_id>/unarchive', methods=['POST'])
@jwt_required()
def unarchive_site(site_id):
    """Restore a previously archived site."""
    result = WordPressService.unarchive_site(site_id)
    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@wordpress_bp.route('/sites/<int:site_id>/environments', methods=['GET'])
@jwt_required()
def list_environments(site_id):
    """List environments for a site."""
    result = WordPressService.get_environments(site_id)
    if 'error' in result:
        return jsonify(result), 404
    return jsonify(result), 200


@wordpress_bp.route('/sites/<int:site_id>/environments', methods=['POST'])
@jwt_required()
def create_environment(site_id):
    """Create a staging or development environment."""
    data = request.get_json() or {}
    env_type = data.get('type', '')

    if not env_type:
        return jsonify({'error': 'Environment type is required'}), 400

    current_user_id = get_jwt_identity()
    result = WordPressService.create_environment(site_id, env_type, current_user_id)

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@wordpress_bp.route('/sites/<int:site_id>/environments/<int:env_id>', methods=['DELETE'])
@jwt_required()
def delete_environment(site_id, env_id):
    """Delete a non-production environment."""
    result = WordPressService.delete_environment(env_id)
    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


# ==================== STANDALONE WORDPRESS (DOCKER) ENDPOINTS ====================

@wordpress_bp.route('/standalone/status', methods=['GET'])
@jwt_required()
def get_standalone_status():
    """Get WordPress standalone installation status."""
    result = WordPressService.get_wordpress_standalone_status()
    return jsonify(result), 200


@wordpress_bp.route('/standalone/requirements', methods=['GET'])
@jwt_required()
def get_standalone_requirements():
    """Get resource requirements for WordPress installation."""
    result = WordPressService.get_wordpress_resource_requirements()
    return jsonify(result), 200


@wordpress_bp.route('/standalone/install', methods=['POST'])
@jwt_required()
def install_standalone():
    """Install WordPress via Docker Compose."""
    data = request.get_json() or {}

    result = WordPressService.install_wordpress_standalone(
        admin_email=data.get('adminEmail')
    )

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@wordpress_bp.route('/standalone/uninstall', methods=['POST'])
@jwt_required()
def uninstall_standalone():
    """Uninstall standalone WordPress and optionally remove data."""
    data = request.get_json() or {}

    result = WordPressService.uninstall_wordpress_standalone(
        remove_data=data.get('removeData', False)
    )

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@wordpress_bp.route('/standalone/start', methods=['POST'])
@jwt_required()
def start_standalone():
    """Start WordPress containers."""
    result = WordPressService.start_wordpress_standalone()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@wordpress_bp.route('/standalone/stop', methods=['POST'])
@jwt_required()
def stop_standalone():
    """Stop WordPress containers."""
    result = WordPressService.stop_wordpress_standalone()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@wordpress_bp.route('/standalone/restart', methods=['POST'])
@jwt_required()
def restart_standalone():
    """Restart WordPress containers."""
    result = WordPressService.restart_wordpress_standalone()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


# ==================== LEGACY WP-CLI ENDPOINTS ====================

def admin_required(fn):
    """Decorator to require admin role."""
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return fn(*args, **kwargs)
    return wrapper


@wordpress_bp.route('/install', methods=['POST'])
@jwt_required()
@admin_required
def install_wordpress():
    """Install a new WordPress site."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required_fields = ['path', 'site_url', 'admin_email', 'db_name', 'db_user', 'db_password']
    missing = [f for f in required_fields if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    result = WordPressService.install_wordpress(data['path'], data)

    if result['success']:
        # Create application record
        current_user_id = get_jwt_identity()
        app = Application(
            name=data.get('site_title', 'WordPress Site'),
            app_type='wordpress',
            status='running',
            php_version=data.get('php_version', '8.2'),
            root_path=data['path'],
            user_id=current_user_id
        )
        db.session.add(app)
        db.session.commit()
        result['app_id'] = app.id

    return jsonify(result), 201 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/php', methods=['GET'])
@jwt_required()
def get_php(app_id):
    """Live PHP version + ini limits for a Docker WP site (read-only)."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403
    info = WordPressService.get_php_info(app.root_path)
    info['available_versions'] = WordPressService.get_available_php_versions()
    return jsonify({'php': info}), 200


@wordpress_bp.route('/sites/<int:app_id>/php', methods=['POST'])
@jwt_required()
@admin_required
def set_php(app_id):
    """Switch the Docker WP site's PHP version (swaps image tag + recreates)."""
    app = _resolve_app(app_id)
    data = request.get_json() or {}
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if app.app_type not in ('wordpress', 'docker'):
        return jsonify({'error': 'Application is not a WordPress site'}), 400
    version = data.get('version')
    if not version:
        return jsonify({'error': 'version is required'}), 400
    result = WordPressService.set_php_version(app.root_path, version)
    return jsonify(result), 200 if result.get('success') else 400


def _site_status_target(wp_site):
    """Best-effort public URL for a managed site's status-page component.
    Prefers a primary domain (https when SSL), falls back to the local port.
    The component is health-driven, so this is mainly cosmetic / manual-probe."""
    app = wp_site.application
    if not app:
        return ''
    try:
        domains = list(app.domains)
    except Exception:
        domains = []
    primary = next((d for d in domains if getattr(d, 'is_primary', False)),
                   domains[0] if domains else None)
    if primary and getattr(primary, 'name', None):
        scheme = 'https' if getattr(primary, 'ssl_enabled', False) else 'http'
        return f'{scheme}://{primary.name}'
    # No public domain yet — leave the probe target empty rather than storing an
    # internal localhost:port (the component is health-driven, not network-probed).
    return ''


@wordpress_bp.route('/sites/<int:app_id>/status-page', methods=['GET'])
@jwt_required()
def get_site_status_page(app_id):
    """Return the site's live health + bound status-page component (if any) and
    the status pages it can be attached to."""
    from app.models.status_page import StatusPage, StatusComponent
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403
    wp_site = WordPressSite.query.filter_by(application_id=app.id).first()
    component = None
    if wp_site:
        comp = StatusComponent.query.filter_by(wordpress_site_id=wp_site.id).first()
        component = comp.to_dict() if comp else None
    pages = [{'id': p.id, 'name': p.name, 'slug': p.slug}
             for p in StatusPage.query.order_by(StatusPage.name).all()]
    return jsonify({
        'health_status': wp_site.health_status if wp_site else None,
        'last_health_check': (wp_site.last_health_check.isoformat()
                              if wp_site and wp_site.last_health_check else None),
        'component': component,
        'pages': pages,
    }), 200


@wordpress_bp.route('/sites/<int:app_id>/status-page', methods=['POST'])
@jwt_required()
@admin_required
def attach_site_status_page(app_id):
    """Attach a managed site to a status page as a health-driven component."""
    from app.models.status_page import StatusPage, StatusComponent
    from app.services.status_page_service import StatusPageService
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    wp_site = WordPressSite.query.filter_by(application_id=app.id).first()
    if not wp_site:
        return jsonify({'error': 'Not a WordPress site'}), 400
    if not wp_site.is_production:
        # The health poller only sweeps production sites, so a component bound to
        # a staging/dev environment would never accrue uptime — reject it.
        return jsonify({'error': 'Only production sites can be added to a status page'}), 400
    data = request.get_json() or {}
    page_id = data.get('page_id')
    if not page_id:
        return jsonify({'error': 'page_id is required'}), 400
    if not StatusPage.query.get(page_id):
        return jsonify({'error': 'Status page not found'}), 404
    existing = StatusComponent.query.filter_by(wordpress_site_id=wp_site.id).first()
    if existing:
        return jsonify({'error': 'Site is already on a status page',
                        'component': existing.to_dict()}), 409
    comp = StatusPageService.create_component(page_id, {
        'name': app.name,
        'group': 'WordPress',
        'check_type': 'http',
        'check_target': _site_status_target(wp_site),
        'wordpress_site_id': wp_site.id,
    })
    return jsonify({'success': True, 'component': comp.to_dict()}), 201


@wordpress_bp.route('/sites/<int:app_id>/status-page', methods=['DELETE'])
@jwt_required()
@admin_required
def detach_site_status_page(app_id):
    """Detach a managed site from its status page (removes the bound component)."""
    from app.models.status_page import StatusComponent
    from app.services.status_page_service import StatusPageService
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    wp_site = WordPressSite.query.filter_by(application_id=app.id).first()
    if not wp_site:
        return jsonify({'error': 'Not a WordPress site'}), 400
    removed = 0
    for comp in StatusComponent.query.filter_by(wordpress_site_id=wp_site.id).all():
        StatusPageService.delete_component(comp.id)
        removed += 1
    return jsonify({'success': True, 'removed': removed}), 200


@wordpress_bp.route('/sites/<int:app_id>/info', methods=['GET'])
@jwt_required()
def get_wordpress_info(app_id):
    """Get WordPress site info."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if app.app_type != 'wordpress':
        return jsonify({'error': 'Application is not a WordPress site'}), 400

    info = WordPressService.get_wordpress_info(app.root_path)
    if not info:
        return jsonify({'error': 'Could not get WordPress info'}), 400

    return jsonify({'info': info}), 200


@wordpress_bp.route('/sites/<int:app_id>/update', methods=['POST'])
@jwt_required()
@admin_required
def update_wordpress(app_id):
    """Update WordPress core."""
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if app.app_type != 'wordpress':
        return jsonify({'error': 'Application is not a WordPress site'}), 400

    result = WordPressService.update_wordpress(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


# Plugin management
@wordpress_bp.route('/sites/<int:app_id>/plugins', methods=['GET'])
@jwt_required()
def get_plugins(app_id):
    """Get installed plugins."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    plugins = WordPressService.get_plugins(app.root_path)
    return jsonify({'plugins': plugins}), 200


@wordpress_bp.route('/sites/<int:app_id>/plugins', methods=['POST'])
@jwt_required()
@admin_required
def install_plugin(app_id):
    """Install a plugin."""
    app = _resolve_app(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'plugin' not in data:
        return jsonify({'error': 'plugin is required'}), 400

    result = WordPressService.install_plugin(
        app.root_path,
        data['plugin'],
        data.get('activate', True)
    )
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/plugins/<plugin>', methods=['DELETE'])
@jwt_required()
@admin_required
def uninstall_plugin(app_id, plugin):
    """Uninstall a plugin."""
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.uninstall_plugin(app.root_path, plugin)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/plugins/<plugin>/activate', methods=['POST'])
@jwt_required()
@admin_required
def activate_plugin(app_id, plugin):
    """Activate a plugin."""
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.activate_plugin(app.root_path, plugin)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/plugins/<plugin>/deactivate', methods=['POST'])
@jwt_required()
@admin_required
def deactivate_plugin(app_id, plugin):
    """Deactivate a plugin."""
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.deactivate_plugin(app.root_path, plugin)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/plugins/update', methods=['POST'])
@jwt_required()
@admin_required
def update_plugins(app_id):
    """Update plugins."""
    app = _resolve_app(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    plugins = data.get('plugins') if data else None
    result = WordPressService.update_plugins(app.root_path, plugins)
    return jsonify(result), 200 if result['success'] else 400


# Theme management
@wordpress_bp.route('/sites/<int:app_id>/themes', methods=['GET'])
@jwt_required()
def get_themes(app_id):
    """Get installed themes."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    themes = WordPressService.get_themes(app.root_path)
    return jsonify({'themes': themes}), 200


@wordpress_bp.route('/sites/<int:app_id>/themes', methods=['POST'])
@jwt_required()
@admin_required
def install_theme(app_id):
    """Install a theme."""
    app = _resolve_app(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'theme' not in data:
        return jsonify({'error': 'theme is required'}), 400

    result = WordPressService.install_theme(
        app.root_path,
        data['theme'],
        data.get('activate', False)
    )
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/themes/update', methods=['POST'])
@jwt_required()
@admin_required
def update_themes(app_id):
    """Update themes."""
    app = _resolve_app(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    themes = data.get('themes') if data else None
    result = WordPressService.update_themes(app.root_path, themes)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/themes/<theme>/activate', methods=['POST'])
@jwt_required()
@admin_required
def activate_theme(app_id, theme):
    """Activate a theme."""
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.activate_theme(app.root_path, theme)
    return jsonify(result), 200 if result['success'] else 400


# Backup management
@wordpress_bp.route('/sites/<int:app_id>/backup', methods=['POST'])
@jwt_required()
@admin_required
def create_backup(app_id):
    """Create a backup."""
    app = _resolve_app(app_id)
    data = request.get_json() or {}

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.backup_wordpress(
        app.root_path,
        data.get('include_db', True)
    )
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/backups', methods=['GET'])
@jwt_required()
def list_backups(app_id):
    """List backups for a site."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    import os
    site_name = os.path.basename(app.root_path)
    backups = WordPressService.list_backups(site_name)
    return jsonify({'backups': backups}), 200


@wordpress_bp.route('/sites/<int:app_id>/restore', methods=['POST'])
@jwt_required()
@admin_required
def restore_backup(app_id):
    """Restore a backup."""
    app = _resolve_app(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'backup_name' not in data:
        return jsonify({'error': 'backup_name is required'}), 400

    result = WordPressService.restore_backup(data['backup_name'], app.root_path)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/backups/<backup_name>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_backup(backup_name):
    """Delete a backup."""
    result = WordPressService.delete_backup(backup_name)
    return jsonify(result), 200 if result['success'] else 400


# Security and maintenance
@wordpress_bp.route('/sites/<int:app_id>/harden', methods=['POST'])
@jwt_required()
@admin_required
def harden_wordpress(app_id):
    """Apply security hardening."""
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.harden_wordpress(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/search-replace', methods=['POST'])
@jwt_required()
@admin_required
def search_replace(app_id):
    """Search and replace in database."""
    app = _resolve_app(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'search' not in data or 'replace' not in data:
        return jsonify({'error': 'search and replace are required'}), 400

    result = WordPressService.search_replace(
        app.root_path,
        data['search'],
        data['replace'],
        data.get('dry_run', True)
    )
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/optimize', methods=['POST'])
@jwt_required()
@admin_required
def optimize_database(app_id):
    """Optimize WordPress database."""
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.optimize_database(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/page-cache', methods=['GET'])
@jwt_required()
def get_page_cache(app_id):
    """Report full-page cache plugin status for a site."""
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    return jsonify(WordPressService.get_page_cache_status(app.root_path)), 200


@wordpress_bp.route('/sites/<int:app_id>/page-cache', methods=['POST'])
@jwt_required()
@admin_required
def enable_page_cache(app_id):
    """Enable the full-page cache for a site."""
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    result = WordPressService.enable_page_cache(app.root_path)
    if result.get('success'):
        wp_site = WordPressSite.query.filter_by(application_id=app.id).first()
        if wp_site:
            cfg = json.loads(wp_site.sync_config) if wp_site.sync_config else {}
            cfg['page_cache_enabled'] = True
            wp_site.sync_config = json.dumps(cfg)
            db.session.commit()
    return jsonify(result), 200 if result.get('success') else 400


@wordpress_bp.route('/sites/<int:app_id>/page-cache', methods=['DELETE'])
@jwt_required()
@admin_required
def disable_page_cache(app_id):
    """Disable the full-page cache for a site."""
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    result = WordPressService.disable_page_cache(app.root_path)
    if result.get('success'):
        wp_site = WordPressSite.query.filter_by(application_id=app.id).first()
        if wp_site:
            cfg = json.loads(wp_site.sync_config) if wp_site.sync_config else {}
            cfg['page_cache_enabled'] = False
            wp_site.sync_config = json.dumps(cfg)
            db.session.commit()
    return jsonify(result), 200 if result.get('success') else 400


@wordpress_bp.route('/sites/<int:app_id>/object-cache', methods=['GET'])
@jwt_required()
def object_cache_status(app_id):
    """Report Redis object-cache state for a site."""
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    return jsonify(WordPressService.object_cache_status(app.root_path)), 200


@wordpress_bp.route('/sites/<int:app_id>/object-cache', methods=['POST'])
@jwt_required()
@admin_required
def enable_object_cache(app_id):
    """Enable Redis object cache (adds a redis container if needed, activates plugin)."""
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    result = WordPressService.enable_object_cache(app.root_path)
    return jsonify(result), 200 if result.get('success') else 400


@wordpress_bp.route('/sites/<int:app_id>/object-cache', methods=['DELETE'])
@jwt_required()
@admin_required
def disable_object_cache(app_id):
    """Disable Redis object cache (keeps the container + plugin)."""
    app = _resolve_app(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    result = WordPressService.disable_object_cache(app.root_path)
    return jsonify(result), 200 if result.get('success') else 400


@wordpress_bp.route('/sites/<int:app_id>/flush-cache', methods=['POST'])
@jwt_required()
@admin_required
def flush_cache(app_id):
    """Flush WordPress cache."""
    app = _resolve_app(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.flush_cache(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


# User management
@wordpress_bp.route('/sites/<int:app_id>/users', methods=['POST'])
@jwt_required()
@admin_required
def create_wp_user(app_id):
    """Create a WordPress user."""
    app = _resolve_app(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'username' not in data or 'email' not in data:
        return jsonify({'error': 'username and email are required'}), 400

    result = WordPressService.create_user(
        app.root_path,
        data['username'],
        data['email'],
        data.get('role', 'subscriber'),
        data.get('password')
    )
    return jsonify(result), 201 if result['success'] else 400


@wordpress_bp.route('/sites/<int:site_id>/login', methods=['POST'])
@jwt_required()
@admin_required
def wp_auto_login(site_id):
    """Mint a one-time passwordless wp-admin login URL for the calling operator."""
    from app.services.audit_service import AuditService
    current_user_id = get_jwt_identity()
    operator = User.query.get(current_user_id)
    if not operator:
        return jsonify({'error': 'User not found'}), 404

    wp_site = WordPressSite.query.get(site_id)
    app = wp_site.application if wp_site else _resolve_app(site_id)
    if not app or not app.root_path:
        return jsonify({'error': 'Application not found'}), 404
    if app.app_type != 'wordpress':
        return jsonify({'error': 'Application is not a WordPress site'}), 400

    # Resolve a managed admin tied to the operator's panel email. Prefer the
    # site's recorded admin_user; otherwise derive a deterministic username
    # from the operator and create it via the WP-CLI bridge if absent.
    wp_user = (wp_site.admin_user if wp_site and wp_site.admin_user else None)
    if not wp_user:
        wp_user = (operator.username or operator.email.split('@')[0])
        exists = WordPressService.wp_cli(app.root_path, ['user', 'get', wp_user, '--field=ID'])
        if not exists.get('success'):
            created = WordPressService.create_user(
                app.root_path, wp_user, operator.email, role='administrator'
            )
            if not created.get('success'):
                return jsonify({'error': created.get('error') or 'Failed to provision admin'}), 400
        if wp_site:
            wp_site.admin_user = wp_user
            if not wp_site.admin_email:
                wp_site.admin_email = operator.email
            db.session.commit()

    result = WordPressService.create_login_url(app.root_path, wp_user)
    if not result.get('success'):
        return jsonify({'error': result.get('error') or 'Failed to create login URL'}), 400

    AuditService.log(
        action='wordpress.admin_login',
        user_id=current_user_id,
        target_type='app',
        target_id=app.id,
        details={'wp_user': wp_user, 'site_id': site_id, 'app_name': app.name},
    )

    return jsonify({'success': True, 'url': result['url']}), 200


@wordpress_bp.route('/sites/<int:app_id>/users/<user>/reset-password', methods=['POST'])
@jwt_required()
@admin_required
def reset_wp_password(app_id, user):
    """Reset a WordPress user's password."""
    app = _resolve_app(app_id)
    data = request.get_json() or {}

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.reset_password(app.root_path, user, data.get('password'))
    return jsonify(result), 200 if result['success'] else 400


# WP-CLI status
@wordpress_bp.route('/wp-cli/status', methods=['GET'])
@jwt_required()
@admin_required
def wp_cli_status():
    """Check WP-CLI installation status."""
    installed = WordPressService.is_wp_cli_installed()
    return jsonify({
        'installed': installed,
        'path': WordPressService.WP_CLI_PATH if installed else None
    }), 200


@wordpress_bp.route('/wp-cli/install', methods=['POST'])
@jwt_required()
@admin_required
def install_wp_cli():
    """Install WP-CLI."""
    result = WordPressService.install_wp_cli()
    return jsonify(result), 200 if result['success'] else 400
