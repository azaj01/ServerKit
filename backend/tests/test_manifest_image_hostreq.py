"""Proving tests for Phase 4 of the Appliance tier (plan 35):
BYO `image`/`registry` + `hostRequirements` (privileged/capAdd/sysctls/devices/
kernelModules)."""

import pytest
import yaml

import app.models.application_manifest  # noqa: F401
from app.services.manifest_spec_service import ManifestSpecService
from app.services.manifest_apply_service import ManifestApplyService
from app.services.unit_compose_service import UnitComposeService
from app.services.docker_service import DockerService


IMAGE_MANIFEST = {
    'version': 1,
    'services': [{
        'name': 'vpn', 'type': 'docker',
        'image': 'ghcr.io/acme/vpn:1.2',
        'registry': 'acme-ghcr',
        'hostRequirements': {
            'capAdd': ['NET_ADMIN'],
            'sysctls': {'net.ipv4.ip_forward': '1'},
            'devices': ['/dev/net/tun'],
            'kernelModules': ['wireguard'],
        },
    }],
}


@pytest.fixture
def project(app):
    from app import db
    from app.models import Project, Environment
    from app.services.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace()
    proj = Project(workspace_id=ws.id, name='VPN', slug='vpn')
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


def _registry(name, provider='generic', secret='enc'):
    from app import db
    from app.models.container_registry import ContainerRegistry
    reg = ContainerRegistry(name=name, provider=provider, secret_encrypted=secret)
    db.session.add(reg)
    db.session.commit()
    return reg


# -- normalizer -------------------------------------------------------------

def test_image_and_hostreq_normalize():
    n = ManifestSpecService.normalize(IMAGE_MANIFEST)
    svc = n['services'][0]
    assert svc['image'] == 'ghcr.io/acme/vpn:1.2'
    assert svc['registry'] == 'acme-ghcr'
    hr = svc['host_requirements']
    assert hr['cap_add'] == ['NET_ADMIN']
    assert hr['sysctls'] == {'net.ipv4.ip_forward': '1'}
    assert hr['devices'] == ['/dev/net/tun']
    assert hr['kernel_modules'] == ['wireguard']


# -- generators -------------------------------------------------------------

def test_create_docker_app_emits_host_requirements(tmp_path):
    res = DockerService.create_docker_app(
        str(tmp_path), 'vpn', 'img:latest',
        host_requirements={'privileged': True, 'cap_add': ['NET_ADMIN'],
                           'sysctls': {'net.ipv4.ip_forward': '1'},
                           'devices': ['/dev/net/tun']})
    assert res['success'], res
    with open(res['compose_file']) as fh:
        compose = yaml.safe_load(fh)
    svc = compose['services']['vpn']
    assert svc['privileged'] is True
    assert svc['cap_add'] == ['NET_ADMIN']
    assert svc['sysctls'] == {'net.ipv4.ip_forward': '1'}
    assert svc['devices'] == ['/dev/net/tun']


def test_unit_compose_emits_host_requirements():
    containers = [{
        'name': 'bridge', 'image': 'img', 'ports': [], 'disks': [], 'env_vars': [],
        'bootstrap': None, 'health_check': None, 'depends_on': [],
        'host_requirements': {'privileged': True, 'cap_add': ['NET_ADMIN'],
                              'sysctls': {'k': 'v'}, 'devices': ['/dev/net/tun'],
                              'kernel_modules': []},
    }]
    compose = UnitComposeService.render('u', containers)
    svc = compose['services']['bridge']
    assert svc['privileged'] is True
    assert svc['cap_add'] == ['NET_ADMIN']
    assert svc['devices'] == ['/dev/net/tun']


# -- apply / stamping -------------------------------------------------------

def test_apply_stamps_image_and_registry(project, owner):
    from app.models import Application
    reg = _registry('acme-ghcr')
    n = ManifestSpecService.normalize(IMAGE_MANIFEST)
    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    assert result['success'] is True, result
    app_row = Application.query.filter_by(project_id=project.id, name='vpn').first()
    assert app_row.docker_image == 'ghcr.io/acme/vpn:1.2'
    assert app_row.registry_id == reg.id


# -- blockers ---------------------------------------------------------------

def test_unknown_registry_blocks(project):
    n = ManifestSpecService.normalize(IMAGE_MANIFEST)  # 'acme-ghcr' not created
    plan = ManifestApplyService.plan(project, n)
    kinds = {b['kind'] for b in plan['blockers']}
    assert 'registry_credential' in kinds


def test_registry_without_credential_blocks(project):
    _registry('acme-ghcr', secret=None)
    n = ManifestSpecService.normalize(IMAGE_MANIFEST)
    plan = ManifestApplyService.plan(project, n)
    assert 'registry_credential' in {b['kind'] for b in plan['blockers']}


def test_ecr_registry_accepted_without_secret(project):
    _registry('acme-ghcr', provider='ecr', secret=None)
    n = ManifestSpecService.normalize(IMAGE_MANIFEST)
    plan = ManifestApplyService.plan(project, n)
    assert 'registry_credential' not in {b['kind'] for b in plan['blockers']}


# -- advisory issues --------------------------------------------------------

def test_host_requirements_listed_in_plain_words(project, monkeypatch):
    monkeypatch.setattr(ManifestApplyService, '_kernel_module_present', lambda mod: False)
    _registry('acme-ghcr')
    n = ManifestSpecService.normalize(IMAGE_MANIFEST)
    plan = ManifestApplyService.plan(project, n)
    hr_msgs = [i['message'] for i in plan['issues'] if i.get('kind') == 'host_requirement']
    assert any('capability NET_ADMIN' in m for m in hr_msgs)
    assert any('sysctl net.ipv4.ip_forward=1' in m for m in hr_msgs)
    assert any('device /dev/net/tun' in m for m in hr_msgs)
    # kernel module advisory (not a blocker)
    km = [i['message'] for i in plan['issues'] if i.get('kind') == 'kernel_module']
    assert any('wireguard' in m for m in km)
    assert plan['blockers'] == []
