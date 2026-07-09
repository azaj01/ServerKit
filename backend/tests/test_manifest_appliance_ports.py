"""Proving tests for Phase 1 of the Appliance tier (plan 35):
typed L4 ports + the plan-time blockers rail."""

import json

import pytest

import app.models.application_manifest  # noqa: F401
from app.services.manifest_spec_service import ManifestSpecService, ManifestError
from app.services.manifest_apply_service import ManifestApplyService
from app.services.app_port_service import AppPortService
from app.services.buildpack_service import BuildpackService


PORTS_MANIFEST = {
    'version': 1,
    'services': [{
        'name': 'media', 'type': 'docker',
        'ports': [
            {'port': 10000, 'protocol': 'udp', 'expose': 'public'},
            {'port': 8443, 'containerPort': 443, 'expose': 'local'},
        ],
    }],
}


@pytest.fixture
def project(app):
    from app import db
    from app.models import Project, Environment
    from app.services.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace()
    proj = Project(workspace_id=ws.id, name='Media', slug='media')
    db.session.add(proj)
    db.session.commit()
    env = Environment(project_id=proj.id, name='Production', slug='production', is_default=True)
    db.session.add(env)
    db.session.commit()
    return proj


@pytest.fixture
def owner(app):
    from app import db
    from app.models import User
    user = User.query.filter_by(username='testadmin').first()
    if not user:
        user = User(username='testadmin', email='admin@test.local', role='admin')
        if hasattr(user, 'set_password'):
            user.set_password('admin')
        db.session.add(user)
        db.session.commit()
    return user


@pytest.fixture(autouse=True)
def _stub_appliance(monkeypatch):
    """Keep the panel host clear + firewall out of the loop by default; each
    blocker test overrides the specific seam it exercises."""
    monkeypatch.setattr(ManifestApplyService, '_port_bound', lambda port: False)
    monkeypatch.setattr(ManifestApplyService, '_firewall_state', lambda: 'active')
    monkeypatch.setattr(AppPortService, 'open_firewall',
                        classmethod(lambda cls, ports: []))
    monkeypatch.setattr(AppPortService, 'close_firewall',
                        classmethod(lambda cls, ports: []))


# -- normalizer -------------------------------------------------------------

def test_ports_normalize_with_defaults():
    n = ManifestSpecService.normalize(PORTS_MANIFEST)
    ports = n['services'][0]['ports']
    assert len(ports) == 2
    udp = ports[0]
    assert udp == {'host_port': 10000, 'container_port': 10000,
                   'protocol': 'udp', 'expose': 'public'}
    local = ports[1]
    assert local == {'host_port': 8443, 'container_port': 443,
                     'protocol': 'tcp', 'expose': 'local'}
    # legacy scalar port is untouched / independent
    assert n['services'][0]['port'] is None


def test_duplicate_port_rejected():
    with pytest.raises(ManifestError) as exc:
        ManifestSpecService.normalize({
            'version': 1,
            'services': [{'name': 'x', 'type': 'docker',
                          'ports': [{'port': 53, 'protocol': 'udp'},
                                    {'port': 53, 'protocol': 'udp'}]}],
        })
    assert any('duplicate' in e for e in exc.value.errors)


def test_bad_protocol_rejected():
    with pytest.raises(ManifestError):
        ManifestSpecService.normalize({
            'version': 1,
            'services': [{'name': 'x', 'type': 'docker',
                          'ports': [{'port': 53, 'protocol': 'sctp'}]}],
        })


# -- compose emission -------------------------------------------------------

def test_compose_ports_emission():
    n = ManifestSpecService.normalize(PORTS_MANIFEST)
    specs = AppPortService.compose_ports(n['services'][0]['ports'])
    assert specs == ['0.0.0.0:10000:10000/udp', '127.0.0.1:8443:443']


def test_buildpack_extra_ports_emitted():
    compose = BuildpackService.generate_compose(
        {'port': 3000}, 'app', extra_ports=['0.0.0.0:10000:10000/udp'])
    assert '"3000:3000"' in compose            # the app's own HTTP port
    assert '"0.0.0.0:10000:10000/udp"' in compose  # the raw L4 publish


# -- plan / apply -----------------------------------------------------------

def test_plan_emits_open_port_without_blockers(project):
    n = ManifestSpecService.normalize(PORTS_MANIFEST)
    plan = ManifestApplyService.plan(project, n)
    assert 'open_port' in [s['type'] for s in plan['steps']]
    assert plan['blockers'] == []


def test_apply_persists_ports_and_is_idempotent(project, owner):
    from app.models import Application
    n = ManifestSpecService.normalize(PORTS_MANIFEST)
    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    assert result['success'] is True, result

    media = Application.query.filter_by(project_id=project.id, name='media').first()
    assert media is not None
    stored = json.loads(media.ports)
    assert len(stored) == 2
    assert {p['host_port'] for p in stored} == {10000, 8443}

    # second plan is empty (idempotent)
    plan2 = ManifestApplyService.plan(project, n)
    assert plan2['step_count'] == 0, plan2['summary']


# -- blockers ---------------------------------------------------------------

def test_port_conflict_blocks_apply(project, owner, monkeypatch):
    monkeypatch.setattr(ManifestApplyService, '_port_bound',
                        lambda port: port == 10000)
    n = ManifestSpecService.normalize(PORTS_MANIFEST)
    plan = ManifestApplyService.plan(project, n)
    kinds = {b['kind'] for b in plan['blockers']}
    assert 'port_conflict' in kinds
    # apply refuses, nothing executed
    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    assert result['success'] is False
    assert result['refused'] is True
    assert result['applied'] == 0
    from app.models import Application
    assert Application.query.filter_by(project_id=project.id, name='media').first() is None


def test_remote_target_blocks(project):
    manifest = json.loads(json.dumps(PORTS_MANIFEST))
    manifest['services'][0]['server'] = 'frankfurt-box'
    n = ManifestSpecService.normalize(manifest)
    plan = ManifestApplyService.plan(project, n)
    kinds = {b['kind'] for b in plan['blockers']}
    assert 'remote_target' in kinds
    msg = next(b['message'] for b in plan['blockers'] if b['kind'] == 'remote_target')
    assert 'frankfurt-box' in msg


def test_firewall_undetected_blocks(project, monkeypatch):
    monkeypatch.setattr(ManifestApplyService, '_firewall_state', lambda: 'undetected')
    n = ManifestSpecService.normalize(PORTS_MANIFEST)
    plan = ManifestApplyService.plan(project, n)
    assert 'firewall_undetected' in {b['kind'] for b in plan['blockers']}


def test_firewall_none_is_advisory_not_blocking(project, monkeypatch):
    monkeypatch.setattr(ManifestApplyService, '_firewall_state', lambda: 'none')
    n = ManifestSpecService.normalize(PORTS_MANIFEST)
    plan = ManifestApplyService.plan(project, n)
    assert plan['blockers'] == []
    assert 'firewall_none' in {i.get('kind') for i in plan['issues']}
