import os
from flask import Flask, send_from_directory, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_migrate import Migrate

from config import config

db = SQLAlchemy()
jwt = JWTManager()
migrate = Migrate()

# PyJWT 2.10+ enforces that 'sub' must be a string.
# Stringify the identity so integer user IDs work transparently.
@jwt.user_identity_loader
def _user_identity(user_id):
    return str(user_id)
limiter = Limiter(key_func=get_remote_address, default_limits=["100 per minute"])
# Note: key_func is updated to get_rate_limit_key after app init
socketio = None

# Path to frontend dist folder (relative to backend folder)
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'frontend', 'dist')


def create_app(config_name=None):
    global socketio

    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'development')

    # Configure Flask to serve static files from frontend dist
    app = Flask(
        __name__,
        static_folder=FRONTEND_DIST,
        static_url_path=''
    )
    app.config.from_object(config[config_name])

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    limiter.init_app(app)
    CORS(
        app,
        origins=app.config['CORS_ORIGINS'],
        supports_credentials=True,
        allow_headers=['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
        methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
    )

    # Register security headers middleware
    from app.middleware.security import register_security_headers
    register_security_headers(app)

    # Register API key authentication middleware
    from app.middleware.api_key_auth import register_api_key_auth
    register_api_key_auth(app)

    # Register API analytics middleware
    from app.middleware.api_analytics import register_api_analytics
    register_api_analytics(app)

    # Update rate limiter with custom key function
    from app.middleware.rate_limit import get_rate_limit_key, register_rate_limit_headers
    limiter._key_func = get_rate_limit_key
    register_rate_limit_headers(app)

    # Initialize SocketIO
    from app.sockets import init_socketio
    socketio = init_socketio(app)

    # Initialize Agent Gateway
    from app.agent_gateway import init_agent_gateway
    init_agent_gateway(socketio)

    # Register blueprints - Auth
    from app.api.auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix='/api/v1/auth')

    # Agent polling fallback transport (REST equivalent of the WS gateway,
    # used when tunnels mangle WebSocket frames).
    from app.api.agent_poll import agent_poll_bp
    app.register_blueprint(agent_poll_bp, url_prefix='/api/v1/agent')

    # Register blueprints - Core
    from app.api.apps import apps_bp
    from app.api.domains import domains_bp
    from app.api.private_urls import private_urls_bp
    app.register_blueprint(apps_bp, url_prefix='/api/v1/apps')
    app.register_blueprint(domains_bp, url_prefix='/api/v1/domains')
    app.register_blueprint(private_urls_bp, url_prefix='/api/v1/apps')

    # Register blueprints - System
    from app.api.system import system_bp
    from app.api.processes import processes_bp
    from app.api.logs import logs_bp
    app.register_blueprint(system_bp, url_prefix='/api/v1/system')
    app.register_blueprint(processes_bp, url_prefix='/api/v1/processes')
    app.register_blueprint(logs_bp, url_prefix='/api/v1/logs')

    # Register blueprints - Infrastructure
    from app.api.nginx import nginx_bp
    from app.api.ssl import ssl_bp
    app.register_blueprint(nginx_bp, url_prefix='/api/v1/nginx')
    app.register_blueprint(ssl_bp, url_prefix='/api/v1/ssl')

    # Register blueprints - PHP & WordPress
    from app.api.php import php_bp
    from app.api.wordpress import wordpress_bp
    from app.api.wordpress_sites import wordpress_sites_bp
    from app.api.environment_pipeline import environment_pipeline_bp
    app.register_blueprint(php_bp, url_prefix='/api/v1/php')
    app.register_blueprint(wordpress_bp, url_prefix='/api/v1/wordpress')
    app.register_blueprint(wordpress_sites_bp, url_prefix='/api/v1/wordpress')
    app.register_blueprint(environment_pipeline_bp, url_prefix='/api/v1/wordpress/projects')

    # Register blueprints - Python
    from app.api.python import python_bp
    app.register_blueprint(python_bp, url_prefix='/api/v1/python')

    # Register blueprints - Docker
    from app.api.docker import docker_bp
    app.register_blueprint(docker_bp, url_prefix='/api/v1/docker')

    # Register blueprints - Databases
    from app.api.databases import databases_bp
    app.register_blueprint(databases_bp, url_prefix='/api/v1/databases')

    # Register blueprints - Monitoring & Alerts
    from app.api.monitoring import monitoring_bp
    app.register_blueprint(monitoring_bp, url_prefix='/api/v1/monitoring')

    # Register blueprints - Notifications
    from app.api.notifications import notifications_bp
    app.register_blueprint(notifications_bp, url_prefix='/api/v1/notifications')

    # Register blueprints - Backups
    from app.api.backups import backups_bp
    app.register_blueprint(backups_bp, url_prefix='/api/v1/backups')

    # Register blueprints - Git Deployment
    from app.api.deploy import deploy_bp
    app.register_blueprint(deploy_bp, url_prefix='/api/v1/deploy')

    # Register blueprints - Builds & Deployments
    from app.api.builds import builds_bp
    from app.api.deployment_jobs import deployment_jobs_bp
    app.register_blueprint(builds_bp, url_prefix='/api/v1/builds')
    app.register_blueprint(deployment_jobs_bp, url_prefix='/api/v1/deployment-jobs')

    # Register blueprints - Templates
    from app.api.templates import templates_bp
    app.register_blueprint(templates_bp, url_prefix='/api/v1/templates')

    # Register blueprints - File Manager
    from app.api.files import files_bp
    app.register_blueprint(files_bp, url_prefix='/api/v1/files')

    # Register blueprints - FTP Server
    from app.api.ftp import ftp_bp
    app.register_blueprint(ftp_bp, url_prefix='/api/v1/ftp')

    # Register blueprints - Firewall
    from app.api.firewall import firewall_bp
    app.register_blueprint(firewall_bp, url_prefix='/api/v1/firewall')

    # Register blueprints - Git Server
    from app.api.git import git_bp
    app.register_blueprint(git_bp, url_prefix='/api/v1/git')

    # Register blueprints - Security (ClamAV, File Integrity, etc.)
    from app.api.security import security_bp
    app.register_blueprint(security_bp, url_prefix='/api/v1/security')

    # Register blueprints - Cron Jobs
    from app.api.cron import cron_bp
    app.register_blueprint(cron_bp, url_prefix='/api/v1/cron')

    # Register blueprints - Email Server
    from app.api.email import email_bp
    app.register_blueprint(email_bp, url_prefix='/api/v1/email')

    # Register blueprints - Uptime Tracking
    from app.api.uptime import uptime_bp
    app.register_blueprint(uptime_bp, url_prefix='/api/v1/uptime')

    # Register blueprints - Environment Variables
    from app.api.env_vars import env_vars_bp
    app.register_blueprint(env_vars_bp, url_prefix='/api/v1/apps')

    # Register blueprints - Two-Factor Authentication
    from app.api.two_factor import two_factor_bp
    app.register_blueprint(two_factor_bp, url_prefix='/api/v1/auth/2fa')

    # Register blueprints - SSO / OAuth
    from app.api.sso import sso_bp
    app.register_blueprint(sso_bp, url_prefix='/api/v1/sso')

    # Register blueprints - Database Migrations
    from app.api.migrations import migrations_bp
    app.register_blueprint(migrations_bp, url_prefix='/api/v1/migrations')

    # Register blueprints - API Enhancements
    from app.api.api_keys import api_keys_bp
    from app.api.api_analytics import api_analytics_bp
    from app.api.event_subscriptions import event_subscriptions_bp
    from app.api.docs import docs_bp
    app.register_blueprint(api_keys_bp, url_prefix='/api/v1/api-keys')
    app.register_blueprint(api_analytics_bp, url_prefix='/api/v1/api-analytics')
    app.register_blueprint(event_subscriptions_bp, url_prefix='/api/v1/event-subscriptions')
    app.register_blueprint(docs_bp, url_prefix='/api/v1/docs')

    # Register blueprints - Admin (User Management, Settings, Audit Logs)
    from app.api.admin import admin_bp
    app.register_blueprint(admin_bp, url_prefix='/api/v1/admin')

    # Register blueprints - Invitations
    from app.api.invitations import invitations_bp
    app.register_blueprint(invitations_bp, url_prefix='/api/v1/admin/invitations')

    # Register blueprints - Historical Metrics
    from app.api.metrics import metrics_bp
    app.register_blueprint(metrics_bp, url_prefix='/api/v1/metrics')

    # Register blueprints - Workflows
    from app.api.workflows import workflows_bp
    app.register_blueprint(workflows_bp, url_prefix='/api/v1/workflows')

    # Register blueprints - Servers (Multi-server management)
    from app.api.servers import servers_bp
    app.register_blueprint(servers_bp, url_prefix='/api/v1/servers')

    # Register blueprints - Fleet Monitor (Cross-server monitoring)
    from app.api.fleet_monitor import fleet_monitor_bp
    app.register_blueprint(fleet_monitor_bp, url_prefix='/api/v1/fleet-monitor')

    # Register blueprints - Agent Plugins
    from app.api.agent_plugins import agent_plugins_bp
    app.register_blueprint(agent_plugins_bp, url_prefix='/api/v1/agent-plugins')

    # Register blueprints - Server Templates
    from app.api.server_templates import server_templates_bp
    app.register_blueprint(server_templates_bp, url_prefix='/api/v1/server-templates')

    # Register blueprints - Workspaces
    from app.api.workspaces import workspaces_bp
    app.register_blueprint(workspaces_bp, url_prefix='/api/v1/workspaces')

    # Register blueprints - Advanced SSL
    from app.api.advanced_ssl import advanced_ssl_bp
    app.register_blueprint(advanced_ssl_bp, url_prefix='/api/v1/ssl/advanced')

    # Register blueprints - DNS Zones
    from app.api.dns_zones import dns_zones_bp
    app.register_blueprint(dns_zones_bp, url_prefix='/api/v1/dns')

    # Register blueprints - Nginx Advanced
    from app.api.nginx_advanced import nginx_advanced_bp
    app.register_blueprint(nginx_advanced_bp, url_prefix='/api/v1/nginx/advanced')

    # Register blueprints - Status Pages
    from app.api.status_pages import status_pages_bp
    app.register_blueprint(status_pages_bp, url_prefix='/api/v1/status')

    # Register blueprints - Cloud Provisioning
    from app.api.cloud_provisioning import cloud_provisioning_bp
    app.register_blueprint(cloud_provisioning_bp, url_prefix='/api/v1/cloud')

    # Register blueprints - Performance
    from app.api.performance import performance_bp
    app.register_blueprint(performance_bp, url_prefix='/api/v1/performance')

    # Register blueprints - Mobile
    from app.api.mobile import mobile_bp
    app.register_blueprint(mobile_bp, url_prefix='/api/v1/mobile')

    # Register blueprints - Marketplace
    from app.api.marketplace import marketplace_bp
    app.register_blueprint(marketplace_bp, url_prefix='/api/v1/marketplace')

    # Register blueprints - Plugins
    from app.api.plugins import plugins_bp
    app.register_blueprint(plugins_bp, url_prefix='/api/v1/plugins')

    # Register blueprints - Agent Pairing (RustDesk-style short-code flow)
    from app.api.pairing import pairing_bp
    app.register_blueprint(pairing_bp, url_prefix='/api/v1/pairing')

    # Load installed plugins (dynamic blueprints)
    try:
        from app.services.plugin_service import load_all_plugins
        load_all_plugins(app)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f'Plugin loader: {e}')

    # Handle database migrations (Alembic)
    with app.app_context():
        from app.services.migration_service import MigrationService
        MigrationService.check_and_prepare(app)

        # Initialize default settings and migrate legacy roles
        from app.services.settings_service import SettingsService
        SettingsService.initialize_defaults()
        SettingsService.migrate_legacy_roles()

        # Start metrics history collection in background
        from app.services.metrics_history_service import MetricsHistoryService
        if not MetricsHistoryService.is_running():
            MetricsHistoryService.start_collection(app)

        # Start auto-sync scheduler for WordPress environments
        _start_auto_sync_scheduler(app)

        # Start workflow scheduler
        _start_workflow_scheduler(app)

        # Start API analytics flush thread
        from app.middleware.api_analytics import start_analytics_flush_thread
        start_analytics_flush_thread(app)

        # Start hourly analytics aggregation and event retry threads
        _start_api_background_threads(app)

        # Start hourly pruner for expired pending agent pairings
        _start_pairing_pruner(app)

    # Request body size limit
    app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB limit

    # Reject 2FA pending tokens on non-2FA endpoints
    @app.before_request
    def check_2fa_pending():
        """Reject 2FA pending tokens on non-2FA endpoints."""
        from flask_jwt_extended import verify_jwt_in_request, get_jwt
        if request.endpoint and request.path.startswith('/api/'):
            # Allow 2FA verification endpoints
            if '/two-factor/verify' in request.path or '/two-factor/verify-backup' in request.path:
                return
            # Allow auth endpoints (login, refresh)
            if '/auth/login' in request.path or '/auth/refresh' in request.path:
                return
            try:
                verify_jwt_in_request()
                claims = get_jwt()
                if claims.get('2fa_pending'):
                    return jsonify({'error': '2FA verification required'}), 403
            except Exception:
                pass  # Let @jwt_required handle actual auth errors

    # Serve frontend for root path
    @app.route('/')
    def serve_index():
        index = os.path.join(app.static_folder, 'index.html') if app.static_folder else None
        if index and os.path.isfile(index):
            return send_from_directory(app.static_folder, 'index.html')
        return {'message': 'ServerKit API is running', 'docs': '/api/v1/'}, 200

    # Catch-all route for SPA - must be after all other routes
    @app.errorhandler(404)
    def not_found(e):
        from flask import request
        if request.path.startswith('/api/'):
            return {'error': 'Not found'}, 404
        # Serve SPA index.html if it exists, otherwise JSON 404
        index = os.path.join(app.static_folder, 'index.html') if app.static_folder else None
        if index and os.path.isfile(index):
            return send_from_directory(app.static_folder, 'index.html')
        return {'error': 'Not found'}, 404

    return app


