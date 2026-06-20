import os
import json
import re
import shutil
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Application, User
from app.services.build_service import BuildService
from app.services.docker_service import DockerService
from app.services.git_service import GitService
from app.services.repository_manifest_service import RepositoryManifestService
from app.services.source_connection_service import SourceConnectionService
from app.services.remote_docker_service import RemoteDockerService
from app.services.image_update_service import ImageUpdateService
from app.services.container_sleep_service import ContainerSleepService
from app.services.container_scale_service import ContainerScaleService
from app.services.log_service import LogService
from app.services.process_service import ProcessService
from app.services.upload_service import (
    ensure_app_dirs,
    validate_zip,
    extract_version,
    preserve_existing_env,
    switch_current_version,
    backup_current,
    save_upload_zip,
    detect_app_type,
    get_app_storage_dir,
    list_versions,
    get_current_version,
)
from app import paths

apps_bp = Blueprint('apps', __name__)


def _compose_target(app):
    """Return the effective compose file path for remote agent deployments."""
    if app.server_id and app.root_path:
        return os.path.join(app.root_path, app.compose_file or 'docker-compose.yml')
    return os.path.join(app.root_path, app.compose_file or 'docker-compose.yml') if app.root_path else None


def _local_compose_file(app):
    """Return the compose file to pass to DockerService for local deployments."""
    return app.compose_file if app.compose_file else None


def _sync_manual_app_status(app):
    """Update app.status from the real runtime for manual/local apps."""
    if app.source != 'manual':
        return
    if app.managed_by == 'systemd' and app.systemd_unit:
        status = ProcessService.get_systemd_unit_status(app.systemd_unit)
        actual = 'running' if status.get('active') else 'stopped'
    elif app.managed_by == 'docker_compose' and app.root_path:
        status = ProcessService.get_compose_project_status(app.root_path, compose_file=app.compose_file)
        actual = status.get('status', 'stopped')
    else:
        return

    if actual in ('running', 'stopped') and app.status != actual:
        app.status = actual
        db.session.commit()


def _agent_result_failed(result):
    data = result.get('data') if isinstance(result, dict) else None
    return isinstance(data, dict) and data.get('success') is False


def _agent_result_error(result, fallback):
    data = result.get('data') if isinstance(result, dict) else None
    if isinstance(data, dict):
        return data.get('error') or result.get('error') or fallback
    return result.get('error') or fallback


def _service_slug(value):
    return re.sub(r'[^a-z0-9-]+', '-', (value or '').strip().lower()).strip('-')


def _derive_repo_app_type(detection):
    if detection.get('has_dockerfile') or detection.get('has_docker_compose'):
        return 'docker'
    framework = detection.get('framework')
    language = detection.get('language')
    if framework == 'django':
        return 'django'
    if framework in ['flask', 'fastapi'] or language == 'python':
        return 'flask'
    if framework == 'laravel' or language == 'php':
        return 'php'
    return 'static'


def _assert_managed_app_path(app_name):
    base_dir = os.path.abspath(paths.APPS_DIR)
    app_path = os.path.abspath(os.path.join(base_dir, app_name))
    if app_path != base_dir and app_path.startswith(base_dir + os.sep):
        return app_path
    raise ValueError('Invalid application path')


def _safe_repo_url(repo_url):
    return re.sub(r'^(https?://)[^@]+@', r'\1', repo_url or '')


def _attach_deploy_config(payload, deploy_configs=None):
    deploy_configs = deploy_configs or GitService.get_config().get('apps', {})
    deploy_config = deploy_configs.get(str(payload.get('id')))

    payload['last_deploy_at'] = payload.get('last_deployed_at')
    payload['deploy_configured'] = deploy_config is not None
    if deploy_config:
        payload['deploy_repo_url'] = _safe_repo_url(deploy_config.get('repo_url'))
        payload['deploy_branch'] = deploy_config.get('branch')
        payload['auto_deploy'] = deploy_config.get('auto_deploy', False)
        payload['last_deploy_at'] = deploy_config.get('last_deploy')
    return payload


# ==================== ENVIRONMENT LINKING ====================

