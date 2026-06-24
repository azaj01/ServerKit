"""Fleet-wide proxy overview tests (Phase 4 of C6).

Covers the new ``ProxyStackService.fleet_overview()`` aggregator and the
``GET /api/v1/servers/proxy/overview`` endpoint. The endpoint is mounted under
``/api/v1/servers`` and must resolve to the static ``/proxy/overview`` rule
without colliding with the per-server ``/<server_id>/proxy`` route.
"""
import pytest

from app.services.proxy_stack_service import ProxyStackService as PS
# Import the model at module top so it's registered on db.metadata before the
# `app` fixture runs db.create_all() (the service imports it lazily).
from app.models.proxy_stack import ProxyStack  # noqa: F401


def _make_server(name, agent_id):
    from app import db
    from app.models.server import Server
    s = Server(name=name, agent_id=agent_id)
    db.session.add(s)
    db.session.commit()
    return s.id


# ---------------------------------------------------------------------------
# Service: fleet_overview
# ---------------------------------------------------------------------------

def test_fleet_overview_empty_when_no_servers(app):
    with app.app_context():
        assert PS.fleet_overview() == []


def test_fleet_overview_one_row_per_server(app):
    with app.app_context():
        sid_a = _make_server('alpha', 'agent-fp-a')
        sid_b = _make_server('bravo', 'agent-fp-b')
        sid_c = _make_server('charlie', 'agent-fp-c')

        overview = PS.fleet_overview()
        # A row for every server, even ones that never opted into a stack.
        assert len(overview) == 3
        ids = {row['server_id'] for row in overview}
        assert ids == {sid_a, sid_b, sid_c}

        # Each row carries the expected flat shape (incl. ingress reconciliation
        # counts so the dashboard can flag apps that disagree with the proxy).
        row = overview[0]
        assert set(row.keys()) == {
            'server_id', 'server_name', 'proxy_type', 'status',
            'last_regenerated_at', 'networks_count',
            'app_count', 'mismatch_count',
        }


def test_fleet_overview_host_default_for_unconfigured(app):
    with app.app_context():
        sid = _make_server('hostonly', 'agent-fp-host')
        overview = PS.fleet_overview()
        assert len(overview) == 1
        row = overview[0]
        # No managed stack → host nginx, status 'host'.
        assert row['server_id'] == sid
        assert row['proxy_type'] == 'nginx'
        assert row['status'] == 'host'
        assert row['last_regenerated_at'] is None
        assert row['networks_count'] == 0


def test_fleet_overview_reflects_configured_stack(app):
    with app.app_context():
        sid_default = _make_server('default-srv', 'agent-fp-def')
        sid_traefik = _make_server('traefik-srv', 'agent-fp-trf')

        # Configure one server onto a managed Traefik stack.
        PS.configure(sid_traefik, proxy_type='traefik')

        overview = PS.fleet_overview()
        by_id = {row['server_id']: row for row in overview}

        # Configured server reflects its stack type; not the host default.
        assert by_id[sid_traefik]['proxy_type'] == 'traefik'
        assert by_id[sid_traefik]['status'] != 'host'
        # networks_count comes from the stack's networks list (defaults to the
        # shared serverkit network on get_or_create).
        assert by_id[sid_traefik]['networks_count'] >= 1

        # Untouched server still reports the host default.
        assert by_id[sid_default]['proxy_type'] == 'nginx'
        assert by_id[sid_default]['status'] == 'host'


# ---------------------------------------------------------------------------
# Endpoint: GET /api/v1/servers/proxy/overview
# ---------------------------------------------------------------------------

def test_overview_endpoint_resolves_and_returns_json(app, client, auth_headers):
    with app.app_context():
        _make_server('endpoint-srv', 'agent-fp-ep')

    resp = client.get('/api/v1/servers/proxy/overview', headers=auth_headers)
    assert resp.status_code == 200
    body = resp.get_json()
    assert isinstance(body, dict)
    assert 'servers' in body
    assert isinstance(body['servers'], list)
    assert len(body['servers']) == 1
    assert body['servers'][0]['server_name'] == 'endpoint-srv'


def test_overview_endpoint_requires_auth(app, client):
    # No Authorization header → JWT-protected route rejects.
    resp = client.get('/api/v1/servers/proxy/overview')
    assert resp.status_code in (401, 422)


def test_overview_does_not_collide_with_per_server_proxy(app, client, auth_headers):
    """The static /proxy/overview rule must not be captured by the dynamic
    /<server_id>/proxy route (which would 404 'Server not found' for the
    pseudo-id 'proxy')."""
    with app.app_context():
        _make_server('collide-srv', 'agent-fp-col')

    overview_resp = client.get('/api/v1/servers/proxy/overview', headers=auth_headers)
    assert overview_resp.status_code == 200
    # If it had matched /<server_id>/proxy with server_id='proxy', the body
    # would be a single stack dict with an 'error' or stack shape — not a
    # 'servers' list. Assert we got the fleet shape.
    assert 'servers' in overview_resp.get_json()


def test_create_app_testing_still_works():
    """Sanity: the app factory imports + builds cleanly with our additions."""
    from app import create_app
    app = create_app('testing')
    assert app is not None
