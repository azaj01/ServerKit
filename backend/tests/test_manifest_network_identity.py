"""Proving tests for Phase 5 of the Appliance tier (plan 35):
the fromServer binder, the ${SERVER_PUBLIC_IP} magic var, and cross-app
name resolution over the shared serverkit network."""

import pytest
import yaml

import app.models.application_manifest  # noqa: F401
from app.services.manifest_spec_service import ManifestSpecService, ManifestError
from app.services.manifest_apply_service import ManifestApplyService
from app.services.env_reference_service import EnvReferenceResolver
from app.services.template_service import TemplateService
from app.services.docker_service import DockerService


FROMSERVER_MANIFEST = {
    'version': 1,
    'services': [{
        'name': 'bridge', 'type': 'docker',
        'envVars': [{'key': 'ADVERTISE_IP', 'fromServer': {'property': 'publicIp'}}],
    }],
}


@pytest.fixture
def project(app):
    from app import db
    from app.models import Project, Environment
    from app.services.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace()
    proj = Project(workspace_id=ws.id, name='Net', slug='net')
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


# -- normalizer -------------------------------------------------------------

def test_fromserver_normalizes():
    n = ManifestSpecService.normalize(FROMSERVER_MANIFEST)
    var = n['services'][0]['env_vars'][0]
    assert var['source'] == 'server'
    assert var['server_ref'] == {'property': 'publicIp'}


def test_fromserver_conflicts_with_value():
    with pytest.raises(ManifestError):
        ManifestSpecService.normalize({
            'version': 1,
            'services': [{'name': 'x', 'type': 'docker', 'envVars': [
                {'key': 'IP', 'value': '1.2.3.4', 'fromServer': {'property': 'publicIp'}}]}],
        })


# -- resolver ---------------------------------------------------------------

def test_resolver_binds_panel_public_ip(monkeypatch, project, owner):
    from app import db
    from app.models import Application
    from app.services.site_domain_service import SiteDomainService
    monkeypatch.setattr(SiteDomainService, 'server_ip', classmethod(lambda cls: '203.0.113.9'))
    app_row = Application(name='bridge', app_type='docker', user_id=owner.id,
                          project_id=project.id, status='stopped')
    db.session.add(app_row)
    db.session.commit()
    value, err = EnvReferenceResolver.resolve(app_row, {'kind': 'server', 'property': 'publicIp'})
    assert err is None
    assert value == '203.0.113.9'


def test_fromservice_host_resolves_to_sibling_name(project, owner):
    from app import db
    from app.models import Application
    for nm in ('api', 'web'):
        db.session.add(Application(name=nm, app_type='docker', user_id=owner.id,
                                   project_id=project.id, status='stopped'))
    db.session.commit()
    web = Application.query.filter_by(project_id=project.id, name='web').first()
    value, err = EnvReferenceResolver.resolve(
        web, {'kind': 'service', 'service': 'api', 'property': 'host'})
    assert err is None
    assert value == 'api'  # resolves by container name on the shared network


# -- apply ------------------------------------------------------------------

def test_apply_binds_fromserver(monkeypatch, project, owner):
    from app.models import Application
    from app.services.env_service import EnvService
    from app.services.site_domain_service import SiteDomainService
    monkeypatch.setattr(SiteDomainService, 'server_ip', classmethod(lambda cls: '198.51.100.4'))

    n = ManifestSpecService.normalize(FROMSERVER_MANIFEST)
    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    assert result['success'] is True, result

    bridge = Application.query.filter_by(project_id=project.id, name='bridge').first()
    env = EnvService.get_effective_env(bridge.id)
    assert env.get('ADVERTISE_IP') == '198.51.100.4'

    plan2 = ManifestApplyService.plan(project, n)
    assert plan2['step_count'] == 0, plan2['summary']


def test_fromserver_no_ip_blocks(monkeypatch, project):
    from app.services.site_domain_service import SiteDomainService
    monkeypatch.setattr(SiteDomainService, 'server_ip', classmethod(lambda cls: None))
    n = ManifestSpecService.normalize(FROMSERVER_MANIFEST)
    plan = ManifestApplyService.plan(project, n)
    assert 'fromserver_no_ip' in {b['kind'] for b in plan['blockers']}


# -- magic var --------------------------------------------------------------

def test_server_public_ip_magic_var():
    substituted, generated = TemplateService.resolve_magic_variables(
        'ip=${SERVER_PUBLIC_IP}', {'server_public_ip': '192.0.2.55'})
    assert substituted == 'ip=192.0.2.55'
    assert generated['SERVER_PUBLIC_IP'] == '192.0.2.55'


# -- shared network ---------------------------------------------------------

def test_create_docker_app_attaches_shared_network(tmp_path, monkeypatch):
    monkeypatch.setattr(DockerService, 'ensure_network',
                        staticmethod(lambda name, driver='bridge': {'success': True}))
    res = DockerService.create_docker_app(
        str(tmp_path), 'web', 'img:latest', networks=['serverkit'])
    assert res['success'], res
    with open(res['compose_file']) as fh:
        compose = yaml.safe_load(fh)
    assert compose['services']['web']['networks'] == ['serverkit']
    assert compose['networks'] == {'serverkit': {'external': True}}
