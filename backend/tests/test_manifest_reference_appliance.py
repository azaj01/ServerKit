"""Phase 6 (#17): the reference appliance applies end-to-end.

Exercises every appliance-tier feature at once — a 4-container media unit with a
public UDP port, a config-generating bootstrap, shared disks (one backed up), a
health-gated dependsOn chain, and a fromServer public IP — against stubbed
compose/firewall/DNS."""

import json
from pathlib import Path

import pytest

import app.models.application_manifest  # noqa: F401
from app.services.manifest_spec_service import ManifestSpecService
from app.services.manifest_apply_service import ManifestApplyService
from app.services.app_port_service import AppPortService
from app.services.bootstrap_service import BootstrapService

REFERENCE = (Path(__file__).resolve().parents[2]
             / 'docs' / 'examples' / 'reference-appliance-media.yaml')


@pytest.fixture
def project(app):
    from app import db
    from app.models import Project, Environment
    from app.services.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace()
    proj = Project(workspace_id=ws.id, name='Media', slug='media-ref')
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


@pytest.fixture
def runner_calls():
    calls = []

    def run(app, service, command, timeout):
        calls.append({'service': service, 'command': command})
        return {'success': True, 'output': 'ok'}

    BootstrapService.set_runner(run)
    yield calls
    BootstrapService.set_runner(None)


@pytest.fixture(autouse=True)
def _stub(monkeypatch):
    from app.services.docker_service import DockerService
    from app.services.domain_attach_service import DomainAttachService
    from app.services.site_domain_service import SiteDomainService
    monkeypatch.setattr(DockerService, 'create_volume',
                        classmethod(lambda cls, name, driver='local': {'success': True}))
    monkeypatch.setattr(ManifestApplyService, '_port_bound', lambda port: False)
    monkeypatch.setattr(ManifestApplyService, '_firewall_state', lambda: 'active')
    monkeypatch.setattr(AppPortService, 'open_firewall', classmethod(lambda cls, ports: []))
    monkeypatch.setattr(SiteDomainService, 'server_ip', classmethod(lambda cls: '203.0.113.77'))

    def _attach(cls, app, host, ssl='auto', email=None, make_primary=False):
        from app import db as _db
        from app.models.domain import Domain
        if not any(d.name == host for d in (app.domains or [])):
            _db.session.add(Domain(name=host, application_id=app.id, is_primary=False))
            _db.session.commit()
        return {'success': True, 'domain': host, 'created': True, 'warnings': []}
    monkeypatch.setattr(DomainAttachService, 'attach', classmethod(_attach))


def test_reference_appliance_applies_end_to_end(project, owner, runner_calls):
    from app.models import Application
    from app.models.backup_policy import BackupPolicy
    from app.services.env_service import EnvService
    from app.services.manifest_persistence_service import ManifestPersistenceService

    raw = REFERENCE.read_text(encoding='utf-8')
    n = ManifestSpecService.normalize_text(raw)
    ManifestPersistenceService.store_manifest(project_id=project.id, normalized=n,
                                              raw_text=raw, status='pending')

    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    assert result['success'] is True, result

    # ONE Application for the whole unit
    apps = Application.query.filter_by(project_id=project.id).all()
    assert [a.name for a in apps] == ['meet']
    meet = apps[0]

    # the public UDP media port + the loopback web port are recorded
    stored = {p['host_port']: p for p in json.loads(meet.ports)}
    assert stored[10000]['protocol'] == 'udp' and stored[10000]['expose'] == 'public'
    assert stored[8443]['expose'] == 'local'
    assert AppPortService.compose_ports(json.loads(meet.ports)).count('0.0.0.0:10000:10000/udp') == 1

    # the prosody bootstrap ran exactly once, under the single flag
    assert meet.bootstrap_done is True
    assert len(runner_calls) == 1 and runner_calls[0]['service'] == 'prosody'

    # the media bridge's advertised IP is bound from the host
    env = EnvService.get_effective_env(meet.id)
    assert env.get('JVB_ADVERTISE_IP') == '203.0.113.77'
    assert env.get('PUBLIC_URL') == 'https://meet.example.com'

    # the backed-up web-config disk got a policy routed at its synthetic volume
    policy = BackupPolicy.query.filter_by(target_type='files', target_id=meet.id).first()
    assert policy is not None
    assert policy.get_target_meta().get('docker_volume') == 'meet-web-web-config'

    # the generated compose reproduces the 4-service shape
    compose = ManifestApplyService.unit_compose(meet)
    assert set(compose['services']) == {'web', 'prosody', 'jicofo', 'jvb'}
    assert compose['services']['jvb']['ports'] == ['0.0.0.0:10000:10000/udp']
    assert compose['services']['web']['depends_on'] == {'prosody': {'condition': 'service_healthy'}}

    # a second apply is a no-op
    plan2 = ManifestApplyService.plan(project, n)
    assert plan2['step_count'] == 0, plan2['summary']
