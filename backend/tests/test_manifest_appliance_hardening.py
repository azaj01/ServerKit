"""Phase 6 (#18): hardening — scaffold round-trips appliance fields, drift
tracks raw ports + image, and the docs schema copy stays in structural parity
with the embedded one."""

import json
from pathlib import Path

import pytest

import app.models.application_manifest  # noqa: F401
from app.services.manifest_spec_service import ManifestSpecService, MANIFEST_SCHEMA
from app.services.manifest_apply_service import ManifestApplyService
from app.services.manifest_scaffold_service import ManifestScaffoldService
from app.services.app_port_service import AppPortService


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
def appliance_app(app, owner):
    from app import db
    from app.models import Application, Project, Environment
    from app.models.app_volume import AppVolume
    from app.services.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace()
    proj = Project(workspace_id=ws.id, name='Hard', slug='hard')
    db.session.add(proj)
    db.session.commit()
    env = Environment(project_id=proj.id, name='Production', slug='production', is_default=True)
    db.session.add(env)
    db.session.commit()
    row = Application(name='edge', app_type='docker', user_id=owner.id,
                      project_id=proj.id, environment_id=env.id, status='running',
                      docker_image='ghcr.io/acme/edge:2')
    AppPortService.set_ports(row, [
        {'host_port': 10000, 'container_port': 10000, 'protocol': 'udp', 'expose': 'public'},
        {'host_port': 8443, 'container_port': 443, 'protocol': 'tcp', 'expose': 'local'},
    ])
    db.session.add(row)
    db.session.commit()
    db.session.add(AppVolume(application_id=row.id, name='data',
                             docker_volume_name='serverkit-app-%d-data' % row.id,
                             mount_path='/data', declared_size='5GB'))
    db.session.commit()
    return proj, row


# -- scaffold round-trip ----------------------------------------------------

def test_scaffold_emits_appliance_fields(appliance_app):
    _proj, row = appliance_app
    manifest = ManifestScaffoldService.scaffold_for_app(row)
    svc = manifest['services'][0]
    assert svc['image'] == 'ghcr.io/acme/edge:2'
    # ports round-trip with non-default fields only
    ports = {p['port']: p for p in svc['ports']}
    assert ports[10000]['protocol'] == 'udp'
    assert ports[8443]['containerPort'] == 443 and ports[8443]['expose'] == 'local'
    assert 'protocol' not in ports[8443]  # tcp default omitted
    # disk size round-trips
    assert svc['disks'][0]['size'] == '5GB'
    # and the scaffold is itself a valid v1 manifest
    n = ManifestSpecService.normalize(manifest)
    assert len(n['services'][0]['ports']) == 2
    assert n['services'][0]['image'] == 'ghcr.io/acme/edge:2'


# -- drift ------------------------------------------------------------------

def test_drift_tracks_ports_and_image(appliance_app):
    from app import db
    from app.services.manifest_persistence_service import ManifestPersistenceService
    proj, row = appliance_app
    manifest = {
        'version': 1,
        'services': [{
            'name': 'edge', 'type': 'docker', 'image': 'ghcr.io/acme/edge:2',
            'ports': [{'port': 10000, 'protocol': 'udp'},
                      {'port': 8443, 'containerPort': 443, 'expose': 'local'}],
        }],
    }
    n = ManifestSpecService.normalize(manifest)
    ManifestPersistenceService.store_manifest(project_id=proj.id, normalized=n,
                                              raw_text=None, status='applied')

    resolved = ManifestApplyService.resolved_for_app(row)
    expected, observed = ManifestApplyService.drift_pair(row, resolved)
    # in sync
    assert expected['ports'] == observed['ports']
    assert expected['image'] == observed['image'] == 'ghcr.io/acme/edge:2'

    # mutate the live image -> drift surfaces
    row.docker_image = 'ghcr.io/acme/edge:3'
    db.session.commit()
    expected, observed = ManifestApplyService.drift_pair(row, resolved)
    assert expected['image'] != observed['image']


# -- schema copy parity -----------------------------------------------------

def test_docs_schema_copy_structural_parity():
    docs_path = Path(__file__).resolve().parents[2] / 'docs' / 'serverkit-yaml.schema.json'
    docs = json.loads(docs_path.read_text(encoding='utf-8'))

    # every embedded definition exists in the docs copy
    for name in MANIFEST_SCHEMA['definitions']:
        assert name in docs['definitions'], f'docs schema missing definition `{name}`'

    # every service property exists in the docs copy
    emb_props = MANIFEST_SCHEMA['definitions']['service']['properties']
    docs_props = docs['definitions']['service']['properties']
    for prop in emb_props:
        assert prop in docs_props, f'docs schema missing service property `{prop}`'

    # every envVar source exists in the docs copy
    emb_env = MANIFEST_SCHEMA['definitions']['envVar']['properties']
    docs_env = docs['definitions']['envVar']['properties']
    for prop in emb_env:
        assert prop in docs_env, f'docs schema missing envVar property `{prop}`'