@apps_bp.route('/<int:app_id>/link', methods=['POST'])
@jwt_required()
def link_apps(app_id):
    """Link two apps as prod/dev pair sharing database resources."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    target_app_id = data.get('target_app_id')
    as_environment = data.get('as_environment', 'development')

    if not target_app_id:
        return jsonify({'error': 'target_app_id is required'}), 400

    valid_environments = ['production', 'development', 'staging']
    if as_environment not in valid_environments:
        return jsonify({'error': f'Invalid environment. Must be one of: {", ".join(valid_environments)}'}), 400

    target_app = Application.query.get(target_app_id)
    if not target_app:
        return jsonify({'error': 'Target application not found'}), 404

    if not _can_edit_app(user, target_app):
        return jsonify({'error': 'Access denied to target application'}), 403

    if app.app_type != target_app.app_type:
        return jsonify({'error': 'Apps must be of the same type to link'}), 400

    if app_id == target_app_id:
        return jsonify({'error': 'Cannot link an app to itself'}), 400

    # Set environment types based on as_environment
    if as_environment == 'development':
        app.environment_type = 'development'
        target_app.environment_type = 'production'
    elif as_environment == 'production':
        app.environment_type = 'production'
        target_app.environment_type = 'development'
    else:  # staging
        app.environment_type = 'staging'
        target_app.environment_type = 'production'

    # Link bidirectionally
    app.linked_app_id = target_app_id
    target_app.linked_app_id = app_id

    # Store shared config
    from datetime import datetime
    shared_config = {
        'linked_at': datetime.now().isoformat(),
        'link_type': 'environment_pair'
    }

    # Propagate DB credentials for Docker/WordPress apps
    propagation_result = None
    if app.app_type == 'docker' and data.get('propagate_credentials', True):
        from app.services.template_service import TemplateService
        # Determine which app is the source (prod) and which is target (dev)
        if as_environment == 'development':
            # Current app is dev, target is prod - propagate from target to current
            propagation_result = TemplateService.propagate_db_credentials(
                target_app_id, app_id, data.get('table_prefix')
            )
        else:
            # Current app is prod, target is dev - propagate from current to target
            propagation_result = TemplateService.propagate_db_credentials(
                app_id, target_app_id, data.get('table_prefix')
            )

        if propagation_result and propagation_result.get('success'):
            shared_config['db_credentials_propagated'] = True
            shared_config['shared_db'] = propagation_result.get('shared_config', {})

    app.shared_config = json.dumps(shared_config)
    target_app.shared_config = json.dumps(shared_config)

    db.session.commit()

    response = {
        'message': 'Apps linked successfully',
        'app': app.to_dict(include_linked=True),
        'target_app': target_app.to_dict(include_linked=True)
    }
    if propagation_result:
        response['credential_propagation'] = propagation_result

    return jsonify(response), 200


@apps_bp.route('/<int:app_id>/linked', methods=['GET'])
@jwt_required()
def get_linked_apps(app_id):
    """Get apps linked to this app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    linked_apps = []

    # Get directly linked app
    if app.linked_app:
        linked_apps.append({
            'id': app.linked_app.id,
            'name': app.linked_app.name,
            'app_type': app.linked_app.app_type,
            'environment_type': app.linked_app.environment_type,
            'status': app.linked_app.status,
            'port': app.linked_app.port
        })

    # Get apps that link to this one
    for linked_from in app.linked_from:
        if linked_from.id != app.linked_app_id:  # Avoid duplicates
            linked_apps.append({
                'id': linked_from.id,
                'name': linked_from.name,
                'app_type': linked_from.app_type,
                'environment_type': linked_from.environment_type,
                'status': linked_from.status,
                'port': linked_from.port
            })

    return jsonify({
        'app_id': app_id,
        'environment_type': app.environment_type,
        'linked_apps': linked_apps,
        'shared_config': json.loads(app.shared_config) if app.shared_config else None
    }), 200


@apps_bp.route('/<int:app_id>/link', methods=['DELETE'])
@jwt_required()
def unlink_apps(app_id):
    """Unlink apps and reset environment types."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    if not app.linked_app_id:
        return jsonify({'error': 'App is not linked to any other app'}), 400

    target_app = Application.query.get(app.linked_app_id)

    # Reset both apps
    app.linked_app_id = None
    app.environment_type = 'standalone'
    app.shared_config = None

    if target_app:
        target_app.linked_app_id = None
        target_app.environment_type = 'standalone'
        target_app.shared_config = None

    db.session.commit()

    return jsonify({
        'message': 'Apps unlinked successfully',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/environment', methods=['PUT'])
@jwt_required()
def update_environment(app_id):
    """Update environment type for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    environment_type = data.get('environment_type')
    valid_types = ['production', 'development', 'staging', 'standalone']

    if environment_type not in valid_types:
        return jsonify({'error': f'Invalid environment_type. Must be one of: {", ".join(valid_types)}'}), 400

    app.environment_type = environment_type
    db.session.commit()

    return jsonify({
        'message': 'Environment type updated',
        'app': app.to_dict()
    }), 200


# ==================== APP CRUD ====================


@apps_bp.route('', methods=['GET'])
@jwt_required()
def get_apps():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    # Optional filter by environment type
    environment_filter = request.args.get('environment')
    include_linked = request.args.get('include_linked', 'false').lower() == 'true'

    # Workspace-aware scoping (#33). With no workspace context this is exactly the
    # prior behavior (admin -> all, else -> own); with ?workspace_id / X-Workspace-Id
    # it filters to that workspace (membership-checked).
    from app.services.workspace_service import WorkspaceService
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    query = WorkspaceService.scope_query(Application.query, Application, user,
                                         workspace_id=ws_id, owner_attr='user_id',
                                         grant_resource_type='application')

    if environment_filter:
        query = query.filter_by(environment_type=environment_filter)

    apps = query.all()
    deploy_configs = GitService.get_config().get('apps', {})

    return jsonify({
        'apps': [
            _attach_deploy_config(app.to_dict(include_linked=include_linked), deploy_configs)
            for app in apps
        ]
    }), 200


@apps_bp.route('/<int:app_id>/workspace', methods=['PUT'])
@jwt_required()
def set_app_workspace(app_id):
    """Reassign an application to a workspace (#33). Owner-or-admin on the app;
    the target must be a workspace the caller can access (member or admin). A
    null/'default' target moves it back to the default workspace."""
    from app.models.workspace import Workspace
    from app.services.workspace_service import WorkspaceService
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    # Use user.id (int) for comparisons — get_jwt_identity() is the stringified token id.
    if user.role != 'admin' and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403

    target = (request.get_json() or {}).get('workspace_id')
    if target in (None, '', 'default'):
        ws_id = WorkspaceService.ensure_default_workspace().id
    else:
        ws = Workspace.query.get(target)
        if not ws:
            return jsonify({'error': 'Workspace not found'}), 404
        if user.role != 'admin' and WorkspaceService.get_user_role(ws.id, user.id) is None:
            return jsonify({'error': 'Not a member of the target workspace'}), 403
        # Role reconciliation (#33): a 'viewer' member can't move resources into it.
        if not WorkspaceService.can_write_in_workspace(user, ws.id):
            return jsonify({'error': 'You have read-only access to the target workspace'}), 403
        ws_id = ws.id

    app.workspace_id = ws_id
    db.session.commit()
    return jsonify({'message': 'Workspace updated', 'app': app.to_dict()}), 200


