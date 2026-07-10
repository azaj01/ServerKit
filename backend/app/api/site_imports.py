"""Site imports API — migrate a control-panel backup archive into ServerKit.

Mounted at /api/v1/imports (see app/__init__.py blueprint registration).
All routes are admin-only: an import writes files, creates apps and touches
the database engine.
"""
from flask import Blueprint, jsonify, request

from app.middleware.rbac import admin_required, get_current_user
from app.services.site_import_service import SiteImportError, SiteImportService

site_imports_bp = Blueprint('site_imports', __name__)


@site_imports_bp.route('/upload', methods=['POST'])
@admin_required
def upload_archive():
    """Accept a backup archive upload; returns the token to pass as
    source.upload_path when creating the import."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    uploaded = request.files['file']
    if not uploaded or not uploaded.filename:
        return jsonify({'error': 'No file selected'}), 400
    try:
        upload_path = SiteImportService.save_upload(uploaded)
    except SiteImportError as exc:
        return jsonify({'error': str(exc)}), 400
    return jsonify({'upload_path': upload_path}), 201


@site_imports_bp.route('/ssh/probe', methods=['POST'])
@admin_required
def probe_ssh_source():
    """Preflight an SSH import source: test the connection, list the docroot,
    sniff the stack (plan 31 #8). Linux-only runtime — returns 501 on a host
    that can't run ssh (e.g. Windows dev) so the wizard can message it."""
    data = request.get_json(silent=True) or {}
    source = data.get('source') or data
    try:
        result = SiteImportService.probe_ssh(source)
    except SiteImportError as exc:
        return jsonify({'error': str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({'error': str(exc), 'code': 'LINUX_ONLY'}), 501
    return jsonify(result), 200


@site_imports_bp.route('', methods=['POST'])
@admin_required
def create_import():
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    try:
        imp = SiteImportService.create(
            source_type=data.get('source_type') or 'cpanel',
            source=data.get('source') or {},
            options=data.get('options') or {},
            user_id=user.id if user else None,
        )
    except SiteImportError as exc:
        return jsonify({'error': str(exc)}), 400
    return jsonify({'import': imp.to_dict()}), 201


@site_imports_bp.route('', methods=['GET'])
@admin_required
def list_imports():
    return jsonify({'imports': [i.to_dict(log_lines=0) for i in
                                SiteImportService.list()]})


@site_imports_bp.route('/<int:import_id>', methods=['GET'])
@admin_required
def get_import(import_id):
    imp = SiteImportService.get(import_id)
    if not imp:
        return jsonify({'error': 'Import not found'}), 404
    return jsonify({'import': imp.to_dict(log_lines=500)})


@site_imports_bp.route('/<int:import_id>/analyze', methods=['POST'])
@admin_required
def analyze_import(import_id):
    imp = SiteImportService.get(import_id)
    if not imp:
        return jsonify({'error': 'Import not found'}), 404
    if imp.status in ('analyzing', 'running'):
        return jsonify({'error': f'Import is currently {imp.status}'}), 409
    job = SiteImportService.enqueue_analyze(imp)
    return jsonify({'job_id': job.id}), 202


@site_imports_bp.route('/<int:import_id>/run', methods=['POST'])
@admin_required
def run_import(import_id):
    imp = SiteImportService.get(import_id)
    if not imp:
        return jsonify({'error': 'Import not found'}), 404
    if imp.status not in ('analyzed', 'failed'):
        return jsonify({'error': "Import must be analysed before it can run "
                                 f"(status: {imp.status})"}), 409
    data = request.get_json(silent=True) or {}
    from_step = data.get('from_step') or None
    # Merge wizard-provided run options into the stored ones (body wins),
    # e.g. {'skip_db': True, 'skip_crontab': True}.
    body_options = data.get('options') or {}
    if body_options:
        from app import db
        imp.set_options({**imp.get_options(), **body_options})
        db.session.commit()
    job = SiteImportService.enqueue_run(imp, from_step=from_step)
    return jsonify({'job_id': job.id}), 202


@site_imports_bp.route('/<int:import_id>', methods=['DELETE'])
@admin_required
def delete_import(import_id):
    imp = SiteImportService.get(import_id)
    if not imp:
        return jsonify({'error': 'Import not found'}), 404
    if imp.status in ('analyzing', 'running'):
        return jsonify({'error': f'Import is currently {imp.status}'}), 409
    SiteImportService.delete(imp)
    return jsonify({'message': 'Import deleted'})
