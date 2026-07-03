"""Tests for the DirectAdmin and Hestia archive importers.

Covers: detect() truth matrix across all three built-in formats, the
analyse reports built from synthetic DirectAdmin/Hestia backups (domains,
databases, users + hashes, crontab incl. the Hestia config-format
conversion, php version, warnings on missing sections), format
auto-detection, nested-archive docroot staging, and an end-to-end
SiteImportService.run() for each format with exec paths monkeypatched.
"""
import os
import shutil
import tarfile

import pytest

from app.services.site_import_service import SiteImportService
from app.services.site_importers import (
    available_formats,
    detect_format,
    get_importer,
)
from app.services.site_importers.directadmin import DirectadminImporter
from app.services.site_importers.hestia import HestiaImporter

NATIVE_HASH = '*94BDCEBE19083CE2A1F959FD02F964C7AF4CFC29'
DA_WRAPPER = 'user.admin.alice'
HESTIA_WRAPPER = 'alice.2026-07-01'


# --------------------------------------------------------------------------
# synthetic backup builders
# --------------------------------------------------------------------------

def _write(root, rel, content):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(content)


def _build_da_tree(root):
    """Synthetic DirectAdmin account-backup content tree."""
    _write(root, 'backup/user.conf',
           'username=alice\ndomain=example.com\nphp1_release=8.1\n')
    _write(root, 'backup/example.com/domain.conf', 'domain=example.com\n')
    _write(root, 'backup/example.com/email/passwd',
           'info:$1$x:100\nsales:$1$y:101\n')
    _write(root, 'backup/blog.example.net/domain.conf',
           'domain=blog.example.net\n')
    _write(root, 'backup/alice_wp.sql', 'CREATE TABLE wp_posts (id INT);\n')
    _write(root, 'backup/mysql.conf', f'user=alice\npasswd={NATIVE_HASH}\n')
    _write(root, 'backup/alice_wp.conf',
           f'user0=alice_wp&passwd0={NATIVE_HASH}&accesshost0=localhost')
    _write(root, 'backup/crontab.conf',
           'MAILTO=alice@example.com\n'
           '1=*/5 * * * * /usr/bin/php /home/alice/cron.php\n')
    _write(root, 'domains/example.com/public_html/index.php',
           "<?php echo 'imported'; ?>")
    _write(root, 'domains/blog.example.net/public_html/index.html',
           '<html>blog</html>')
    os.makedirs(os.path.join(root, 'imap', 'example.com', 'info'),
                exist_ok=True)


def _nested_targz(dest, files, inner_prefix=''):
    """Create a nested .tar.gz whose members are ``files`` (rel → content),
    optionally nested under ``inner_prefix``."""
    import tempfile
    stage = tempfile.mkdtemp()
    try:
        for rel, content in files.items():
            _write(stage, os.path.join(inner_prefix, rel), content)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with tarfile.open(dest, 'w:gz') as tar:
            for entry in sorted(os.listdir(stage)):
                tar.add(os.path.join(stage, entry), arcname=entry)
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def _build_hestia_tree(root):
    """Synthetic Hestia user-backup content tree (nested docroot tars)."""
    _write(root, 'pam/passwd', 'alice:x:1001:1001::/home/alice:/bin/bash\n')
    _write(root, 'user.conf', "NAME='alice' PACKAGE='default'\n")
    # domain_data.tar.gz wraps a public_html/ dir; public_html.tar.gz
    # ships the files directly.
    _nested_targz(os.path.join(root, 'web', 'example.com',
                               'domain_data.tar.gz'),
                  {'index.php': "<?php echo 'imported'; ?>"},
                  inner_prefix='public_html')
    _nested_targz(os.path.join(root, 'web', 'static.example.com',
                               'public_html.tar.gz'),
                  {'index.html': '<html>static</html>'})
    _write(root, 'web/example.com/hestia/web.conf',
           "DOMAIN='example.com' BACKEND_TEMPLATE='PHP-FPM-81'\n")
    _write(root, 'db/alice_db/alice_db.sql',
           'CREATE TABLE posts (id INT);\n')
    _write(root, 'hestia/db.conf',
           f"DB='alice_db' DBUSER='alice_db' MD5='{NATIVE_HASH}' "
           "HOST='localhost' TYPE='mysql'\n")
    _write(root, 'cron/cron.conf',
           "JOB='1' MIN='*/10' HOUR='*' DAY='*' MONTH='*' WDAY='*' "
           "CMD='php /home/alice/cron.php' SUSPENDED='no'\n"
           "JOB='2' MIN='0' HOUR='3' DAY='*' MONTH='*' WDAY='*' "
           "CMD='echo paused' SUSPENDED='yes'\n")
    _write(root, 'mail/example.com/example.com.conf',
           "ACCOUNT='info' MD5='$1$x'\nACCOUNT='sales' MD5='$1$y'\n")
    _write(root, 'dns/example.com.conf', "RECORD='@ A 1.2.3.4'\n")