def _can_access_app(user, app):
    """Read access (#33 ACL) — delegates to the shared seam."""
    from app.services.resource_grant_service import ResourceGrantService
    return ResourceGrantService.can_access_app(user, app)


def _can_edit_app(user, app):
    """Write/operate access (#33 ACL) — delegates to the shared seam."""
    from app.services.resource_grant_service import ResourceGrantService
    return ResourceGrantService.can_edit_app(user, app)


@apps_bp.route('/<int:app_id>', methods=['GET'])
@jwt_required()
def get_app(app_id):
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Single app requests include linked app info by default
    return jsonify({'app': _attach_deploy_config(app.to_dict(include_linked=True))}), 200


# ---- Per-resource access grants (#33 per-site ACL): share an app with a user ----

@apps_bp.route('/<int:app_id>/grants', methods=['GET'])
@jwt_required()
def list_app_grants(app_id):
    """List who has been granted access to this app (owner-or-admin)."""
    from app.services.resource_grant_service import ResourceGrantService
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if user.role != 'admin' and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403
    grants = ResourceGrantService.list_for_resource('application', app.id)
    return jsonify({'grants': [g.to_dict() for g in grants]}), 200


@apps_bp.route('/<int:app_id>/grants', methods=['POST'])
@jwt_required()
def grant_app_access(app_id):
    """Grant a user access to this app (owner-or-admin). Body: {user_id, role?}."""
    from app.services.resource_grant_service import ResourceGrantService
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if user.role != 'admin' and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json() or {}
    grantee_id = data.get('user_id')
    if not grantee_id:
        return jsonify({'error': 'user_id is required'}), 400
    grantee = User.query.get(grantee_id)
    if not grantee:
        return jsonify({'error': 'User not found'}), 404
    if grantee.id == app.user_id:
        return jsonify({'error': 'The owner already has access'}), 400
    role = data.get('role') or 'editor'
    if role not in ('viewer', 'editor'):
        return jsonify({'error': "role must be 'viewer' or 'editor'"}), 400
    grant = ResourceGrantService.grant(user_id=grantee.id, resource_type='application',
                                       resource_id=app.id, granted_by=user.id, role=role)
    return jsonify({'grant': grant.to_dict()}), 201


@apps_bp.route('/<int:app_id>/grants/<int:grant_id>', methods=['DELETE'])
@jwt_required()
def revoke_app_access(app_id, grant_id):
    """Revoke a grant on this app (owner-or-admin)."""
    from app.services.resource_grant_service import ResourceGrantService
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if user.role != 'admin' and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403
    ok = ResourceGrantService.revoke(grant_id, resource_type='application', resource_id=app.id)
    return jsonify({'success': ok}), (200 if ok else 404)


