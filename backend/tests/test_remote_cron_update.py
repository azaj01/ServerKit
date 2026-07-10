"""Remote cron edit — cron:update dispatch + capability gate (plan 28 #17).

Uses the registry-stub pattern (monkeypatch agent_registry) to prove:
- an agent without the cron.update capability is refused cleanly (no dispatch);
- update_job forwards ONLY the fields the caller provided so the agent leaves
  the rest unchanged;
- the returned Entry (with its new content-derived id) is passed through.
"""
from app.services import agent_registry as ar_mod
from app.services.remote_cron_service import RemoteCronService


def test_update_refused_without_capability(monkeypatch):
    monkeypatch.setattr(ar_mod.agent_registry, 'has_capability', lambda sid, cap: False)

    def _boom(*a, **k):  # send_command must never be called
        raise AssertionError('send_command should not be reached when uncapable')

    monkeypatch.setattr(ar_mod.agent_registry, 'send_command', _boom)

    res = RemoteCronService.update_job('srv-1', 'cron_abc', schedule='0 4 * * *')
    assert res['success'] is False
    assert res['code'] == 'CRON_UPDATE_UNSUPPORTED'


def test_update_sends_only_provided_fields(monkeypatch):
    monkeypatch.setattr(ar_mod.agent_registry, 'has_capability',
                        lambda sid, cap: cap == 'cron.update')
    captured = {}

    def fake_send(server_id, action, params=None, user_id=None, timeout=15.0):
        captured['action'] = action
        captured['params'] = params
        return {'success': True, 'data': {
            'id': 'cron_newid', 'schedule': '0 4 * * *',
            'command': '/usr/bin/backup', 'enabled': True,
        }}

    monkeypatch.setattr(ar_mod.agent_registry, 'send_command', fake_send)

    res = RemoteCronService.update_job('srv-1', 'cron_oldid', schedule='0 4 * * *')

    assert captured['action'] == 'cron:update'
    # command and name were not provided -> not forwarded (agent keeps them).
    assert captured['params'] == {'id': 'cron_oldid', 'schedule': '0 4 * * *'}
    assert res['success'] is True
    assert res['data']['id'] == 'cron_newid'


def test_update_forwards_all_fields_when_given(monkeypatch):
    monkeypatch.setattr(ar_mod.agent_registry, 'has_capability', lambda sid, cap: True)
    captured = {}

    def fake_send(server_id, action, params=None, user_id=None, timeout=15.0):
        captured['params'] = params
        return {'success': True, 'data': {'id': 'cron_x'}}

    monkeypatch.setattr(ar_mod.agent_registry, 'send_command', fake_send)

    RemoteCronService.update_job(
        'srv-1', 'cron_oldid',
        schedule='*/5 * * * *', command='/opt/run', name='five-min')

    assert captured['params'] == {
        'id': 'cron_oldid',
        'schedule': '*/5 * * * *',
        'command': '/opt/run',
        'name': 'five-min',
    }