def get_socketio():
    """Get the SocketIO instance."""
    return socketio


_auto_sync_thread = None


def _start_auto_sync_scheduler(app):
    """Start a background thread that checks for auto-sync schedules."""
    global _auto_sync_thread
    if _auto_sync_thread is not None:
        return

    import threading
    import time
    import logging

    logger = logging.getLogger(__name__)

    def auto_sync_loop():
        while True:
            try:
                time.sleep(60)  # Check every 60 seconds
                with app.app_context():
                    _check_auto_sync_schedules(logger)
            except Exception as e:
                logger.error(f'Auto-sync scheduler error: {e}')

    _auto_sync_thread = threading.Thread(
        target=auto_sync_loop,
        daemon=True,
        name='auto-sync-scheduler'
    )
    _auto_sync_thread.start()


def _check_auto_sync_schedules(logger):
    """Check all auto-sync enabled sites and run syncs that are due."""
    from app.models.wordpress_site import WordPressSite
    from datetime import datetime

    sites = WordPressSite.query.filter_by(auto_sync_enabled=True).all()
    if not sites:
        return

    try:
        from croniter import croniter
    except ImportError:
        logger.debug('croniter not installed, skipping auto-sync check')
        return

    now = datetime.utcnow()

    for site in sites:
        if not site.auto_sync_schedule:
            continue

        try:
            if not croniter.is_valid(site.auto_sync_schedule):
                continue

            cron = croniter(site.auto_sync_schedule, now)
            prev_run = cron.get_prev(datetime)

            # Check if a run was due in the last 90 seconds (to account for check interval)
            seconds_since_due = (now - prev_run).total_seconds()
            if seconds_since_due <= 90:
                logger.info(f'Auto-sync triggered for site {site.id} ({site.name})')
                from app.services.environment_pipeline_service import EnvironmentPipelineService
                EnvironmentPipelineService.sync_from_production(
                    env_site_id=site.id,
                    sync_type='full',
                    user_id=None
                )
        except Exception as e:
            logger.error(f'Auto-sync check failed for site {site.id}: {e}')