@apps_bp.route('/from-repository', methods=['POST'])
@jwt_required()
def create_app_from_repository():
    """Create a new application by cloning a Git repository."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user or user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json() or {}
    name = _service_slug(data.get('name'))
    repo_url = (data.get('repo_url') or '').strip()
    source_connection_id = data.get('source_connection_id')
    repository_full_name = (data.get('repository_full_name') or '').strip()
    branch = (data.get('branch') or 'main').strip()
    app_type = (data.get('app_type') or 'auto').strip().lower()
    build_method = (data.get('build_method') or 'auto').strip().lower()
    auto_deploy = bool(data.get('auto_deploy', True))
    port = data.get('port')
    dockerfile_path = (data.get('dockerfile_path') or '').strip() or None
    custom_build_cmd = (data.get('custom_build_cmd') or '').strip() or None
    custom_start_cmd = (data.get('custom_start_cmd') or '').strip() or None

    if not name or len(name) < 2:
        return jsonify({'error': 'Service name must be at least 2 characters'}), 400
    if source_connection_id:
        try:
            source_repo = SourceConnectionService.get_authenticated_clone_url(
                user_id=current_user_id,
                connection_id=int(source_connection_id),
                full_name=repository_full_name,
            )
            clone_repo_url = source_repo['clone_url']
            deploy_repo_url = source_repo['public_url']
        except (TypeError, ValueError) as exc:
            return jsonify({'error': str(exc)}), 400
    else:
        clone_repo_url = repo_url
        deploy_repo_url = repo_url

    if not clone_repo_url:
        return jsonify({'error': 'repo_url is required'}), 400

    valid_app_types = ['auto', 'docker', 'flask', 'django', 'php', 'static']
    if app_type not in valid_app_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_app_types)}'}), 400

    valid_build_methods = ['auto', 'dockerfile', 'nixpacks', 'custom']
    if build_method not in valid_build_methods:
        return jsonify({'error': f'Invalid build_method. Must be one of: {", ".join(valid_build_methods)}'}), 400

    if port in ['', None]:
        port = None
    elif isinstance(port, int) or (isinstance(port, str) and port.isdigit()):
        port = int(port)
    else:
        return jsonify({'error': 'port must be a number'}), 400

    if Application.query.filter_by(name=name, server_id=None).first():
        return jsonify({'error': f'An application named "{name}" already exists'}), 400

    try:
        app_path = _assert_managed_app_path(name)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if os.path.exists(app_path):
        return jsonify({'error': f'App directory already exists: {app_path}'}), 400

    clone_result = GitService.clone_repository(app_path, clone_repo_url, branch or None)
    if not clone_result.get('success'):
        if clone_repo_url != deploy_repo_url and clone_result.get('error'):
            clone_result['error'] = clone_result['error'].replace(clone_repo_url, deploy_repo_url)
        return jsonify(clone_result), 400

    manifest = RepositoryManifestService.analyze_path(app_path)
    recommended = manifest.get('recommended') or {}
    manifest_strategy = manifest.get('strategy')
    detection = BuildService.detect_build_method(app_path)
    manifest_app_type_strategies = {
        'serverkit',
        'docker_compose',
        'render',
        'railway',
        'dockerfile',
        'app_json',
    }
    resolved_app_type = (
        (recommended.get('app_type') if manifest_strategy in manifest_app_type_strategies else None)
        or _derive_repo_app_type(detection)
    ) if app_type == 'auto' else app_type
    resolved_build_method = build_method
    if build_method == 'auto':
        resolved_build_method = (
            recommended.get('build_method') if manifest_strategy else None
        ) or detection.get('build_method') or 'auto'
        if resolved_build_method == 'custom' and not (custom_build_cmd or recommended.get('custom_build_cmd')):
            resolved_build_method = 'auto'
    if not port:
        port = recommended.get('port')
    dockerfile_path = dockerfile_path or recommended.get('dockerfile_path') or 'Dockerfile'
    custom_build_cmd = custom_build_cmd or recommended.get('custom_build_cmd')
    custom_start_cmd = custom_start_cmd or recommended.get('custom_start_cmd')

    app = Application(
        name=name,
        app_type=resolved_app_type,
        status='stopped',
        root_path=app_path,
        user_id=current_user_id,
        port=port,
    )

    try:
        db.session.add(app)
        db.session.commit()

        deploy_result = GitService.configure_deployment(
            app_id=app.id,
            app_path=app.root_path,
            repo_url=deploy_repo_url,
            branch=branch or 'main',
            auto_deploy=auto_deploy,
        )
        if not deploy_result.get('success'):
            raise RuntimeError(deploy_result.get('error', 'Failed to configure deployment'))

        build_result = BuildService.configure_build(
            app_id=app.id,
            app_path=app.root_path,
            build_method=resolved_build_method,
            dockerfile_path=dockerfile_path,
            custom_build_cmd=custom_build_cmd,
            custom_start_cmd=custom_start_cmd,
        )
        if not build_result.get('success'):
            raise RuntimeError(build_result.get('error', 'Failed to configure build'))

        return jsonify({
            'message': 'Repository service created',
            'app': _attach_deploy_config(app.to_dict(include_linked=True)),
            'deploy_config': {
                'repo_url': _safe_repo_url(deploy_repo_url),
                'branch': branch or 'main',
                'auto_deploy': auto_deploy,
                'webhook_url': deploy_result.get('webhook_url'),
            },
            'build_config': build_result.get('config'),
            'detection': detection,
            'manifest': manifest,
        }), 201
    except Exception as exc:
        db.session.rollback()
        if app.id:
            GitService.remove_deployment(app.id)
            existing_app = Application.query.get(app.id)
            if existing_app:
                db.session.delete(existing_app)
                db.session.commit()
        if os.path.abspath(app_path).startswith(os.path.abspath(paths.APPS_DIR) + os.sep):
            shutil.rmtree(app_path, ignore_errors=True)
        return jsonify({'error': str(exc)}), 400


@apps_bp.route('', methods=['POST'])
@jwt_required()
def create_app():
    current_user_id = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name = data.get('name')
    app_type = data.get('app_type')

    if not all([name, app_type]):
        return jsonify({'error': 'Missing required fields: name, app_type'}), 400

    valid_types = ['php', 'wordpress', 'flask', 'django', 'docker', 'static']
    if app_type not in valid_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_types)}'}), 400

    # Stamp the workspace (#33): the requested one (membership-checked) or the default.
    from app.services.workspace_service import WorkspaceService
    user = User.query.get(current_user_id)
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    # Role reconciliation (#33): a workspace 'viewer' member has read-only access to
    # the active workspace and may not create resources in it (checked only when a
    # workspace context is explicitly active, so no-context behavior is unchanged).
    if ws_id is not None and not WorkspaceService.can_write_in_workspace(user, ws_id):
        return jsonify({'error': 'You have read-only access to this workspace'}), 403
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id

    app = Application(
        name=name,
        app_type=app_type,
        status='stopped',
        php_version=data.get('php_version'),
        python_version=data.get('python_version'),
        port=data.get('port'),
        root_path=data.get('root_path'),
        docker_image=data.get('docker_image'),
        source=data.get('source') or 'github',
        compose_file=data.get('compose_file'),
        systemd_unit=data.get('systemd_unit'),
        managed_by=data.get('managed_by'),
        user_id=current_user_id,
        workspace_id=ws_id
    )

    db.session.add(app)
    db.session.commit()

    return jsonify({
        'message': 'Application created successfully',
        'app': app.to_dict()
    }), 201


@apps_bp.route('/manual', methods=['POST'])
@jwt_required()
def create_manual_app():
    """Register an app that already exists on the server (manual/local)."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user or user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json() or {}
    name = _service_slug(data.get('name'))
    app_type = (data.get('app_type') or 'docker').strip().lower()
    root_path = (data.get('root_path') or '').strip()
    compose_file = (data.get('compose_file') or '').strip() or None
    systemd_unit = (data.get('systemd_unit') or '').strip() or None
    managed_by = (data.get('managed_by') or '').strip().lower() or None

    if not name or len(name) < 2:
        return jsonify({'error': 'Service name must be at least 2 characters'}), 400

    valid_types = ['docker', 'flask', 'django', 'php', 'static', 'wordpress']
    if app_type not in valid_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_types)}'}), 400

    if not root_path:
        return jsonify({'error': 'root_path is required'}), 400

    root_path = os.path.abspath(root_path)
    if not os.path.isdir(root_path):
        return jsonify({'error': f'Path does not exist: {root_path}'}), 400

    # Auto-detect managed_by if not provided
    if not managed_by:
        if compose_file or os.path.exists(os.path.join(root_path, 'docker-compose.yml')):
            managed_by = 'docker_compose'
        elif systemd_unit:
            managed_by = 'systemd'
        else:
            managed_by = 'docker_compose'

    if managed_by not in ('docker_compose', 'systemd'):
        return jsonify({'error': "managed_by must be 'docker_compose' or 'systemd'"}), 400

    if managed_by == 'docker_compose' and not compose_file:
        if not os.path.exists(os.path.join(root_path, 'docker-compose.yml')):
            return jsonify({'error': 'docker-compose.yml not found and no compose_file provided'}), 400
        compose_file = 'docker-compose.yml'

    if Application.query.filter_by(name=name).first():
        return jsonify({'error': f'An application named "{name}" already exists'}), 400

    from app.services.workspace_service import WorkspaceService
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id

    app = Application(
        name=name,
        app_type=app_type,
        status='stopped',
        source='manual',
        root_path=root_path,
        compose_file=compose_file,
        systemd_unit=systemd_unit,
        managed_by=managed_by,
        user_id=current_user_id,
        workspace_id=ws_id,
    )

    db.session.add(app)
    db.session.commit()

    # Sync status immediately so the UI reflects reality
    _sync_manual_app_status(app)

    return jsonify({
        'message': 'Manual service registered',
        'app': _attach_deploy_config(app.to_dict(include_linked=True))
    }), 201


