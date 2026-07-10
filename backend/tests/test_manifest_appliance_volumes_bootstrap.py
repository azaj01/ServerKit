"""Proving tests for Phase 2 of the Appliance tier (plan 35):
declared volume size, disk-backup routing to the volume host mount, and the
one-shot first-boot bootstrap."""

import pytest

import app.models.application_manifest  # noqa: F401
from app.services.manifest_spec_service import ManifestSpecService
from app.services.manifest_apply_service import ManifestApplyService
from app.services.bootstrap_service import BootstrapService
from app.services.buildpack_service import BuildpackService


VOL_BOOT_MANIFEST = {
    'version': 1,
    'services': [{
        'name': 'appliance', 'type': 'docker',
        'disks': [{'name': 'config', 'mountPath': '/config', 'size': '2GB',
                   'backup': {'schedule': 'daily', 'retain': 5}}],
        'bootstrap': {'command': '/opt/gen-config.sh', 'timeoutSeconds': 60},
    }],
}


@pytest.fixture
def project(app):
    from app import db
    from app.models import Project, Environment
    from app.services.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace()
    proj = Project(workspace_id=ws.id, name='Appliance', slug='appliance')
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
def _stub_side_effects(monkeypatch):
    from app.services.docker_service import DockerService
    monkeypatch.setattr(DockerService, 'create_volume',
                        classmethod(lambda cls, name, driver='local': {'success': True}))


@pytest.fixture
def runner_calls():
    calls = []

    def run(app, service, command, timeout):
        calls.append({'service': service, 'command': command, 'timeout': timeout})
        return {'success': True, 'output': 'generated'}

    BootstrapService.set_runner(run)
    yield calls
    BootstrapService.set_runner(None)


# -- normalizer -------------------------------------------------------------

def test_disk_size_and_bootstrap_normalize():
    n = ManifestSpecService.normalize(VOL_BOOT_MANIFEST)
    svc = n['services'][0]
    assert svc['disks'][0]['size'] == '2GB'
    assert svc['bootstrap'] == {'command': '/opt/gen-config.sh', 'timeout_seconds': 60}


def test_bootstrap_requires_command():
    from app.services.manifest_spec_service import ManifestError
    with pytest.raises(ManifestError):
        ManifestSpecService.normalize({
            'version': 1,
            'services': [{'name': 'x', 'type': 'docker',
                          'bootstrap': {'timeoutSeconds': 5}}],
        })


# -- generators -------------------------------------------------------------

def test_generate_compose_mounts_declared_volumes():
    compose = BuildpackService.generate_compose(
        {'port': 3000}, 'app',
        volumes=['serverkit-app-1-config:/config'],
        named_volumes=['serverkit-app-1-config'])
    assert 'serverkit-app-1-config:/config' in compose
    assert 'volumes:' in compose


def test_compose_fragment_consumed(project, owner):
    from app import db
    from app.models import Application
    from app.services.volume_service import VolumeService
    app_row = Application(name='frag', app_type='docker', user_id=owner.id,
                          project_id=project.id, status='stopped')
    db.session.add(app_row)
    db.session.commit()
    VolumeService.create(app_row, 'data', '/var/data')
    frag = VolumeService.compose_fragment(app_row)
    assert any(spec.endswith(':/var/data') for spec in frag['service'])
    assert frag['top_level']  # a top-level named volume is declared


# -- apply ------------------------------------------------------------------

def test_apply_persists_declared_size_and_backup_routing(project, owner, runner_calls):
    from app.models import Application
    from app.models.backup_policy import BackupPolicy
    n = ManifestSpecService.normalize(VOL_BOOT_MANIFEST)
    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    assert result['success'] is True, result

    app_row = Application.query.filter_by(project_id=project.id, name='appliance').first()
    vol = next(v for v in app_row.volumes if v.mount_path == '/config')
    assert vol.declared_size == '2GB'

    policy = BackupPolicy.query.filter_by(target_type='files', target_id=app_row.id).first()
    assert policy is not None
    meta = policy.get_target_meta()
    assert meta.get('volume_mount') == '/config'
    assert meta.get('app_id') == app_row.id

    # bootstrap ran exactly once and is stamped
    assert len(runner_calls) == 1
    assert app_row.bootstrap_done is True

    # idempotent: nothing left to do
    plan2 = ManifestApplyService.plan(project, n)
    assert plan2['step_count'] == 0, plan2['summary']


def test_bootstrap_runs_only_once_across_applies(project, owner, runner_calls):
    n = ManifestSpecService.normalize(VOL_BOOT_MANIFEST)
    ManifestApplyService.apply(project, n, user_id=owner.id)
    ManifestApplyService.apply(project, n, user_id=owner.id)
    assert len(runner_calls) == 1  # second apply is a no-op for bootstrap


def test_bootstrap_failure_fails_apply(project, owner):
    def failing(app, service, command, timeout):
        return {'success': False, 'error': 'cert generation blew up'}
    BootstrapService.set_runner(failing)
    try:
        from app.models import Application
        n = ManifestSpecService.normalize(VOL_BOOT_MANIFEST)
        result = ManifestApplyService.apply(project, n, user_id=owner.id)
        assert result['success'] is False
        app_row = Application.query.filter_by(project_id=project.id, name='appliance').first()
        assert app_row.bootstrap_done is False
        assert any(r['status'] == 'error' and 'bootstrap' in (r.get('error') or '') or
                   r.get('type') == 'bootstrap' and r['status'] == 'error'
                   for r in result['results'])
    finally:
        BootstrapService.set_runner(None)


# -- reset endpoint ---------------------------------------------------------

def test_reset_bootstrap_endpoint(client, auth_headers, project, owner, runner_calls):
    from app.models import Application
    n = ManifestSpecService.normalize(VOL_BOOT_MANIFEST)
    ManifestApplyService.apply(project, n, user_id=owner.id)
    app_row = Application.query.filter_by(project_id=project.id, name='appliance').first()
    assert app_row.bootstrap_done is True

    # wrong confirm is refused
    resp = client.post('/api/v1/manifests/bootstrap/reset', headers=auth_headers,
                       json={'app_id': app_row.id, 'confirm': 'nope'})
    assert resp.status_code == 400

    # correct confirm re-arms it
    resp = client.post('/api/v1/manifests/bootstrap/reset', headers=auth_headers,
                       json={'app_id': app_row.id, 'confirm': 'appliance'})
    assert resp.status_code == 200
    from app import db
    db.session.refresh(app_row)
    assert app_row.bootstrap_done is False

    # a fresh plan now schedules the bootstrap again
    plan = ManifestApplyService.plan(project, n)
    assert 'bootstrap' in [s['type'] for s in plan['steps']]