def _build_cpanel_tree(root):
    """Minimal cPanel layout (enough for its detect())."""
    _write(root, 'cp/alice', 'DNS=example.com\n')
    _write(root, 'userdata/main', 'main_domain: example.com\n')
    _write(root, 'homedir/public_html/index.php', '<?php ?>')


def _make_archive(tmp_path, builder, wrapper, name):
    src = os.path.join(str(tmp_path), 'src', wrapper)
    os.makedirs(src, exist_ok=True)
    builder(src)
    archive = os.path.join(str(tmp_path), name)
    with tarfile.open(archive, 'w:gz') as tar:
        tar.add(src, arcname=wrapper)
    return archive


def _extracted_tree(tmp_path, builder, wrapper, label):
    """Build a tree under <tmp>/<label>/<wrapper>/ and return the parent
    (mirrors what SiteImportService's extraction produces)."""
    extracted = os.path.join(str(tmp_path), label, wrapper)
    os.makedirs(extracted, exist_ok=True)
    builder(extracted)
    return os.path.dirname(extracted)


# --------------------------------------------------------------------------
# shared fixtures (mirroring test_site_import.py)
# --------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def imports_base(tmp_path):
    SiteImportService.imports_base = os.path.join(str(tmp_path), 'imports')
    os.makedirs(SiteImportService.uploads_dir(), exist_ok=True)
    yield SiteImportService.imports_base
    SiteImportService.imports_base = None


def _stage_upload(archive, token):
    dest = os.path.join(SiteImportService.uploads_dir(), token)
    shutil.copyfile(archive, dest)
    return f'uploads/{token}'


def _make_import(tmp_path, source_type, builder, wrapper, user_id=None):
    archive = _make_archive(tmp_path, builder, wrapper, f'{wrapper}.tar.gz')
    upload_path = _stage_upload(archive, f'{wrapper}.tar.gz')
    return SiteImportService.create(source_type, {'upload_path': upload_path},
                                    options={}, user_id=user_id)


class FakeDb:
    """Records DatabaseService calls; every call succeeds."""

    def __init__(self):
        self.calls = []

    def install(self, monkeypatch):
        from app.services.database_service import DatabaseService

        def record(name):
            def _fn(*args, **kwargs):
                self.calls.append((name, args, kwargs))
                return {'success': True, 'output': '3'}
            return _fn

        for name in ('mysql_create_database', 'mysql_restore',
                     'mysql_execute', 'mysql_create_user',
                     'mysql_grant_privileges'):
            monkeypatch.setattr(DatabaseService, name, record(name))
        monkeypatch.setattr(DatabaseService, 'generate_password',
                            lambda *a, **k: 'newpass123')
        return self

    def named(self, name):
        return [c for c in self.calls if c[0] == name]


@pytest.fixture
def fake_db(monkeypatch):
    return FakeDb().install(monkeypatch)


@pytest.fixture
def fake_cron(monkeypatch):
    calls = []
    from app.services.cron_service import CronService

    def fake_add_job(schedule, command, name=None, description=None):
        calls.append({'schedule': schedule, 'command': command, 'name': name})
        return {'success': True, 'job_id': 'job_x'}

    monkeypatch.setattr(CronService, 'add_job', fake_add_job)
    return calls


@pytest.fixture
def apps_dir(tmp_path, monkeypatch):
    apps = os.path.join(str(tmp_path), 'apps')
    monkeypatch.setattr('app.paths.APPS_DIR', apps)
    return apps


def _admin_user(app):
    from app import db
    from app.models import User
    from werkzeug.security import generate_password_hash
    user = User(email='imp2@test.local', username='imp2admin',
                password_hash=generate_password_hash('x'),
                role=User.ROLE_ADMIN, is_active=True)
    db.session.add(user)
    db.session.commit()
    return user


# --------------------------------------------------------------------------
# registry + detection matrix
# --------------------------------------------------------------------------