@apps_bp.route('/upload', methods=['POST'])
@jwt_required()
def upload_app_archive():
    """Create or update an app by uploading a zip archive."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user or user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    uploaded = request.files['file']
    if not uploaded or uploaded.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    name = _service_slug(request.form.get('name') or uploaded.filename.rsplit('.', 1)[0])
    app_type = (request.form.get('app_type') or 'auto').strip().lower()
    auto_deploy = request.form.get('auto_deploy', 'true').lower() == 'true'

    if not name or len(name) < 2:
        return jsonify({'error': 'Service name must be at least 2 characters'}), 400

    valid_types = ['auto', 'docker', 'flask', 'django', 'php', 'static', 'node']
    if app_type not in valid_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_types)}'}), 400

    from app.services.workspace_service import WorkspaceService
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id

    existing = Application.query.filter_by(name=name).first()
    is_update = existing is not None and existing.source == 'upload'

    temp_dir = os.path.join(paths.SERVERKIT_CACHE_DIR, 'uploads')
    os.makedirs(temp_dir, exist_ok=True)
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S-%f')
    zippath = os.path.join(temp_dir, f'{name}-{timestamp}.zip')
    uploaded.save(zippath)

    validation = validate_zip(zippath)
    if not validation.get('success'):
        os.remove(zippath)
        return jsonify({'error': validation.get('error', 'Invalid zip')}), 400

    try:
        app_dir = ensure_app_dirs(name)

        if is_update:
            app = existing
            new_version = (app.version or 0) + 1
            backup_path = backup_current(app_dir)
        else:
            if existing:
                os.remove(zippath)
                return jsonify({'error': f'An application named "{name}" already exists'}), 400
            new_version = 1

        version_dir = extract_version(app_dir, zippath, new_version)
        upload_archive_path = save_upload_zip(app_dir, zippath, new_version)

        if is_update:
            preserve_existing_env(os.path.join(app_dir, 'current'), version_dir)

        current_dir = switch_current_version(app_dir, new_version)

        if app_type == 'auto':
            detected = detect_app_type(current_dir)
        else:
            detected = app_type

        if detected == 'node':
            detected = 'docker'

        compose_file = None
        if detected == 'docker':
            if os.path.exists(os.path.join(current_dir, 'docker-compose.yml')):
                compose_file = 'docker-compose.yml'
            elif os.path.exists(os.path.join(current_dir, 'Dockerfile')):
                compose_file = None

        if is_update:
            app.app_type = detected
            app.compose_file = compose_file
            app.version = new_version
            app.upload_path = upload_archive_path
            app.root_path = current_dir
            app.updated_at = datetime.utcnow()
        else:
            app = Application(
                name=name,
                app_type=detected,
                status='stopped',
                source='upload',
                root_path=current_dir,
                compose_file=compose_file,
                managed_by='docker_compose' if detected == 'docker' else None,
                version=new_version,
                upload_path=upload_archive_path,
                user_id=current_user_id,
                workspace_id=ws_id,
            )
            db.session.add(app)

        db.session.commit()

        deploy_result = None
        if auto_deploy and detected == 'docker' and compose_file:
            deploy_result = DockerService.compose_up(current_dir, detach=True, build=True, compose_file=compose_file)
            if deploy_result.get('success'):
                app.status = 'running'
                app.last_deployed_at = datetime.utcnow()
                db.session.commit()

        os.remove(zippath)

        return jsonify({
            'message': 'Upload service updated' if is_update else 'Upload service created',
            'app': _attach_deploy_config(app.to_dict(include_linked=True)),
            'version': new_version,
            'detected_app_type': detected,
            'deploy_result': deploy_result,
        }), 201 if not is_update else 200

    except Exception as exc:
        try:
            os.remove(zippath)
        except Exception:
            pass
        return jsonify({'error': str(exc)}), 400


@apps_bp.route('/<int:app_id>/versions', methods=['GET'])
@jwt_required()
def get_app_versions(app_id):
    """List versions for an uploaded app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    if app.source != 'upload':
        return jsonify({'versions': [], 'current': None}), 200

    try:
        app_dir = get_app_storage_dir(app.name)
        versions = list_versions(app_dir)
        current = get_current_version(app_dir)
        return jsonify({'versions': versions, 'current': current}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@apps_bp.route('/<int:app_id>/rollback', methods=['POST'])
@jwt_required()
def rollback_app_version(app_id):
    """Roll an uploaded app back to a previous version."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    if app.source != 'upload':
        return jsonify({'error': 'Rollback is only supported for upload-based apps'}), 400

    data = request.get_json() or {}
    target = data.get('version')
    if target is None:
        return jsonify({'error': 'version is required'}), 400

    try:
        target = int(target)
    except (TypeError, ValueError):
        return jsonify({'error': 'version must be an integer'}), 400

    try:
        app_dir = get_app_storage_dir(app.name)
        current_dir = switch_current_version(app_dir, target)
        app.root_path = current_dir
        app.version = target
        app.updated_at = datetime.utcnow()

        if app.app_type == 'docker' and app.compose_file:
            result = DockerService.compose_up(current_dir, detach=True, build=True, compose_file=app.compose_file)
            if result.get('success'):
                app.status = 'running'
                app.last_deployed_at = datetime.utcnow()
            else:
                return jsonify({'error': result.get('error', 'Failed to start service'), 'app': app.to_dict()}), 400

        db.session.commit()
        return jsonify({
            'message': f'Rolled back to version {target}',
            'app': _attach_deploy_config(app.to_dict(include_linked=True))
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@apps_bp.route('/<int:app_id>', methods=['PUT'])
@jwt_required()
def update_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()

    if 'name' in data:
        app.name = data['name']
    if 'status' in data:
        app.status = data['status']
    if 'php_version' in data:
        app.php_version = data['php_version']
    if 'python_version' in data:
        app.python_version = data['python_version']
    if 'port' in data:
        app.port = data['port']
    if 'root_path' in data:
        app.root_path = data['root_path']
    if 'docker_image' in data:
        app.docker_image = data['docker_image']
    if 'source' in data:
        app.source = data['source']
    if 'compose_file' in data:
        app.compose_file = data['compose_file']
    if 'systemd_unit' in data:
        app.systemd_unit = data['systemd_unit']
    if 'managed_by' in data:
        app.managed_by = data['managed_by']

    db.session.commit()

    return jsonify({
        'message': 'Application updated successfully',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>', methods=['DELETE'])
@jwt_required()
def delete_app(app_id):
    import shutil
    from app.services.nginx_service import NginxService

    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not user.is_admin and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403

    cleanup_results = {
        'docker': None,
        'folder': None,
        'nginx': None
    }

    # For Docker apps, stop and remove containers/volumes
    if app.app_type == 'docker' and app.root_path:
        try:
            # Stop and remove containers, networks, and volumes
            result = DockerService.compose_down(
                app.root_path,
                volumes=True,
                remove_orphans=True,
                compose_file=_local_compose_file(app)
            )
            cleanup_results['docker'] = result
        except Exception as e:
            cleanup_results['docker'] = {'error': str(e)}

        # Delete the app folder only for ServerKit-managed uploads.
        # Manual apps point at existing paths that must not be removed.
        try:
            if app.source == 'upload' and app.root_path and app.root_path.startswith(paths.APPS_DIR):
                app_storage = get_app_storage_dir(app.name)
                if os.path.exists(app_storage):
                    shutil.rmtree(app_storage)
                    cleanup_results['folder'] = {'success': True}
        except Exception as e:
            cleanup_results['folder'] = {'error': str(e)}

    # Remove nginx site config
    try:
        NginxService.disable_site(app.name)
        NginxService.delete_site(app.name)
        cleanup_results['nginx'] = {'success': True}
    except Exception as e:
        cleanup_results['nginx'] = {'error': str(e)}

    # Delete from database
    db.session.delete(app)
    db.session.commit()

    return jsonify({
        'message': 'Application deleted successfully',
        'cleanup': cleanup_results
    }), 200


@apps_bp.route('/<int:app_id>/start', methods=['POST'])
@jwt_required()
def start_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_up(
                app.server_id,
                _compose_target(app),
                detach=True,
                user_id=current_user_id
            )
        else:
            result = DockerService.compose_up(
                app.root_path,
                detach=True,
                compose_file=_local_compose_file(app)
            )
        if not result.get('success') or _agent_result_failed(result):
            return jsonify({'error': _agent_result_error(result, 'Failed to start containers')}), 400

    app.status = 'running'
    db.session.commit()

    return jsonify({
        'message': 'Application started',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/image-update/apply', methods=['POST'])
@jwt_required()
def apply_image_update(app_id):
    """Pull the newest image for a compose-managed app and recreate it."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Auto-apply is only safe for compose-managed apps; recreating a standalone
    # container would need its full run spec, which we don't store.
    if app.app_type != 'docker' or not app.root_path or not app.compose_file:
        return jsonify({'error': 'Automatic update is only supported for docker-compose apps. '
                                 'Pull and recreate this container manually.'}), 400

    # Pull the newest images for the project, then recreate changed containers.
    if app.server_id:
        pull = RemoteDockerService.compose_pull(app.server_id, _compose_target(app), user_id=current_user_id)
        if not pull.get('success') or _agent_result_failed(pull):
            return jsonify({'error': _agent_result_error(pull, 'Failed to pull image')}), 400
        up = RemoteDockerService.compose_up(app.server_id, _compose_target(app), detach=True, user_id=current_user_id)
    else:
        pull = DockerService.compose_pull(app.root_path, compose_file=_local_compose_file(app))
        if not pull.get('success'):
            return jsonify({'error': pull.get('error', 'Failed to pull image')}), 400
        up = DockerService.compose_up(app.root_path, detach=True, compose_file=_local_compose_file(app))

    if not up.get('success') or _agent_result_failed(up):
        return jsonify({'error': _agent_result_error(up, 'Failed to recreate containers')}), 400

    app.status = 'running'
    app.last_deployed_at = datetime.utcnow()
    db.session.commit()

    # Refresh the update badge now that we're on the new image.
    ImageUpdateService.check_application(app_id)

    return jsonify({
        'message': 'Image updated and containers recreated',
        'app': app.to_dict(),
    }), 200


@apps_bp.route('/<int:app_id>/sleep-policy', methods=['GET'])
@jwt_required()
def get_sleep_policy(app_id):
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    return jsonify(ContainerSleepService.get_or_create_policy(app_id).to_dict())


@apps_bp.route('/<int:app_id>/sleep-policy', methods=['PUT'])
@jwt_required()
def update_sleep_policy(app_id):
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json() or {}
    policy = ContainerSleepService.set_policy(
        app_id, enabled=data.get('enabled'), idle_timeout_minutes=data.get('idle_timeout_minutes'))
    return jsonify(policy.to_dict())


@apps_bp.route('/<int:app_id>/sleep', methods=['POST'])
@jwt_required()
def sleep_app(app_id):
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    result = ContainerSleepService.sleep_app(app_id)
    if not result.get('success'):
        return jsonify({'error': result['error']}), 400
    return jsonify({'message': 'Application asleep', 'policy': result['policy'], 'app': app.to_dict()})


@apps_bp.route('/<int:app_id>/wake', methods=['POST'])
@jwt_required()
def wake_app(app_id):
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    result = ContainerSleepService.wake_app(app_id)
    if not result.get('success'):
        return jsonify({'error': result['error']}), 400
    return jsonify({'message': 'Application awake', 'policy': result['policy'], 'app': app.to_dict()})


@apps_bp.route('/sweep-idle', methods=['POST'])
@jwt_required()
def sweep_idle_apps():
    """Sleep all enabled apps that have been idle past their timeout. Intended
    to be hit periodically (cron or a scheduler)."""
    user = User.query.get(get_jwt_identity())
    if not (user and user.is_admin):
        return jsonify({'error': 'Admin access required'}), 403
    return jsonify(ContainerSleepService.sweep_idle())


@apps_bp.route('/<int:app_id>/scale-policy', methods=['GET'])
@jwt_required()
def get_scale_policy(app_id):
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    return jsonify(ContainerScaleService.get_or_create_policy(app_id).to_dict())


@apps_bp.route('/<int:app_id>/scale-policy', methods=['PUT'])
@jwt_required()
def update_scale_policy(app_id):
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json() or {}
    policy = ContainerScaleService.set_policy(app_id, **data)
    return jsonify(policy.to_dict())


@apps_bp.route('/<int:app_id>/scale', methods=['POST'])
@jwt_required()
def scale_app(app_id):
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json() or {}
    if data.get('replicas') is None:
        return jsonify({'error': 'replicas is required'}), 400
    result = ContainerScaleService.scale_to(app_id, data['replicas'])
    if not result.get('success'):
        return jsonify({'error': result['error']}), 400
    return jsonify(result)


@apps_bp.route('/<int:app_id>/scale/evaluate', methods=['POST'])
@jwt_required()
def evaluate_scale(app_id):
    user = User.query.get(get_jwt_identity())
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    result = ContainerScaleService.evaluate(app_id)
    if not result.get('success'):
        return jsonify({'error': result.get('error', 'Evaluation failed')}), 400
    return jsonify(result)


@apps_bp.route('/scale-sweep', methods=['POST'])
@jwt_required()
def scale_sweep():
    """Evaluate every enabled auto-scaling policy. Intended for cron/scheduler."""
    user = User.query.get(get_jwt_identity())
    if not (user and user.is_admin):
        return jsonify({'error': 'Admin access required'}), 403
    return jsonify(ContainerScaleService.sweep())


@apps_bp.route('/<int:app_id>/stop', methods=['POST'])
@jwt_required()
def stop_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_down(
                app.server_id,
                _compose_target(app),
                user_id=current_user_id
            )
        else:
            result = DockerService.compose_down(
                app.root_path,
                compose_file=_local_compose_file(app)
            )
        if not result.get('success') or _agent_result_failed(result):
            return jsonify({'error': _agent_result_error(result, 'Failed to stop containers')}), 400

    app.status = 'stopped'
    db.session.commit()

    return jsonify({
        'message': 'Application stopped',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/restart', methods=['POST'])
@jwt_required()
def restart_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_restart(
                app.server_id,
                _compose_target(app),
                user_id=current_user_id
            )
        else:
            result = DockerService.compose_restart(
                app.root_path,
                compose_file=_local_compose_file(app)
            )
        if not result.get('success') or _agent_result_failed(result):
            return jsonify({'error': _agent_result_error(result, 'Failed to restart containers')}), 400

    app.status = 'running'
    db.session.commit()

    return jsonify({
        'message': 'Application restarted',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/logs', methods=['GET'])
@jwt_required()
def get_app_logs(app_id):
    """Get logs for a specific application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    lines = request.args.get('lines', 100, type=int)
    log_type = request.args.get('type', 'all')

    # For Docker apps, get docker compose logs
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_logs(
                app.server_id,
                _compose_target(app),
                tail=lines,
                user_id=current_user_id
            )
            return jsonify(result.get('data') if result.get('success') else result), 200 if result.get('success') else 400

        result = LogService.get_docker_app_logs(
            app.name, app.root_path, lines, compose_file=_local_compose_file(app)
        )
        return jsonify(result), 200 if result.get('success') else 400

    # For other apps, get nginx logs
    result = LogService.get_app_logs(app.name, log_type, lines)
    return jsonify(result), 200 if result.get('success') else 400


@apps_bp.route('/<int:app_id>/container-logs', methods=['GET'])
@jwt_required()
def get_container_logs(app_id):
    """Get container logs for a Docker application.

    Query params:
        - tail: Number of lines from end (default: 100, max: 10000)
        - since: ISO timestamp or duration (e.g., '10m', '1h', '2024-01-01T00:00:00Z')
        - timestamps: Include timestamps (default: true)
        - format: Output format - 'raw' or 'json' (default: 'raw')
        - service: Specific service/container name for compose apps (optional)

    Returns:
        {
            "success": true,
            "logs": "...",  // Raw format
            "lines": [...]  // JSON format with parsed lines
            "container_id": "...",
            "container_name": "...",
            "app_id": 1,
            "containers": [...] // Available containers for compose apps
        }
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Parse query parameters
    tail = request.args.get('tail', 100, type=int)
    tail = min(tail, 10000)  # Cap at 10000 lines
    since = request.args.get('since')
    timestamps = request.args.get('timestamps', 'true').lower() == 'true'
    output_format = request.args.get('format', 'raw')
    service = request.args.get('service')

    # Get all available containers for this app
    all_containers = DockerService.get_all_app_containers(app)

    # Determine which container to get logs from
    container_id = None
    container_name = None

    if service:
        # Find specific service container
        for c in all_containers:
            if c.get('service') == service or c.get('name') == service:
                container_id = c.get('id') or c.get('name')
                container_name = c.get('name')
                break
        if not container_id:
            return jsonify({
                'error': f'Service "{service}" not found',
                'available_services': [c.get('service') or c.get('name') for c in all_containers]
            }), 404
    else:
        # Get main container
        container_id = DockerService.get_app_container_id(app)
        if all_containers:
            container_name = all_containers[0].get('name')

    if not container_id:
        return jsonify({
            'error': 'No container found for this application',
            'hint': 'The application may not have been started yet'
        }), 404

    # Check container state
    container_state = DockerService.get_container_state(container_id)
    if not container_state:
        return jsonify({
            'error': 'Container not found or no longer exists'
        }), 404

    # Get logs
    result = DockerService.get_container_logs(
        container_id,
        tail=tail,
        since=since,
        timestamps=timestamps
    )

    if not result.get('success'):
        return jsonify({
            'error': result.get('error', 'Failed to fetch logs')
        }), 400

    logs = result.get('logs', '')

    response = {
        'success': True,
        'app_id': app_id,
        'container_id': container_id,
        'container_name': container_name,
        'container_state': container_state,
        'containers': all_containers
    }

    if output_format == 'json':
        response['lines'] = DockerService.parse_logs_to_lines(logs)
    else:
        response['logs'] = logs

    return jsonify(response), 200


@apps_bp.route('/<int:app_id>/containers', methods=['GET'])
@jwt_required()
def get_app_containers(app_id):
    """Get list of containers for a Docker application.

    Useful for compose apps with multiple services.

    Returns:
        {
            "success": true,
            "app_id": 1,
            "containers": [
                {"id": "abc123", "name": "app-web", "service": "web", "state": "running"},
                {"id": "def456", "name": "app-db", "service": "db", "state": "running"}
            ]
        }
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    containers = DockerService.get_all_app_containers(app)

    return jsonify({
        'success': True,
        'app_id': app_id,
        'containers': containers
    }), 200


@apps_bp.route('/<int:app_id>/status', methods=['GET'])
@jwt_required()
def get_app_status(app_id):
    """Get real-time status for a Docker application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Manual / local apps: ask the real runtime
    if app.source == 'manual':
        _sync_manual_app_status(app)
        if app.managed_by == 'systemd' and app.systemd_unit:
            unit_status = ProcessService.get_systemd_unit_status(app.systemd_unit)
            return jsonify({
                'status': app.status,
                'unit_status': unit_status.get('status'),
                'active': unit_status.get('active'),
                'containers': [],
                'running': 1 if app.status == 'running' else 0,
                'total': 1,
                'port': app.port,
                'port_accessible': None,
            }), 200

    if app.app_type == 'docker' and app.root_path:
        # Get container status from Docker
        if app.server_id:
            result = RemoteDockerService.compose_ps(
                app.server_id,
                _compose_target(app),
                user_id=current_user_id
            )
            if not result.get('success'):
                return jsonify(result), 503 if result.get('code') == 'AGENT_OFFLINE' else 400
            containers = result.get('data', [])
        else:
            containers = DockerService.compose_ps(
                app.root_path,
                compose_file=_local_compose_file(app)
            )

        # Determine overall status
        running_count = sum(1 for c in containers if c.get('Status', c.get('status', '')).startswith('Up'))
        total_count = len(containers)

        if total_count == 0:
            actual_status = 'stopped'
        elif running_count == total_count:
            actual_status = 'running'
        elif running_count > 0:
            actual_status = 'partial'
        else:
            actual_status = 'stopped'

        # Update DB if status changed
        if app.status != actual_status and actual_status in ['running', 'stopped']:
            app.status = actual_status
            db.session.commit()

        # Check port accessibility
        port_status = None
        if app.port and not app.server_id:
            port_status = DockerService.check_port_accessible(app.port)

        return jsonify({
            'status': actual_status,
            'containers': containers,
            'running': running_count,
            'total': total_count,
            'port': app.port,
            'port_accessible': port_status.get('accessible') if port_status else None
        }), 200

    # Non-Docker apps
    port_status = None
    if app.port:
        port_status = DockerService.check_port_accessible(app.port)

    return jsonify({
        'status': app.status,
        'containers': [],
        'running': 1 if app.status == 'running' else 0,
        'total': 1,
        'port': app.port,
        'port_accessible': port_status.get('accessible') if port_status else None
    }), 200