_api_bg_thread = None


def _start_pairing_pruner(app):
    """Start a background thread that prunes expired PendingAgent rows hourly."""
    global _pairing_prune_thread
    if _pairing_prune_thread is not None:
        return

    import threading
    import time
    import logging

    logger = logging.getLogger(__name__)

    def prune_loop():
        # Wait a bit before first run so app is fully initialized.
        time.sleep(60)
        while True:
            try:
                with app.app_context():
                    from app.services import pairing_service
                    pairing_service.prune_expired()
            except Exception as e:
                logger.error(f'Pairing pruner error: {e}')
            time.sleep(3600)

    _pairing_prune_thread = threading.Thread(
        target=prune_loop,
        daemon=True,
        name='pairing-pruner'
    )
    _pairing_prune_thread.start()


_pairing_prune_thread = None


def _start_api_background_threads(app):
    """Start background threads for API analytics aggregation and event delivery retry."""
    global _api_bg_thread
    if _api_bg_thread is not None:
        return

    import threading
    import time
    import logging

    logger = logging.getLogger(__name__)

    def api_bg_loop():
        while True:
            try:
                time.sleep(3600)  # Run hourly
                with app.app_context():
                    from app.services.api_analytics_service import ApiAnalyticsService
                    ApiAnalyticsService.aggregate_hourly()

                    from app.services.event_service import EventService
                    EventService.retry_failed()
            except Exception as e:
                logger.error(f'API background thread error: {e}')

    _api_bg_thread = threading.Thread(
        target=api_bg_loop,
        daemon=True,
        name='api-background'
    )
    _api_bg_thread.start()