def test_registry_has_new_formats():
    formats = available_formats()
    assert 'directadmin' in formats
    assert 'hestia' in formats
    assert isinstance(get_importer('directadmin'), DirectadminImporter)
    assert isinstance(get_importer('hestia'), HestiaImporter)


def test_detect_matrix_across_formats(tmp_path):
    da = _extracted_tree(tmp_path, _build_da_tree, DA_WRAPPER, 'da')
    hestia = _extracted_tree(tmp_path, _build_hestia_tree, HESTIA_WRAPPER,
                             'hestia')
    cpanel = _extracted_tree(tmp_path, _build_cpanel_tree,
                             'backup-7.3.2026_12-00-00_alice', 'cpanel')
    empty = os.path.join(str(tmp_path), 'empty')
    os.makedirs(os.path.join(empty, 'random-stuff'))

    da_imp = get_importer('directadmin')
    hestia_imp = get_importer('hestia')
    cpanel_imp = get_importer('cpanel')

    assert da_imp.detect(da) is True
    assert da_imp.detect(hestia) is False
    assert da_imp.detect(cpanel) is False
    assert da_imp.detect(empty) is False

    assert hestia_imp.detect(hestia) is True
    assert hestia_imp.detect(da) is False
    assert hestia_imp.detect(cpanel) is False
    assert hestia_imp.detect(empty) is False

    assert cpanel_imp.detect(da) is False
    assert cpanel_imp.detect(hestia) is False

    assert detect_format(da)[0] == 'directadmin'
    assert detect_format(hestia)[0] == 'hestia'
    assert detect_format(cpanel)[0] == 'cpanel'
    assert detect_format(empty) == (None, None)


# --------------------------------------------------------------------------
# DirectAdmin analyse
# --------------------------------------------------------------------------

def test_directadmin_analyze_report(tmp_path):
    extracted = _extracted_tree(tmp_path, _build_da_tree, DA_WRAPPER, 'da')
    report = get_importer('directadmin').analyze(extracted)

    for key in ('format', 'homedir_present', 'domains', 'databases',
                'db_users', 'crontab', 'mail_accounts_count', 'php_version',
                'warnings', 'unsupported'):
        assert key in report, f'missing report key {key}'

    assert report['format'] == 'directadmin'
    assert report['source_root'] == DA_WRAPPER
    assert report['account_user'] == 'alice'
    assert report['php_version'] == '8.1'

    # Primary domain (from user.conf) sorts first.
    assert [d['domain'] for d in report['domains']] == [
        'example.com', 'blog.example.net']
    assert report['domains'][0] == {
        'domain': 'example.com',
        'docroot': '/home/alice/domains/example.com/public_html',
        'type': 'primary',
    }
    assert report['domains'][1]['type'] == 'secondary'

    # Docroots staged under homedir/ for the shared copy step.
    assert report['homedir_present'] is True
    assert os.path.isfile(os.path.join(
        extracted, DA_WRAPPER, 'homedir', 'domains', 'example.com',
        'public_html', 'index.php'))
    assert any('Staged domains/' in w for w in report['warnings'])

    assert len(report['databases']) == 1
    database = report['databases'][0]
    assert database['name'] == 'alice_wp'
    assert database['engine'] == 'mysql'
    assert database['dump_path'] == f'{DA_WRAPPER}/backup/alice_wp.sql'
    assert database['size'] > 0

    users = {u['user']: u for u in report['db_users']}
    assert set(users) == {'alice', 'alice_wp'}
    for entry in users.values():
        assert entry['hash'] == NATIVE_HASH
        assert entry['hash_format'] == 'mysql_native_password'
        assert entry['grants'] == []

    # MAILTO env line dropped, "<id>=" prefix stripped.
    assert report['crontab'] == [
        '*/5 * * * * /usr/bin/php /home/alice/cron.php']

    assert report['mail_accounts_count'] == 2
    assert any('mail account' in u for u in report['unsupported'])


def test_directadmin_partial_backup_warns_not_crashes(tmp_path):
    root = os.path.join(str(tmp_path), 'partial', DA_WRAPPER)
    _write(root, 'backup/user.conf', 'username=alice\n')
    report = get_importer('directadmin').analyze(os.path.dirname(root))
    assert report['format'] == 'directadmin'
    assert report['homedir_present'] is False
    assert report['domains'] == []
    assert report['databases'] == []
    assert report['db_users'] == []
    assert report['crontab'] == []
    assert report['warnings']  # every missing section surfaced


