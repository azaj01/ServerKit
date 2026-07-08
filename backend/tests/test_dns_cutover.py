"""Proving tests for the reversible DNS cutover SERVICE (plan 31 #1/#2/#3/#4).

Covers: TTL guidance, server-sourced snapshots with name filtering, dry-run vs
real cutover, created-record tracking, world-restoring revert (delete created +
re-apply captured), verify annotation, and the provider-registry 501.

The provider client is stubbed (a fake Cloudflare-shaped client) so nothing
touches the network; the ownership ledger writes go through the real
``DnsOwnershipService`` against the in-memory test DB.
"""
import pytest

from app import db
from app.models.dns_cutover_snapshot import DnsCutoverSnapshot
from app.services.dns_cutover_service import DnsCutoverService, DnsCutoverError


class FakeConfig:
    id = 1
    provider = 'cloudflare'
    name = 'test-cf'


class FakeClient:
    """A minimal Cloudflare-shaped client backed by an in-memory record list."""

    def __init__(self, records=None):
        self.records = [dict(r) for r in (records or [])]
        self.upserts = []
        self.deletes = []
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
        self.upserts.append({'type': spec.record_type, 'name': spec.name,
                             'content': spec.content, 'record_id': record_id})
        self.records = [r for r in self.records
                        if not (r['type'] == spec.record_type and r['name'] == spec.name)]
        self.records.append({'id': rid, 'type': spec.record_type, 'name': spec.name,
                             'content': spec.content, 'ttl': spec.ttl,
                             'proxied': spec.proxied, 'priority': spec.priority})
        return {'success': True, 'record_id': rid}

    def delete(self, zone_id, record_id=None, record_type=None, name=None):
        self.deletes.append({'record_id': record_id, 'type': record_type, 'name': name})
        self.records = [r for r in self.records if r['id'] != record_id]
        return {'success': True}


def _install_client(monkeypatch, client, config=None):
    config = config or FakeConfig()
    monkeypatch.setattr(
        DnsCutoverService, '_resolve_dns_client',
        lambda provider=None, provider_zone_id=None: (client, config))
    return config


DOMAIN = 'site.example.com'
ZONE = 'zone123'


# --------------------------------------------------------------------------- #
# TTL guidance
# --------------------------------------------------------------------------- #

def test_ttl_guidance_flags_records_needing_lowering(app):
    guidance = DnsCutoverService.ttl_guidance([
        {'name': DOMAIN, 'type': 'A', 'ttl': 3600},
        {'name': DOMAIN, 'type': 'MX', 'ttl': 120},
    ])
    assert guidance['recommended_ttl'] == 300
    assert guidance['current_max_ttl'] == 3600
    assert guidance['propagation_wait_seconds'] == 3600
    flags = {r['type']: r['needs_lowering'] for r in guidance['records']}
    assert flags['A'] is True and flags['MX'] is False


# --------------------------------------------------------------------------- #
# server-sourced snapshots (Decision 2)
# --------------------------------------------------------------------------- #

def test_snapshot_reads_live_records_and_filters_by_name(app, monkeypatch):
    client = FakeClient([
        {'id': 'a1', 'type': 'A', 'name': DOMAIN, 'content': '203.0.113.1',
         'ttl': 3600, 'proxied': False, 'priority': None},
        {'id': 'w1', 'type': 'A', 'name': f'www.{DOMAIN}', 'content': '203.0.113.1',
         'ttl': 3600, 'proxied': False, 'priority': None},
    ])
    _install_client(monkeypatch, client)

    snap = DnsCutoverService.create_snapshot(DOMAIN, ZONE, provider='cloudflare',
                                             names=[DOMAIN])
    assert snap.status == 'captured'
    assert snap.provider == 'cloudflare'
    records = snap.get_records()
    assert len(records) == 1 and records[0]['name'] == DOMAIN  # www filtered out


def test_snapshot_requires_zone(app, monkeypatch):
    _install_client(monkeypatch, FakeClient())
    with pytest.raises(DnsCutoverError):
        DnsCutoverService.create_snapshot(DOMAIN, None)


# --------------------------------------------------------------------------- #
# cutover (Decision 1) — dry-run vs real, created-record tracking
# --------------------------------------------------------------------------- #

def test_cutover_dry_run_returns_ops_without_writing(app, monkeypatch):
    client = FakeClient()
    _install_client(monkeypatch, client)
    snap = DnsCutoverSnapshot(domain=DOMAIN, provider='cloudflare',
                              provider_zone_id=ZONE, status='captured')
    snap.set_records([])
    db.session.add(snap)
    db.session.commit()

    result = DnsCutoverService.cutover(snap, target='198.51.100.9', dry_run=True)
    assert result['dry_run'] is True
    assert result['ops'][0] == {'action': 'create', 'type': 'A', 'name': DOMAIN,
                                'old': None, 'new': '198.51.100.9'}
    assert client.upserts == []           # nothing written
    assert snap.status == 'captured'      # snapshot untouched


