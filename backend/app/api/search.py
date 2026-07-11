"""Unified entity omnisearch API (plan 41, Phase 4).

A single authz-aware endpoint the command palette calls to search across the
core entity types (services, servers, domains, databases, WordPress sites, cron
jobs, extensions, vaults). Business logic lives in SearchService; this blueprint
just validates the term, resolves the user, and shapes the JSON.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.models.user import User
from app.services.search_service import SearchService

search_bp = Blueprint('search', __name__)


@search_bp.route('', methods=['GET'])
@jwt_required()
def search():
    """Search entities by name. ?q=<term> (>= 2 chars). Returns {'results': [...]}."""
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify({'results': []}), 200

    user = User.query.get(get_jwt_identity())
    workspace = request.headers.get('X-Workspace-Id') or request.args.get('workspace_id')
    rows = SearchService.search(user, q, workspace)
    return jsonify({'results': rows}), 200
