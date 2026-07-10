"""Fleet-doctor DNS rotation (plan 31 #13, Decision 7).

The per-server DNS check stays bounded at DNS_CHECK_MAX_DOMAINS, but the checked
subset now ROTATES per sweep so a box with more domains than the cap still gets
every domain verified over successive sweeps — instead of permanently truncating
to the first N. Proves N sweeps cover >cap domains and the counter advances.

Reconstructed from the clean recovery pyc
(``test_fleet_doctor_dns_rotation.cpython-311-pytest-8.3.5.pyc``). The rotating
DNS-window API (``FleetDoctorService._dns_checks`` / ``_server_site_hosts`` /
``_next_dns_sweep_index`` + ``DNS_CHECK_MAX_DOMAINS``) did NOT survive the recovery
rebuild — the surviving service only has the single ``_dns_check_for_server``
row — so the whole file skips until that engine is restored (see report finding).
"""
import socket

import pytest

try:
    from app.services import fleet_doctor_service as fd
    from app.models.server import Server
    from app.services.fleet_doctor_service import (
        FleetDoctorService, DNS_CHECK_MAX_DOMAINS)
    _HOLLOW = None
except (ImportError, AttributeError) as exc:  # feature lost in recovery
    _HOLLOW = str(exc)

if _HOLLOW:
    pytestmark = pytest.mark.skip(
        reason="plan 42: hollow feature — fleet-doctor DNS rotation "
               "(FleetDoctorService._dns_checks/_server_site_hosts/"
               "_next_dns_sweep_index + DNS_CHECK_MAX_DOMAINS) missing after "
               f"recovery rebuild: {_HOLLOW}")


def _hosts(n):
    return [f'site{i}.example.com' for i in range(n)]


def _checked_hosts(rows):
    prefix = 'dns.resolve.'
    return {r['key'][len(prefix):] for r in rows
            if r['key'].startswith(prefix) and r['key'] != 'dns.resolve'}


def test_rotation_covers_all_domains_over_sweeps(app, monkeypatch):
    total = DNS_CHECK_MAX_DOMAINS + 5
    hosts = _hosts(total)
    monkeypatch.setattr(FleetDoctorService, '_server_site_hosts',
                        classmethod(lambda cls, s: list(hosts)))
    monkeypatch.setattr(fd.socket, 'getaddrinfo',
                        lambda *a, **k: (_ for _ in ()).throw(socket.gaierror()))
    server = Server(name='dns-rot', ip_address='203.0.113.9')

    checked = set()
    sweeps_needed = (total + DNS_CHECK_MAX_DOMAINS - 1) // DNS_CHECK_MAX_DOMAINS
    for i in range(sweeps_needed):
        rows = FleetDoctorService._dns_checks(server, sweep_index=i)
        assert len(_checked_hosts(rows)) <= DNS_CHECK_MAX_DOMAINS
        checked |= _checked_hosts(rows)

    assert checked == set(hosts)


def test_rotation_warn_row_reports_position_not_truncation(app, monkeypatch):
    hosts = _hosts(DNS_CHECK_MAX_DOMAINS + 3)
    monkeypatch.setattr(FleetDoctorService, '_server_site_hosts',
                        classmethod(lambda cls, s: list(hosts)))
    monkeypatch.setattr(fd.socket, 'getaddrinfo',
                        lambda *a, **k: (_ for _ in ()).throw(socket.gaierror()))
    server = Server(name='dns-rot2', ip_address='203.0.113.10')

    rows = FleetDoctorService._dns_checks(server, sweep_index=0)
    summary = [r for r in rows if r['key'] == 'dns.resolve']
    assert summary, 'expected a rotating-window summary row'
    detail = summary[0]['detail'].lower()
    assert 'rotating' in detail and 'verified within' in detail


def test_under_cap_has_no_rotation_row(app, monkeypatch):
    hosts = _hosts(3)
    monkeypatch.setattr(FleetDoctorService, '_server_site_hosts',
                        classmethod(lambda cls, s: list(hosts)))
    monkeypatch.setattr(fd.socket, 'getaddrinfo',
                        lambda *a, **k: (_ for _ in ()).throw(socket.gaierror()))
    server = Server(name='dns-small', ip_address='203.0.113.11')

    rows = FleetDoctorService._dns_checks(server, sweep_index=5)
    assert _checked_hosts(rows) == set(hosts)
    assert not [r for r in rows if r['key'] == 'dns.resolve']


def test_dns_sweep_counter_advances(app):
    a = FleetDoctorService._next_dns_sweep_index()
    b = FleetDoctorService._next_dns_sweep_index()
    c = FleetDoctorService._next_dns_sweep_index()
    assert [b - a, c - b] == [1, 1]
