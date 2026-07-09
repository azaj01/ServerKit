"""Proving tests for Phase 3 of the Appliance tier (plan 35):
the multi-container UNIT — schema, dependsOn validation/cycles, the
UnitComposeService generator, and unit-scoped apply."""

import json

import pytest

import app.models.application_manifest  # noqa: F401
from app.services.manifest_spec_service import ManifestSpecService, ManifestError
from app.services.manifest_apply_service import ManifestApplyService
from app.services.unit_compose_service import UnitComposeService
from app.services.app_port_service import AppPortService
from app.services.bootstrap_service import BootstrapService


UNIT_MANIFEST = {
    'version': 1,
    'services': [{
        'name': 'meet', 'type': 'docker',
        'containers': {
            'web': {
                'image': 'jitsi/web:stable',
                'ports': [{'port': 8443, 'containerPort': 443, 'expose': 'local'}],
                'dependsOn': [{'service': 'prosody', 'condition': 'healthy'}],
                'healthCheck': {'httpPath': '/', 'interval': '30s', 'retries': 5},
                'disks': [{'name': 'web-config', 'mountPath': '/config', 'size': '1GB',
                           'backup': {'schedule': 'daily', 'retain': 7}}],
            },
            'prosody': {
                'image': 'jitsi/prosody:stable',
                'bootstrap': {'command': '/opt/gen.sh', 'timeoutSeconds': 120},
                'healthCheck': {'cmd': 'prosodyctl status', 'interval': '15s', 'retries': 5},
            },
            'jvb': {
                'image': 'jitsi/jvb:stable',
                'ports': [{'port': 10000, 'protocol': 'udp', 'expose': 'public'}],
                'dependsOn': [{'service': 'prosody', 'condition': 'healthy'}],
            },
        },
    }],
}


@pytest.fixture
def project(app):
    from app import db
    from app.models import Project, Environment
    from app.services.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace()
    proj = Project(workspace_id=ws.id, name='Meet', slug='meet')
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
def _stub(monkeypatch):
    from app.services.docker_service import DockerService
    monkeypatch.setattr(DockerService, 'create_volume',
                        classmethod(lambda cls, name, driver='local': {'success': True}))
    monkeypatch.setattr(ManifestApplyService, '_port_bound', lambda port: False)
    monkeypatch.setattr(ManifestApplyService, '_firewall_state', lambda: 'active')
    monkeypatch.setattr(AppPortService, 'open_firewall', classmethod(lambda cls, ports: []))


@pytest.fixture
def runner_calls():
    calls = []

    def run(app, service, command, timeout):
        calls.append({'service': service, 'command': command})
        return {'success': True, 'output': 'ok'}

    BootstrapService.set_runner(run)
    yield calls
    BootstrapService.set_runner(None)


# -- schema / normalizer ----------------------------------------------------

def test_unit_normalizes():
    n = ManifestSpecService.normalize(UNIT_MANIFEST)
    containers = n['services'][0]['containers']
    assert [c['name'] for c in containers] == ['web', 'prosody', 'jvb']
    web = containers[0]
    assert web['image'] == 'jitsi/web:stable'
    assert web['ports'][0]['host_port'] == 8443
    assert web['depends_on'] == [{'service': 'prosody', 'condition': 'healthy'}]
    assert web['health_check']['http_path'] == '/'
    prosody = containers[1]
    assert prosody['bootstrap']['command'] == '/opt/gen.sh'
    assert prosody['health_check']['cmd'] == 'prosodyctl status'


def test_unit_mutually_exclusive_with_buildpack_keys():
    with pytest.raises(ManifestError) as exc:
        ManifestSpecService.normalize({
            'version': 1,
            'services': [{'name': 'x', 'type': 'docker', 'buildCommand': 'make',
                          'containers': {'a': {'image': 'busybox'}}}],
        })
    assert any('containers' in e for e in exc.value.errors)


def test_depends_on_unknown_container_rejected():
    with pytest.raises(ManifestError) as exc:
        ManifestSpecService.normalize({
            'version': 1,
            'services': [{'name': 'x', 'type': 'docker', 'containers': {
                'a': {'image': 'busybox', 'dependsOn': [{'service': 'ghost'}]}}}],
        })
    assert any('ghost' in e for e in exc.value.errors)


def test_depends_on_cycle_rejected():
    with pytest.raises(ManifestError) as exc:
        ManifestSpecService.normalize({
            'version': 1,
            'services': [{'name': 'x', 'type': 'docker', 'containers': {
                'a': {'image': 'busybox', 'dependsOn': [{'service': 'b'}]},
                'b': {'image': 'busybox', 'dependsOn': [{'service': 'a'}]}}}],
        })
    assert any('cycle' in e for e in exc.value.errors)


# -- generator --------------------------------------------------------------

def test_unit_compose_render():
    n = ManifestSpecService.normalize(UNIT_MANIFEST)
    containers = n['services'][0]['containers']
    compose = UnitComposeService.render('meet', containers)
    services = compose['services']
    assert set(services) == {'web', 'prosody', 'jvb'}
    assert services['web']['container_name'] == 'meet-web'

    # healthchecks: httpPath -> wget probe, cmd -> CMD-SHELL
    assert services['web']['healthcheck']['test'][0] == 'CMD-SHELL'
    assert 'wget' in services['web']['healthcheck']['test'][1]
    assert services['prosody']['healthcheck']['test'] == ['CMD-SHELL', 'prosodyctl status']

    # dependsOn condition mapping
    assert services['web']['depends_on'] == {'prosody': {'condition': 'service_healthy'}}

    # raw L4 publishes
    assert services['jvb']['ports'] == ['0.0.0.0:10000:10000/udp']
    assert services['web']['ports'] == ['127.0.0.1:8443:443']

    # synthetic per-container named volume (no cross-container /config collision)
    assert 'meet-web-web-config:/config' in services['web']['volumes']
    assert 'meet-web-web-config' in compose['volumes']


# -- apply ------------------------------------------------------------------

def test_unit_applies_as_one_app(project, owner, runner_calls):
    from app.models import Application
    from app.models.backup_policy import BackupPolicy
    from app.services.manifest_persistence_service import ManifestPersistenceService

    n = ManifestSpecService.normalize(UNIT_MANIFEST)
    ManifestPersistenceService.store_manifest(project_id=project.id, normalized=n,
                                              raw_text=None, status='pending')
    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    assert result['success'] is True, result

    apps = Application.query.filter_by(project_id=project.id).all()
    assert len(apps) == 1  # ONE Application for the whole unit
    meet = apps[0]
    assert meet.name == 'meet'

    # aggregated ports persisted on the one app
    stored = json.loads(meet.ports)
    assert {p['host_port'] for p in stored} == {10000, 8443}

    # the prosody container's bootstrap ran exactly once, under the one flag
    assert meet.bootstrap_done is True
    assert len(runner_calls) == 1
    assert runner_calls[0]['service'] == 'prosody'

    # the backed-up unit disk got a policy routed at its synthetic volume
    policy = BackupPolicy.query.filter_by(target_type='files', target_id=meet.id).first()
    assert policy is not None
    assert policy.get_target_meta().get('docker_volume') == 'meet-web-web-config'

    # idempotent
    plan2 = ManifestApplyService.plan(project, n)
    assert plan2['step_count'] == 0, plan2['summary']

    # seams expose the unit's containers + regenerated compose
    assert ManifestApplyService.unit_container_names(meet) == \
        ['meet-web', 'meet-prosody', 'meet-jvb']
    compose = ManifestApplyService.unit_compose(meet)
    assert set(compose['services']) == {'web', 'prosody', 'jvb'}