_workflow_thread = None


def _start_workflow_scheduler(app):
    """Start a background thread that checks for scheduled workflows."""
    global _workflow_thread
    if _workflow_thread is not None:
        return

    import threading
    import time
    import logging

    logger = logging.getLogger(__name__)

    def workflow_loop():
        while True:
            try:
                time.sleep(60)  # Check every 60 seconds
                with app.app_context():
                    _check_workflow_schedules(logger)
            except Exception as e:
                logger.error(f'Workflow scheduler error: {e}')

    _workflow_thread = threading.Thread(
        target=workflow_loop,
        daemon=True,
        name='workflow-scheduler'
    )
    _workflow_thread.start()


def _check_workflow_schedules(logger):
    """Check all active workflows with cron triggers and run those that are due."""
    from app.models.workflow import Workflow
    from app.services.workflow_engine import WorkflowEngine
    from datetime import datetime
    import json

    try:
        from croniter import croniter
    except ImportError:
        logger.debug('croniter not installed, skipping workflow schedule check')
        return

    # Find active workflows with cron triggers
    workflows = Workflow.query.filter_by(is_active=True, trigger_type='cron').all()
    if not workflows:
        return

    now = datetime.utcnow()

    for workflow in workflows:
        try:
            config = json.loads(workflow.trigger_config) if workflow.trigger_config else {}
            cron_expr = config.get('cron')
            
            if not cron_expr or not croniter.is_valid(cron_expr):
                continue

            cron = croniter(cron_expr, now)
            prev_run = cron.get_prev(datetime)

            # Check if a run was due in the last 90 seconds
            seconds_since_due = (now - prev_run).total_seconds()
            
            # Also ensure we don't run it multiple times for the same slot
            if 0 < seconds_since_due <= 90:
                # Check if it already ran in the last 2 minutes
                if workflow.last_run_at:
                    seconds_since_last_run = (now - workflow.last_run_at).total_seconds()
                    if seconds_since_last_run < 110:
                        continue

                logger.info(f'Scheduled workflow triggered: {workflow.name} (ID: {workflow.id})')
                WorkflowEngine.execute_workflow(
                    workflow_id=workflow.id,
                    trigger_type='cron',
                    context={'scheduled_at': prev_run.isoformat()}
                )
        except Exception as e:
            logger.error(f'Workflow schedule check failed for workflow {workflow.id}: {e}')