def test_directadmin_non_native_hash_warns(tmp_path):
    root = os.path.join(str(tmp_path), 'plain', DA_WRAPPER)
    _write(root, 'backup/user.conf', 'username=alice\n')
    _write(root, 'backup/mysql.conf', 'user=alice\npasswd=plaintextpw\n')
    report = get_importer('directadmin').analyze(os.path.dirname(root))
    (entry,) = report['db_users']
    assert entry['hash_format'] == 'unknown'
    assert any('new password will be generated' in w
               for w in report['warnings'])


# --------------------------------------------------------------------------
# Hestia analyse
# --------------------------------------------------------------------------

def test_hestia_analyze_report(tmp_path):
    extracted = _extracted_tree(tmp_path, _build_hestia_tree, HESTIA_WRAPPER,
                                'hestia')
    report = get_importer('hestia').analyze(extracted)

    for key in ('format', 'homedir_present', 'domains', 'databases',
                'db_users', 'crontab', 'mail_accounts_count', 'php_version',
                'warnings', 'unsupported'):
        assert key in report, f'missing report key {key}'

    assert report['format'] == 'hestia'
    assert report['source_root'] == HESTIA_WRAPPER
    assert report['account_user'] == 'alice'
    assert report['php_version'] == '8.1'  # from BACKEND_TEMPLATE='PHP-FPM-81'

    # First (sorted) domain is treated as primary.
    assert [d['domain'] for d in report['domains']] == [
        'example.com', 'static.example.com']
    assert report['domains'][0] == {
        'domain': 'example.com',
        'docroot': '/home/alice/web/example.com/public_html',
        'type': 'primary',
    }
    # public_html.tar.gz shipped files directly → docroot is the stage dir.
    assert report['domains'][1]['docroot'] == \
        '/home/alice/web/static.example.com'

    # Nested archives extracted into homedir/ with traversal-safe helper.
    root = os.path.join(extracted, HESTIA_WRAPPER)
    assert report['homedir_present'] is True
    assert os.path.isfile(os.path.join(
        root, 'homedir', 'web', 'example.com', 'public_html', 'index.php'))
    assert os.path.isfile(os.path.join(
        root, 'homedir', 'web', 'static.example.com', 'index.html'))
    assert any('Extracted nested' in w for w in report['warnings'])

    (database,) = report['databases']
    assert database['name'] == 'alice_db'
    assert database['engine'] == 'mysql'
    assert database['dump_path'] == \
        f'{HESTIA_WRAPPER}/db/alice_db/alice_db.sql'
    assert database['size'] > 0

    (db_user,) = report['db_users']
    assert db_user['user'] == 'alice_db'
    assert db_user['hash'] == NATIVE_HASH
    assert db_user['hash_format'] == 'mysql_native_password'

    # Config-format cron converted; suspended job skipped with a warning.
    assert report['crontab'] == ['*/10 * * * * php /home/alice/cron.php']
    assert any('suspended cron job' in w for w in report['warnings'])

    assert report['mail_accounts_count'] == 2
    unsupported = ' '.join(report['unsupported'])
    assert 'mail account' in unsupported
    assert 'DNS zone' in unsupported


def test_hestia_partial_backup_warns_not_crashes(tmp_path):
    root = os.path.join(str(tmp_path), 'partial', HESTIA_WRAPPER)
    _write(root, 'pam/passwd', 'alice:x:1001:1001::/home/alice:/bin/bash\n')
    _write(root, 'user.conf', "NAME='alice'\n")
    os.makedirs(os.path.join(root, 'web'))  # empty — no domains
    report = get_importer('hestia').analyze(os.path.dirname(root))
    assert report['format'] == 'hestia'
    assert report['homedir_present'] is False
    assert report['domains'] == []
    assert report['databases'] == []
    assert report['crontab'] == []
    assert report['warnings']


def test_hestia_gzipped_dump_is_decompressed(tmp_path):
    import gzip
    root = os.path.join(str(tmp_path), 'gz', HESTIA_WRAPPER)
    _write(root, 'pam/passwd', 'alice:x:1001:1001::/home/alice:/bin/bash\n')
    os.makedirs(os.path.join(root, 'db', 'alice_db'), exist_ok=True)
    with gzip.open(os.path.join(root, 'db', 'alice_db',
                                'alice_db.sql.gz'), 'wb') as fh:
        fh.write(b'CREATE TABLE posts (id INT);\n')
    report = get_importer('hestia').analyze(os.path.dirname(root))
    (database,) = report['databases']
    assert database['dump_path'].endswith('db/alice_db/alice_db.sql')
    assert os.path.isfile(os.path.join(
        root, 'db', 'alice_db', 'alice_db.sql'))
    assert any('Decompressed' in w for w in report['warnings'])


