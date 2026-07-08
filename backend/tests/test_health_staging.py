"""Prove the /api/v1/system/health `staging` flag (plan 37).

The staging testbed runs the panel with SERVERKIT_STAGING set so the verify
step (and the UI banner) can tell a staging instance from the live panel.
"""
import pytest

from app import create_app


@pytest.fixture
def client():
    app = create_app('testing')
    with app.test_client() as c:
        yield c


def test_health_staging_false_by_default(client, monkeypatch):
    monkeypatch.delenv('SERVERKIT_STAGING', raising=False)
    resp = client.get('/api/v1/system/health')
    assert resp.status_code == 200
    assert resp.get_json().get('staging') is False


def test_health_staging_true_when_env_set(client, monkeypatch):
    monkeypatch.setenv('SERVERKIT_STAGING', '1')
    resp = client.get('/api/v1/system/health')
    assert resp.status_code == 200
    assert resp.get_json().get('staging') is True


@pytest.mark.parametrize('val,expected', [
    ('1', True), ('true', True), ('YES', True), ('on', True),
    ('0', False), ('', False), ('no', False), ('off', False),
])
def test_health_staging_truthiness(client, monkeypatch, val, expected):
    monkeypatch.setenv('SERVERKIT_STAGING', val)
    resp = client.get('/api/v1/system/health')
    assert resp.get_json().get('staging') is expected
