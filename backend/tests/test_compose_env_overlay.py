"""Compose env overlay: the managed override that injects an app's effective
environment (shared variable groups under local env vars) into every compose
service, and that compose_up includes it."""
import os
import yaml


BASE_COMPOSE = """\
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
  db:
    image: postgres:16
"""


def _make_compose_app(tmp_path, workspace_id=99):
    from app import db
    from app.models.application import Application
    root = str(tmp_path)
    with open(os.path.join(root, 'docker-compose.yml'), 'w', encoding='utf-8') as f:
        f.write(BASE_COMPOSE)
    a = Application(
        name='svc', app_type='docker', status='running', user_id=1,
        root_path=root, managed_by='docker_compose', workspace_id=workspace_id,
    )
    db.session.add(a)
    db.session.commit()
    return a


def _set_local(app_id, key, value, is_secret=False):
    from app import db
    from app.models import EnvironmentVariable
    ev = EnvironmentVariable(application_id=app_id, key=key, is_secret=is_secret)
    ev.value = value
    db.session.add(ev)
    db.session.commit()


def _make_scoped_group(scope_type, scope_id, key, value):
    from app import db
    from app.models.shared_resource import SharedVariableGroup, SharedVariable
    g = SharedVariableGroup(scope_type=scope_type, scope_id=str(scope_id), name='g')
    db.session.add(g)
    db.session.commit()
    v = SharedVariable(group_id=g.id, key=key, is_secret=False)
    v.value = value
    db.session.add(v)
    db.session.commit()


def test_find_base_compose(app, tmp_path):
    from app.services.compose_env_service import ComposeEnvService
    assert ComposeEnvService.find_base_compose(str(tmp_path)) is None
    open(os.path.join(str(tmp_path), 'docker-compose.yml'), 'w').close()
    assert ComposeEnvService.find_base_compose(str(tmp_path)) == 'docker-compose.yml'
    # explicit compose_file is authoritative
    assert ComposeEnvService.find_base_compose(str(tmp_path), 'custom.yml') == 'custom.yml'


def test_refresh_writes_overlay_for_every_service(app, tmp_path):
    from app.services.compose_env_service import ComposeEnvService
    with app.app_context():
        a = _make_compose_app(tmp_path, workspace_id=99)
        _make_scoped_group('workspace', 99, 'SHARED_KEY', 'shared_val')
        _set_local(a.id, 'LOCAL_KEY', 'local_val')
        _set_local(a.id, 'OVERRIDE_ME', 'local_wins')
        _make_scoped_group('workspace', 99, 'OVERRIDE_ME', 'group_loses')

        path = ComposeEnvService.refresh_for_project(str(tmp_path))
        assert path and os.path.exists(path)
        with open(path, encoding='utf-8') as f:
            data = yaml.safe_load(f)

        for svc in ('web', 'db'):
            env = data['services'][svc]['environment']
            assert env['SHARED_KEY'] == 'shared_val'   # shared group injected
            assert env['LOCAL_KEY'] == 'local_val'
            assert env['OVERRIDE_ME'] == 'local_wins'   # local beat the shared group


def test_dollar_signs_are_escaped(app, tmp_path):
    from app.services.compose_env_service import ComposeEnvService
    with app.app_context():
        a = _make_compose_app(tmp_path, workspace_id=5)
        _set_local(a.id, 'PASS', 'a$b${X}')
        path = ComposeEnvService.refresh_for_project(str(tmp_path))
        with open(path, encoding='utf-8') as f:
            data = yaml.safe_load(f)
        # '$' doubled so compose interpolation leaves the literal value intact.
        assert data['services']['web']['environment']['PASS'] == 'a$$b$${X}'


def test_no_env_removes_stale_override(app, tmp_path):
    from app.services.compose_env_service import ComposeEnvService
    with app.app_context():
        _make_compose_app(tmp_path, workspace_id=1)  # app with no env vars
        stale = ComposeEnvService.override_path(str(tmp_path))
        with open(stale, 'w', encoding='utf-8') as f:
            f.write('services: {}\n')
        path = ComposeEnvService.refresh_for_project(str(tmp_path))
        assert path is None
        assert not os.path.exists(stale)   # stale override cleaned up


def test_non_app_dir_is_untouched(app, tmp_path):
    from app.services.compose_env_service import ComposeEnvService
    with app.app_context():
        open(os.path.join(str(tmp_path), 'docker-compose.yml'), 'w').close()
        # No Application has this root_path → leave it alone.
        assert ComposeEnvService.refresh_for_project(str(tmp_path)) is None
        assert not os.path.exists(ComposeEnvService.override_path(str(tmp_path)))


def test_compose_up_includes_override(app, tmp_path, monkeypatch):
    from app.services import docker_service as ds_mod
    from app.services.docker_service import DockerService
    with app.app_context():
        a = _make_compose_app(tmp_path, workspace_id=3)
        _set_local(a.id, 'FOO', 'bar')

        # Pin the compose binary so detection doesn't shell out.
        monkeypatch.setattr(DockerService, '_compose_cmd', ['docker', 'compose'], raising=False)

        captured = {}

        class _Result:
            returncode = 0
            stdout = ''
            stderr = ''

        def _fake_run(cmd, **kwargs):
            captured['cmd'] = cmd
            return _Result()

        monkeypatch.setattr(ds_mod.subprocess, 'run', _fake_run)

        DockerService.compose_up(str(tmp_path))
        cmd = captured['cmd']
        assert cmd.count('-f') == 2
        assert any('docker-compose.serverkit.yml' in str(c) for c in cmd)
        assert cmd[-1] == 'up' or 'up' in cmd