# --------------------------------------------------------------------------
# auto-detection through the service
# --------------------------------------------------------------------------

@pytest.mark.parametrize('builder,wrapper,expected', [
    (_build_da_tree, DA_WRAPPER, 'directadmin'),
    (_build_hestia_tree, HESTIA_WRAPPER, 'hestia'),
])
def test_auto_source_type_detects_format(app, tmp_path, builder, wrapper,
                                         expected):
    imp = _make_import(tmp_path, 'auto', builder, wrapper)
    SiteImportService.analyze(imp)
    assert imp.source_type == expected
    assert imp.status == 'analyzed'


# --------------------------------------------------------------------------
# end-to-end run() with the default plan
# --------------------------------------------------------------------------

def test_directadmin_end_to_end_run(app, tmp_path, fake_db, fake_cron,
                                    apps_dir):
    from app.models import Application
    user = _admin_user(app)
    imp = _make_import(tmp_path, 'directadmin', _build_da_tree, DA_WRAPPER,
                       user_id=user.id)
    SiteImportService.analyze(imp)
    SiteImportService.run(imp)

    assert imp.status == 'completed'
    assert imp.error is None
    result = imp.get_result()
    application = Application.query.get(result['app_id'])
    assert application is not None
    assert application.name == 'example-com'
    assert application.php_version == '8.1'
    # Primary docroot copied out of the staged homedir/.
    assert os.path.isfile(os.path.join(application.root_path, 'index.php'))

    assert [c[1][0] for c in fake_db.named('mysql_create_database')] == \
        ['alice_wp']
    assert fake_db.named('mysql_restore')[0][1][0] == 'alice_wp'
    # Both users recreated with their preserved native hash.
    executed = ' ;; '.join(c[1][0] for c in fake_db.named('mysql_execute'))
    assert f"AS '{NATIVE_HASH}'" in executed
    assert {u['user'] for u in result['db_users']} == {'alice', 'alice_wp'}
    assert all(u['preserved_hash'] for u in result['db_users'])

    assert fake_cron == [{'schedule': '*/5 * * * *',
                          'command': '/usr/bin/php /home/alice/cron.php',
                          'name': f'import-{imp.id}'}]
    assert result['validated'] is True


def test_hestia_end_to_end_run(app, tmp_path, fake_db, fake_cron, apps_dir):
    from app.models import Application
    user = _admin_user(app)
    imp = _make_import(tmp_path, 'hestia', _build_hestia_tree,
                       HESTIA_WRAPPER, user_id=user.id)
    SiteImportService.analyze(imp)
    SiteImportService.run(imp)

    assert imp.status == 'completed'
    assert imp.error is None
    result = imp.get_result()
    application = Application.query.get(result['app_id'])
    assert application is not None
    assert application.name == 'example-com'
    assert application.php_version == '8.1'
    # Docroot came from the nested domain_data.tar.gz staging.
    assert os.path.isfile(os.path.join(application.root_path, 'index.php'))

    assert [c[1][0] for c in fake_db.named('mysql_create_database')] == \
        ['alice_db']
    assert fake_db.named('mysql_restore')[0][1][0] == 'alice_db'
    executed = ' ;; '.join(c[1][0] for c in fake_db.named('mysql_execute'))
    assert f"AS '{NATIVE_HASH}'" in executed
    assert result['db_users'] == [{'user': 'alice_db',
                                   'preserved_hash': True}]

    assert fake_cron == [{'schedule': '*/10 * * * *',
                          'command': 'php /home/alice/cron.php',
                          'name': f'import-{imp.id}'}]
    assert result['validated'] is True


def test_default_plan_step_keys_map_to_handlers(tmp_path):
    """Every step the default plan emits for these formats has a
    _step_<key> handler on the orchestrator."""
    da = _extracted_tree(tmp_path, _build_da_tree, DA_WRAPPER, 'da')
    hestia = _extracted_tree(tmp_path, _build_hestia_tree, HESTIA_WRAPPER,
                             'hestia')
    for fmt, tree in (('directadmin', da), ('hestia', hestia)):
        importer = get_importer(fmt)
        analysis = importer.analyze(tree)
        for step in importer.plan(analysis, {}):
            assert hasattr(SiteImportService, f"_step_{step['key']}"), \
                f"{fmt}: no handler for step {step['key']}"
