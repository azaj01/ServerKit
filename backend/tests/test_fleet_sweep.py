"""Bounded fan-out primitive — fleet_sweep (Fleet Parity Sweep, plan 26, Decision 4).

Proves the one sweep primitive every fleet operation reuses: it addresses servers
by id (de-duped), passes the per-agent timeout down to each composer, returns an
empty map for an empty server list, and — crucially — turns a hung agent into a
partial ``timeout`` row instead of blocking the caller past its wall-clock budget.

Reconstructed from the fragmented recovery pyc
(``test_fleet_sweep.cpython-311-pytest-8.3.5.pyc``) + the surviving
``app.services.fleet_sweep`` implementation.
"""
import time

from app.services.fleet_sweep import fleet_sweep


def test_empty_server_list_is_empty(app):
    result = fleet_sweep(lambda sid, t: {'status': 'ok'}, [])
    assert result == {}


def test_server_objects_addressed_by_id(app):
    class FakeServer:
        def __init__(self, id):
            self.id = id

    servers = [FakeServer('srv-1'), FakeServer('srv-2')]
    result = fleet_sweep(lambda sid, t: {'status': 'ok', 'sid': sid}, servers)
    assert set(result.keys()) == {'srv-1', 'srv-2'}


def test_duplicate_servers_deduped(app):
    calls = []

    def compose(sid, t):
        calls.append(sid)
        return {'status': 'ok'}

    result = fleet_sweep(compose, ['a', 'a', 'b'])
    assert sorted(result.keys()) == ['a', 'b']
    assert sorted(calls) == ['a', 'b']


def test_composer_receives_per_agent_timeout(app):
    seen = []

    def compose(sid, t):
        seen.append(t)
        return {'status': 'ok'}

    fleet_sweep(compose, ['x'], per_agent_timeout=7.5)
    assert seen == [7.5]


def test_budget_turns_hung_agent_into_timeout_row(app):
    def compose(sid, t):
        if sid == 'slow':
            time.sleep(3)
        return {'status': 'ok'}

    start = time.monotonic()
    result = fleet_sweep(compose, ['fast1', 'fast2', 'slow'],
                         pool=3, per_agent_timeout=10, budget=0.5)
    elapsed = time.monotonic() - start
    assert elapsed < 3, f'sweep blocked too long: {elapsed:.1f}'
    assert result['slow']['status'] == 'timeout'
