"""Proving tests for the DNS cutover API (``/api/v1/dns-cutover``, plan 31 #1).

Covers: auth + admin gating, TTL guidance, the dry-run cutover (no provider
needed), the snapshot-required contract, verify, and revert — with the provider
client stubbed so nothing touches the network.
"""
import pytest

from app import db
from app.models.dns_cutover_snapshot import DnsCutoverSnapshot
from app.services.dns_cutover_service import DnsCutoverService


DOMAIN = 'site.example.com'
ZONE = 'zone123'


class _FakeConfig:
    id = 1
    provider = 'cloudflare'
    name = 'test-cf'


class _FakeClient:
    """Minimal Cloudflare-shaped client backed by an in-memory record list."""

    def __init__(self, records=None):
        self.records = [dict(r) for r in (records or [])]
        self._seq = 100

    def list_records(self, zone_id):
        return {'success': True, 'records': [dict(r) for r in self.records]}

    def find_record_id(self, zone_id, record_type, name, caa=None):
        for r in self.records:
            if r['type'] == record_type and r['name'] == name:
                return r['id']
        return None

    def upsert(self, zone_id, spec, record_id=None):
        self._seq += 1
        rid = record_id or f'rec{self._seq}'
        self.records = [r for r in self.records
                        if not (r['type'] == spec.record_type and r['name'] == spec.name)]
        self.records.append({'id': rid, 'type': spec.record_type, 'name': spec.name,
                             'content': spec.content, 'ttl': spec.ttl,
                             'proxied': spec.proxied, 'priority': spec.priority})
        return {'success': True, 'record_id': rid}

    def delete(self, zone_id, record_id=None, record_type=None, name=None):
        self.records = [r for r in self.records if r['id'] != record_id]
        return {'success': True}


def _install_client(monkeypatch, client, config=None):
    config = config or _FakeConfig()
    monkeypatch.setattr(
        DnsCutoverService, '_resolve_dns_client',
        lambda provider=None, provider_zone_id=None: (client, config))


@pytest.fixture
def member_headers(app):
    from app.models import User
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash
    user = User(email='member@t.local', username='member_cutover',
                password_hash=generate_password_hash('x'),
                role=User.ROLE_VIEWER, is_active=True)
    db.session.add(user)
    db.session.commit()
    return {'Authorization': f'Bearer {create_access_token(identity=user.id)}'}


def _snapshot(records=None):
    snap = DnsCutoverSnapshot(domain=DOMAIN, provider='cloudflare',
                              provider_zone_id=ZONE, status='captured')
    snap.set_records(records or [])
    db.session.add(snap)
    db.session.commit()
    return snap


# --------------------------------------------------------------------------- #
# auth
# --------------------------------------------------------------------------- #

def test_endpoints_require_auth(client):
    assert client.post('/api/v1/dns-cutover/ttl-guidance', json={}).status_code == 401
    assert client.get('/api/v1/dns-cutover/snapshots').status_code == 401


def test_snapshot_requires_admin(client, member_headers):
    r = client.post('/api/v1/dns-cutover/snapshot', headers=member_headers,
                    json={'domain': DOMAIN, 'provider_zone_id': ZONE})
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# ttl guidance (read verb, any authed user)
# --------------------------------------------------------------------------- #

def test_ttl_guidance_endpoint(client, auth_headers):
    r = client.post('/api/v1/dns-cutover/ttl-guidance', headers=auth_headers,
                    json={'records': [{'name': DOMAIN, 'type': 'A', 'ttl': 3600}]})
    assert r.status_code == 200
    assert r.get_json()['recommended_ttl'] == 300


# --------------------------------------------------------------------------- #
# cutover: snapshot required + dry-run
# --------------------------------------------------------------------------- #

def test_cutover_requires_snapshot_id(client, auth_headers):
    r = client.post('/api/v1/dns-cutover/cutover', headers=auth_headers,
                    json={'target': '198.51.100.9'})
    assert r.status_code == 400
    assert 'snapshot_id' in r.get_json()['error']


def test_cutover_dry_run_needs_no_provider(client, auth_headers):
    snap = _snapshot([])
    r = client.post('/api/v1/dns-cutover/cutover', headers=auth_headers,
                    json={'snapshot_id': snap.id, 'target': '198.51.100.9',
                          'dry_run': True})
    assert r.status_code == 200
    body = r.get_json()
    assert body['dry_run'] is True
    assert body['ops'][0]['new'] == '198.51.100.9'


def test_cutover_missing_snapshot_404(client, auth_headers):
    r = client.post('/api/v1/dns-cutover/cutover', headers=auth_headers,
                    json={'snapshot_id': 999999, 'target': '198.51.100.9'})
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# snapshot / verify / revert (provider stubbed)
# --------------------------------------------------------------------------- #

def test_snapshot_endpoint_creates_row(client, auth_headers, monkeypatch):
    _install_client(monkeypatch, _FakeClient([
        {'id': 'a1', 'type': 'A', 'name': DOMAIN, 'content': '203.0.113.1',
         'ttl': 3600, 'proxied': False, 'priority': None}]))
    r = client.post('/api/v1/dns-cutover/snapshot', headers=auth_headers,
                    json={'domain': DOMAIN, 'provider_zone_id': ZONE,
                          'provider': 'cloudflare'})
    assert r.status_code == 201
    body = r.get_json()
    assert body['status'] == 'captured' and body['record_count'] == 1


def test_verify_endpoint(client, auth_headers, monkeypatch):
    from app.services.dns_zone_service import DNSZoneService
    monkeypatch.setattr(DNSZoneService, 'check_propagation', staticmethod(
        lambda domain, record_type='A': [
            {'nameserver': 'Google', 'result': ['198.51.100.9'], 'propagated': True}]))
    r = client.post('/api/v1/dns-cutover/verify', headers=auth_headers,
                    json={'domain': DOMAIN, 'expected': '198.51.100.9'})
    assert r.status_code == 200
    assert r.get_json()['matches_expected'] is True


def test_revert_endpoint_round_trip(client, auth_headers, monkeypatch):
    _install_client(monkeypatch, _FakeClient())
    snap = _snapshot([])
    DnsCutoverService.cutover(snap, target='198.51.100.9')  # create-only

    r = client.post(f'/api/v1/dns-cutover/snapshots/{snap.id}/revert',
                    headers=auth_headers)
    assert r.status_code == 200
    body = r.get_json()
    assert body['deleted_count'] == 1
    assert body['status'] == 'reverted_with_deletions'


def test_list_and_get_snapshots(client, auth_headers):
    snap = _snapshot([])
    r = client.get('/api/v1/dns-cutover/snapshots', headers=auth_headers)
    assert r.status_code == 200
    assert any(s['id'] == snap.id for s in r.get_json()['snapshots'])

    r2 = client.get(f'/api/v1/dns-cutover/snapshots/{snap.id}', headers=auth_headers)
    assert r2.status_code == 200 and r2.get_json()['id'] == snap.id

    assert client.get('/api/v1/dns-cutover/snapshots/999999',
                      headers=auth_headers).status_code == 404
