"""
LocalKit Bridge API — endpoints for the LocalKit desktop app.

Mounted at ``/api/v1/localkit`` (see plugin.json). Every route accepts
``X-API-Key`` auth because it is guarded by the RBAC decorators
(``auth_required`` / ``admin_required``) that honor the API-key middleware
(``g.api_key_user``) — bare flask ``@jwt_required()`` would reject API keys
(see docs/WORDPRESS_ROADMAP.md; this blueprint is the API-key-friendly
surface for WordPress automation).

Endpoints (all JSON unless noted):
  GET  /pair        — validate the API key + report panel info
  GET  /sites       — list WordPress sites (delegates to serverkit-wordpress)
  POST /sites       — provision a new WordPress site to push into
  POST /push/code   — multipart: site_id + wp-content tar.gz -> docker cp into the site
  POST /push/db     — multipart: site_id + SQL dump + local_url -> import + search-replace
  GET  /pull/db     — ?site_id= -> gzipped SQL dump of the site's database

Sync v1: push/pull run inline (no job queue). Large pushes are bounded by the
panel's MAX_CONTENT_LENGTH (100MB).
"""

import importlib
import os
import shutil
import subprocess
import tarfile
import tempfile

from flask import Blueprint, after_this_request, jsonify, request, send_file

from app.middleware.rbac import admin_required, auth_required, get_current_user
from app.services.db_sync_service import DatabaseSyncService
from app.services.settings_service import SettingsService
from app.utils.domain import canonical_origin
from app.utils.version import get_panel_version

