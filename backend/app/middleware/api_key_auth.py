"""API Key authentication middleware."""
from flask import g, request, jsonify


def register_api_key_auth(app):
    """Register API key authentication as a before_request handler."""

    @app.before_request
    def authenticate_api_key():
        """Check for X-API-Key header and validate."""
        api_key_header = request.headers.get('X-API-Key')

        if not api_key_header:
            return  # No API key provided, fall through to JWT auth

        from app.services.api_key_service import ApiKeyService
        api_key = ApiKeyService.validate_key(api_key_header)

        if not api_key:
            return jsonify({'error': 'Invalid or expired API key'}), 401

        # Record usage against the trusted client IP (see app.utils.client_ip).
        from app.utils.client_ip import get_client_ip
        api_key.record_usage(get_client_ip())

        from app import db
        db.session.commit()

        # Store in g for downstream use
        g.api_key = api_key
        g.api_key_user = api_key.user
