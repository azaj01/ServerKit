"""Provider-registry resolution for DNS cutover (plan 31 #12, Decision 4).

Plan 27's cutover resolver hardcoded Cloudflare-or-501. This proves the resolver
now routes through the shared provider registry (``app.services.dns.get_client``)
so any provider with a shared client flows through, and a provider that lacks one
guards cleanly with ``NO_PROVIDER`` naming the provider — never a 500.

Reconstructed from the clean recovery pyc
(``test_dns_cutover_providers.cpython-311-pytest-8.3.5.pyc``).
"""
import pytest
from flask_jwt_extended import create_access_token
from werkzeug.security import generate_password_hash

from app import db
from app.models import User
from app.models.email import DNSProviderConfig
from app.api import dns_cutover as cutover_api  # noqa: F401 (ensure bp import)
from app.services.dns_cutover_service import DnsCutoverService

# plan 42 finding D7 — RESTORED by plan 42 Phase 5:
#   * ``DnsCutoverService.snapshot(domain, records, provider=, provider_zone_id=)``
#     (the explicit-records staging classmethod, sibling of the server-sourced
#     ``create_snapshot``) was re-added;
#   * the 501 ``NO_PROVIDER`` body now carries a ``provider`` field naming the
#     unsupported provider (``DnsCutoverError.provider`` surfaced by the API).
# Contract drift kept: the rebuilt ``/cutover`` returns the result UNWRAPPED
# (``body['success']``/``body['ops']`` — proven by the surviving
# ``test_dns_cutover_api.py``), NOT under a pre-loss ``cutover`` key, so the
# success assertion below reads ``body['success']`` to match the live contract.


@pytest.fixture
def admin_headers(app):
    user = User(email='provadmin@t.local', username='provadmin',
                password_hash=generate_password_hash('x'),
                role='admin', is_active=True)
    db.session.add(user)
    db.session.commit()
    return {'Authorization': 'Bearer ' + create_access_token(identity=user.id)}


def _add_provider(provider, is_default=True):
    from app.utils.crypto import encrypt_secret
    cfg = DNSProviderConfig(name=f'{provider}-conn', provider=provider,
                            api_key=encrypt_secret('k'), is_default=is_default)
    db.session.add(cfg)
    db.session.commit()
    return cfg


class _FakeClient:
    def __init__(self):
        self.upserted = []

    def find_record_id(self, zone_id, record_type, name, caa=None):
        return None

    def upsert(self, zone_id, spec, record_id=None):
        self.upserted.append((spec.record_type, spec.name, spec.content))
        return {'success': True, 'record_id': 'REC-1'}


def test_provider_without_client_guards_no_provider_by_name(app, client, admin_headers):
    _add_provider('route53')
    snap = DnsCutoverService.snapshot(
        'example.com',
        [{'name': 'example.com', 'type': 'A', 'content': '1.1.1.1'}],
        provider='route53', provider_zone_id='ZONE1')
    resp = client.post('/api/v1/dns-cutover/cutover', headers=admin_headers,
                       json={'snapshot_id': snap.id, 'target': '5.6.7.8'})
    assert resp.status_code == 501
    body = resp.get_json()
    assert body['code'] == 'NO_PROVIDER'
    assert body.get('provider') == 'route53'


def test_stubbed_second_provider_flows_through(app, client, admin_headers, monkeypatch):
    _add_provider('fakeprov')
    fake = _FakeClient()
    monkeypatch.setattr('app.services.dns.get_client', lambda cred: fake)
    snap = DnsCutoverService.snapshot(
        'example.com',
        [{'name': 'example.com', 'type': 'A', 'content': '1.1.1.1'}],
        provider='fakeprov', provider_zone_id='ZONE1')
    resp = client.post('/api/v1/dns-cutover/cutover', headers=admin_headers,
                       json={'snapshot_id': snap.id, 'target': '5.6.7.8'})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    assert resp.get_json()['success'] is True
    assert ('A', 'example.com', '5.6.7.8') in fake.upserted


def test_no_provider_connected_guards_cleanly(app, client, admin_headers):
    snap = DnsCutoverService.snapshot(
        'example.com',
        [{'name': 'example.com', 'type': 'A', 'content': '1.1.1.1'}],
        provider='cloudflare', provider_zone_id='ZONE1')
    resp = client.post('/api/v1/dns-cutover/cutover', headers=admin_headers,
                       json={'snapshot_id': snap.id, 'target': '5.6.7.8'})
    assert resp.status_code == 501
    assert resp.get_json()['code'] == 'NO_PROVIDER'
