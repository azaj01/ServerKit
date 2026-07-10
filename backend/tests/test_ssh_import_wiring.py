"""Proving tests for SSH import wiring + credential hygiene (plan 31 Phase 3).

Plan 27 registered the SSH importer but left it unreachable — nothing wired the
``ssh`` format into ``SiteImportService``. This proves the fetch/extract branch
now stages via ``GenericSshImporter.pull`` and, crucially (Decision 5), that no
DB password or keyfile material survives in the durable import record, the
analysis, the result, or any job payload.

The live pull is Linux-only runtime, so ``pull`` is monkeypatched to stage a
fake directory — no subprocess, no real box.
"""
import json
import os

import pytest

from app import db
from app.models.site_import import SiteImport, VALID_SOURCE_TYPES
from app.services.site_import_service import SiteImportError, SiteImportService
from app.services.site_importers.ssh import GenericSshImporter, parse_ssh_source


SECRET_DB_PW = 'SUPER-SECRET-DB-PW'
KEYFILE_PATH = '/home/panel/.ssh/id_ed25519'

SSH_SOURCE = {
    'host': 'box.example.com', 'port': 22, 'user': 'deploy',
    'docroot': '/var/www/site', 'domain': 'site.example.com',
    'db_name': 'sitedb', 'db_user': 'siteusr', 'db_password': SECRET_DB_PW,
    'ssh_key': KEYFILE_PATH,
}


@pytest.fixture
def imports_base(tmp_path, monkeypatch):
    monkeypatch.setattr(SiteImportService, 'imports_base', str(tmp_path))
    return str(tmp_path)


def _fake_pull(self, source, staging_dir):
    """Stage a realistic dir (docroot + manifest) without any subprocess."""
    docroot = os.path.join(staging_dir, 'docroot')
    os.makedirs(docroot, exist_ok=True)
    with open(os.path.join(docroot, 'index.php'), 'w', encoding='utf-8') as fh:
        fh.write('<?php echo "hi";')
    GenericSshImporter._write_manifest(staging_dir, source, None)
    return {'staging_dir': staging_dir, 'docroot_dir': 'docroot', 'db_dump': None}


# --------------------------------------------------------------------------- #
# format wiring
# --------------------------------------------------------------------------- #

def test_ssh_is_a_valid_source_type():
    assert 'ssh' in VALID_SOURCE_TYPES


def test_create_ssh_validates_spec(app, imports_base):
    with pytest.raises(SiteImportError) as ei:
        SiteImportService.create('ssh', {'host': 'h'})  # missing user/docroot
    assert 'docroot' in str(ei.value) or 'user' in str(ei.value)


def test_create_ssh_ok(app, imports_base):
    imp = SiteImportService.create('ssh', dict(SSH_SOURCE))
    assert imp.source_type == 'ssh'
    assert imp.status == 'created'


def test_parse_ssh_source_has_no_password_field():
    src = parse_ssh_source(SSH_SOURCE)
    assert 'password' not in src              # keyfile-only (plan 31 #8)
    assert src['ssh_key'] == KEYFILE_PATH


# --------------------------------------------------------------------------- #
# staging branch + credential hygiene (Decision 5, #9)
# --------------------------------------------------------------------------- #

def test_analyze_stages_over_ssh_and_scrubs_password(app, imports_base, monkeypatch):
    monkeypatch.setattr(GenericSshImporter, 'pull', _fake_pull)
    imp = SiteImportService.create('ssh', dict(SSH_SOURCE))
    analysis = SiteImportService.analyze(imp)

    assert imp.status == 'analyzed'
    # The staged docroot is expressed so the copy step copies it directly.
    assert analysis.get('staged_docroot') == 'docroot'
    assert analysis.get('homedir_present') is True
    assert analysis['domains'][0]['domain'] == 'site.example.com'

    # The DB password was scrubbed from the persisted source post-pull.
    assert imp.get_source().get('db_password') in (None, '')


def test_no_db_password_anywhere_in_the_durable_record(app, imports_base, monkeypatch):
    monkeypatch.setattr(GenericSshImporter, 'pull', _fake_pull)
    imp = SiteImportService.create('ssh', dict(SSH_SOURCE))
    SiteImportService.analyze(imp)
    db.session.refresh(imp)

    # 1) The whole serialized import row carries no DB password.
    blob = json.dumps(imp.to_dict())
    assert SECRET_DB_PW not in blob

    # 2) The staging manifest carries no secrets (password or key material).
    manifest_path = os.path.join(SiteImportService.extracted_dir(imp),
                                 GenericSshImporter.MANIFEST_NAME)
    with open(manifest_path, encoding='utf-8') as fh:
        manifest_text = fh.read()
    assert SECRET_DB_PW not in manifest_text

    # 3) Job payloads (analyze + run) carry neither the password nor keyfile path.
    for job in (SiteImportService.enqueue_analyze(imp),
                SiteImportService.enqueue_run(imp)):
        payload = job.get_payload() or {}
        assert 'db_password' not in payload
        assert SECRET_DB_PW not in json.dumps(payload)
        assert KEYFILE_PATH not in json.dumps(payload)


def test_copy_files_uses_staged_docroot(app, imports_base, monkeypatch):
    from app.models import User
    from werkzeug.security import generate_password_hash
    db.session.add(User(email='owner@t.local', username='owner_ssh',
                        password_hash=generate_password_hash('x'),
                        role='admin', is_active=True))
    db.session.commit()

    # _step_create_app provisions the app root under paths.APPS_DIR, which
    # defaults to /var/serverkit/apps — not writable on the CI runner. Point it
    # at the tmp import base (same pattern as test_site_import.py's apps_dir).
    monkeypatch.setattr('app.paths.APPS_DIR', os.path.join(imports_base, 'apps'))

    monkeypatch.setattr(GenericSshImporter, 'pull', _fake_pull)
    imp = SiteImportService.create('ssh', dict(SSH_SOURCE))
    SiteImportService.analyze(imp)

    # Drive create_app + copy_files against the staged dir.
    ctx = {'analysis': imp.get_analysis(), 'options': imp.get_options(),
           'extracted': SiteImportService.extracted_dir(imp),
           'result': {'warnings': []}}
    SiteImportService._step_create_app(imp, ctx)
    SiteImportService._step_copy_files(imp, ctx)

    app_root = ctx['app'].root_path
    assert os.path.isfile(os.path.join(app_root, 'index.php'))