localkit_bp = Blueprint('localkit', __name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wp_service():
    """Import the serverkit-wordpress service layer (cross-extension), or
    return None when that extension is not installed."""
    try:
        return importlib.import_module(
            'app.plugins.serverkit-wordpress.wordpress_service').WordPressService
    except Exception:
        pass
    try:
        from app.services.plugin_service import _ensure_importable
        if _ensure_importable('serverkit-wordpress'):
            return importlib.import_module(
                'app.plugins.serverkit-wordpress.wordpress_service').WordPressService
    except Exception:
        pass
    return None


def _require_wp_service():
    svc = _wp_service()
    if svc is None:
        return None, (jsonify({
            'error': 'The serverkit-wordpress extension is not installed on this server'
        }), 409)
    return svc, None


def _resolve_site(site_id):
    from app.models import WordPressSite
    try:
        site_id = int(site_id)
    except (TypeError, ValueError):
        return None, (jsonify({'error': 'site_id is required'}), 400)
    site = WordPressSite.query.get(site_id)
    if not site or not site.application:
        return None, (jsonify({'error': 'Site not found'}), 404)
    return site, None


def _site_url(site):
    """Public URL of a site: primary domain if set, else localhost:port —
    mirrors WordPressService._enrich_site_data."""
    app = site.application
    domains = app.domains
    primary = next((d for d in domains if d.is_primary), None)
    if primary is None and domains:
        primary = domains[0]
    if primary is not None:
        scheme = 'https' if primary.ssl_enabled else 'http'
        return f'{scheme}://{primary.name}'
    if app.port:
        return f'http://localhost:{app.port}'
    return None


def _read_env_value(root_path, key):
    try:
        with open(os.path.join(root_path, '.env')) as f:
            for line in f:
                if '=' in line:
                    k, v = line.split('=', 1)
                    if k.strip() == key:
                        return v.strip()
    except OSError:
        pass
    return None


def _compose_file(site):
    root_path = site.application.root_path
    if not root_path:
        return None
    compose_file = os.path.join(root_path, 'docker-compose.yml')
    return compose_file if os.path.exists(compose_file) else None


def _safe_extract_tar_gz(archive_path, dest_dir):
    """Extract a .tar.gz into dest_dir, rejecting path traversal and links
    (same policy as WordPressService._safe_extract_zip)."""
    dest_abs = os.path.abspath(dest_dir)
    try:
        with tarfile.open(archive_path, 'r:gz') as tf:
            for member in tf.getmembers():
                if member.issym() or member.islnk():
                    return {'success': False,
                            'error': f'Links are not allowed in archive: {member.name}'}
                target = os.path.abspath(os.path.join(dest_abs, member.name))
                if target != dest_abs and not target.startswith(dest_abs + os.sep):
                    return {'success': False, 'error': f'Unsafe path in archive: {member.name}'}
            tf.extractall(dest_abs)
        return {'success': True}
    except (tarfile.TarError, OSError, EOFError) as e:
        return {'success': False, 'error': f'Not a valid tar.gz archive: {e}'}


# ---------------------------------------------------------------------------
# Pairing
# ---------------------------------------------------------------------------

@localkit_bp.route('/pair', methods=['GET'])
@auth_required()
def pair():
    """Validate the API key and return panel info for LocalKit's settings UI."""
    user = get_current_user()
    canonical_domain = SettingsService.get('canonical_domain', '') or ''
    https_enabled = bool(SettingsService.get('canonical_https_enabled', False))
    return jsonify({
        'status': 'ok',
        'service': 'serverkit-localkit',
        'panel': 'ServerKit',
        'version': get_panel_version(),
        'user': (getattr(user, 'username', None) or getattr(user, 'email', None)
                 or getattr(user, 'name', None)),
        'canonical_domain': canonical_domain,
        'canonical_origin': canonical_origin(canonical_domain, https_enabled) if canonical_domain else None,
    }), 200


# ---------------------------------------------------------------------------
# Sites
# ---------------------------------------------------------------------------

@localkit_bp.route('/sites', methods=['GET'])
@admin_required
def list_sites():
    """List WordPress sites — the API-key-friendly equivalent of
    GET /api/v1/wordpress/sites (which is JWT-only)."""
    svc, err = _require_wp_service()
    if err:
        return err
    return jsonify(svc.get_sites()), 200


@localkit_bp.route('/sites', methods=['POST'])
@admin_required
def create_site():
    """Provision a fresh WordPress site to push into."""
    svc, err = _require_wp_service()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Site name is required'}), 400
    user = get_current_user()
    admin_email = (data.get('admin_email') or getattr(user, 'email', None)
                   or 'admin@example.com')
    result = svc.create_site(
        name,
        admin_email,
        user.id,
        php_version=data.get('php_version') or None,
    )
    return jsonify(result), (201 if result.get('success') else 400)


# ---------------------------------------------------------------------------
# Push / pull
# ---------------------------------------------------------------------------

@localkit_bp.route('/push/code', methods=['POST'])
@admin_required
def push_code():
    """Receive a tar.gz of wp-content and install it into the site's container."""
    svc, err = _require_wp_service()
    if err:
        return err
    site, err = _resolve_site(request.form.get('site_id'))
    if err:
        return err
    upload = request.files.get('file')
    if upload is None:
        return jsonify({'error': 'file is required (multipart tar.gz of wp-content)'}), 400

    tmp = tempfile.mkdtemp(prefix='localkit_push_')
    try:
        archive_path = os.path.join(tmp, 'wp-content.tar.gz')
        upload.save(archive_path)

        extract_dir = os.path.join(tmp, 'x')
        os.makedirs(extract_dir, exist_ok=True)
        ext = _safe_extract_tar_gz(archive_path, extract_dir)
        if not ext.get('success'):
            return jsonify(ext), 400

        wpc = svc._resolve_wp_content_dir(extract_dir)
        if not wpc:
            return jsonify({'error': 'No wp-content found in the archive'}), 400

        container = site.application.name
        cp = subprocess.run(
            ['docker', 'cp', f'{wpc}/.', f'{container}:/var/www/html/wp-content'],
            capture_output=True, text=True, timeout=600,
        )
        if cp.returncode != 0:
            return jsonify({'error': f'docker cp failed: {cp.stderr}'}), 500
        # Imported files land root-owned; hand them to the web user.
        subprocess.run(
            ['docker', 'exec', container, 'chown', '-R', 'www-data:www-data',
             '/var/www/html/wp-content'],
            capture_output=True, text=True, timeout=300,
        )
        if site.application.root_path:
            svc.wp_cli(site.application.root_path, ['cache', 'flush'])
        return jsonify({'success': True, 'message': 'wp-content pushed to the site'}), 200
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@localkit_bp.route('/push/db', methods=['POST'])
@admin_required
def push_db():
    """Receive a SQL dump, import it over the site's database and rewrite the
    site URL local -> remote (serialization-safe wp-cli search-replace)."""
    svc, err = _require_wp_service()
    if err:
        return err
    site, err = _resolve_site(request.form.get('site_id'))
    if err:
        return err
    upload = request.files.get('file')
    if upload is None:
        return jsonify({'error': 'file is required (multipart .sql or .sql.gz dump)'}), 400
    local_url = (request.form.get('local_url') or '').strip().rstrip('/')

    compose_file = _compose_file(site)
    if not compose_file:
        return jsonify({'error': 'Not a Docker-stack site (no docker-compose.yml)'}), 409

    suffix = '.sql.gz' if (upload.filename or '').endswith('.gz') else '.sql'
    fd, dump_path = tempfile.mkstemp(prefix='localkit_push_', suffix=suffix)
    os.close(fd)
    try:
        upload.save(dump_path)
        result = DatabaseSyncService.import_to_container(
            compose_path=compose_file,
            snapshot_path=dump_path,
            db_name='wordpress',
            db_user='root',
            db_password=_read_env_value(site.application.root_path, 'DB_PASSWORD'),
        )
        if not result.get('success'):
            return jsonify({'error': f"Database import failed: {result.get('error')}"}), 500

        remote_url = _site_url(site)
        search_replaced = False
        if local_url and remote_url and local_url != remote_url:
            root_path = site.application.root_path
            svc.wp_cli(root_path, ['option', 'update', 'home', remote_url])
            svc.wp_cli(root_path, ['option', 'update', 'siteurl', remote_url])
            sr = svc.search_replace(root_path, local_url, remote_url)
            search_replaced = bool(sr.get('success'))
            svc.wp_cli(root_path, ['cache', 'flush'])
            svc.wp_cli(root_path, ['rewrite', 'flush'])

        return jsonify({
            'success': True,
            'message': 'Database imported',
            'remote_url': remote_url,
            'search_replace': search_replaced,
        }), 200
    finally:
        try:
            os.remove(dump_path)
        except OSError:
            pass


@localkit_bp.route('/pull/db', methods=['GET'])
@admin_required
def pull_db():
    """Stream a gzipped SQL dump of the site's database."""
    site, err = _resolve_site(request.args.get('site_id'))
    if err:
        return err
    compose_file = _compose_file(site)
    if not compose_file:
        return jsonify({'error': 'Not a Docker-stack site (no docker-compose.yml)'}), 409

    fd, dump_path = tempfile.mkstemp(prefix='localkit_pull_', suffix='.sql.gz')
    os.close(fd)
    result = DatabaseSyncService.export_from_container(
        compose_path=compose_file,
        db_name='wordpress',
        db_user='root',
        db_password=_read_env_value(site.application.root_path, 'DB_PASSWORD'),
        output_path=dump_path,
        compress=True,
    )
    if not result.get('success'):
        try:
            os.remove(dump_path)
        except OSError:
            pass
        return jsonify({'error': f"Database export failed: {result.get('error')}"}), 500

    @after_this_request
    def _cleanup(response):
        try:
            os.remove(dump_path)
        except OSError:
            pass
        return response

    return send_file(
        dump_path,
        mimetype='application/gzip',
        as_attachment=True,
        download_name=f'{site.application.name}-db.sql.gz',
    )