def test_cutover_creates_and_tracks_created_records(app, monkeypatch):
    client = FakeClient()                  # zone has no A record yet
    _install_client(monkeypatch, client)
    snap = DnsCutoverSnapshot(domain=DOMAIN, provider='cloudflare',
                              provider_zone_id=ZONE, status='captured')
    snap.set_records([])
    db.session.add(snap)
    db.session.commit()

    result = DnsCutoverService.cutover(snap, target='198.51.100.9')
    assert result['success'] is True
    assert snap.status == 'cutover'
    created = snap.get_created_records()
    assert len(created) == 1 and created[0]['type'] == 'A'
    assert created[0]['content'] == '198.51.100.9'
    assert len(client.upserts) == 1


# --------------------------------------------------------------------------- #
# revert (Decision 3) — world-restoring
# --------------------------------------------------------------------------- #

def test_revert_of_create_only_cutover_deletes_and_reverts_to_empty(app, monkeypatch):
    client = FakeClient()
    _install_client(monkeypatch, client)
    snap = DnsCutoverSnapshot(domain=DOMAIN, provider='cloudflare',
                              provider_zone_id=ZONE, status='captured')
    snap.set_records([])
    db.session.add(snap)
    db.session.commit()

    DnsCutoverService.cutover(snap, target='198.51.100.9')
    assert client.records  # the created A exists on the provider

    result = DnsCutoverService.revert(snap)
    assert result['deleted_count'] == 1
    assert snap.status == 'reverted_with_deletions'
    assert result['deletions'][0]['deleted'] is True
    assert client.records == []            # world restored to empty


def test_revert_reapplies_captured_values_byte_for_byte(app, monkeypatch):
    # Zone already has the operator's A record → cutover UPDATES it (no create).
    original = {'id': 'a1', 'type': 'A', 'name': DOMAIN, 'content': '203.0.113.1',
                'ttl': 3600, 'proxied': False, 'priority': None}
    client = FakeClient([dict(original)])
    _install_client(monkeypatch, client)
    snap = DnsCutoverSnapshot(domain=DOMAIN, provider='cloudflare',
                              provider_zone_id=ZONE, status='captured')
    snap.set_records([dict(original)])
    db.session.add(snap)
    db.session.commit()

    DnsCutoverService.cutover(snap, target='198.51.100.9')
    assert client.records[0]['content'] == '198.51.100.9'  # flipped
    assert snap.get_created_records() == []                # nothing created

    result = DnsCutoverService.revert(snap)
    assert result['deleted_count'] == 0
    assert snap.status == 'reverted'
    assert client.records[0]['content'] == '203.0.113.1'   # old value restored


# --------------------------------------------------------------------------- #
# verify (plan 31 #1)
# --------------------------------------------------------------------------- #

def test_verify_annotates_matches_expected(app, monkeypatch):
    from app.services.dns_zone_service import DNSZoneService
    monkeypatch.setattr(DNSZoneService, 'check_propagation', staticmethod(
        lambda domain, record_type='A': [
            {'nameserver': 'Google', 'result': ['198.51.100.9'], 'propagated': True},
            {'nameserver': 'Cloudflare', 'result': ['198.51.100.9'], 'propagated': True},
        ]))
    res = DnsCutoverService.verify(DOMAIN, record_type='A', expected='198.51.100.9')
    assert res['propagated'] is True
    assert res['matches_expected'] is True
    assert res['answered_count'] == 2

    res2 = DnsCutoverService.verify(DOMAIN, record_type='A', expected='203.0.113.1')
    assert res2['matches_expected'] is False


# --------------------------------------------------------------------------- #
# provider registry resolution (Decision 4)
# --------------------------------------------------------------------------- #

def test_resolve_client_no_provider_is_clean_501(app):
    with pytest.raises(DnsCutoverError) as ei:
        DnsCutoverService._resolve_dns_client('cloudflare', ZONE)
    assert ei.value.status_code == 501 and ei.value.code == 'NO_PROVIDER'


def test_resolve_client_unsupported_provider_is_clean_501(app):
    from app.models.email import DNSProviderConfig
    db.session.add(DNSProviderConfig(name='r53', provider='route53',
                                     api_key='x', is_default=True))
    db.session.commit()
    with pytest.raises(DnsCutoverError) as ei:
        DnsCutoverService._resolve_dns_client('route53', ZONE)
    assert ei.value.status_code == 501 and ei.value.code == 'NO_PROVIDER'
    assert 'route53' in ei.value.message
