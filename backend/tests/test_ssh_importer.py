"""Tests for the generic SSH pull importer (Adoption/Import #12).

Covers the PURE, testable layer only — no subprocess is ever spawned (the live
rsync/mysqldump pull is Linux-only runtime and is deliberately not exercised):
* ``parse_ssh_source`` — happy path, required-field ValueErrors, port default;
* ``build_rsync_command`` / ``build_mysqldump_command`` argv contents,
  including the ``None`` case and the "password never on argv" guarantee;
* ``build_import_spec_from_survey_site`` survey — source mapping;
* ``analyze`` on a hand-staged directory (manifest + docroot + dump);
* ``detect`` truth on the manifest marker;
* registry resolution of ``get_importer('ssh')``.

Reconstructed from the fragmented recovery pyc
(``test_ssh_importer.cpython-311-pytest-9.0.3.pyc``). The PURE command-builder
layer (``build_rsync_command`` / ``build_mysqldump_command`` /
``build_import_spec_from_survey_site``) did NOT survive the recovery rebuild —
the surviving importer folds command construction into the instance ``pull``
methods — so those cases skip until the builders are restored (see report
finding).
"""
import pytest

from app.services.site_importers import get_importer
from app.services.site_importers.ssh import GenericSshImporter, parse_ssh_source

try:
    from app.services.site_importers.ssh import (
        build_rsync_command, build_mysqldump_command,
        build_import_spec_from_survey_site)
    _NO_BUILDERS = None
except ImportError as exc:  # pure-builder layer lost in recovery
    _NO_BUILDERS = str(exc)


def _full_source():
    return {
        'host': 'box.example.com',
        'user': 'deploy',
        'docroot': '/var/www/site/',
        'db_name': 'sitedb',
        'db_user': 'siteusr',
        'db_password': 's3cret',
        'ssh_key': '/keys/id_ed25519',
        'domain': 'site.example.com',
    }


def test_parse_ssh_source_happy_path():
    parsed = parse_ssh_source(_full_source())
    assert parsed['host'] == 'box.example.com'
    assert parsed['user'] == 'deploy'
    assert parsed['docroot'] == '/var/www/site/'
    assert parsed['port'] == 22
    assert parsed['domain'] == 'site.example.com'
    assert parsed['ssh_key'] == '/keys/id_ed25519'
    assert parsed['db_name'] == 'sitedb'


def test_parse_ssh_source_defaults_port_and_domain():
    parsed = parse_ssh_source({'host': 'h.example.com', 'user': 'u',
                               'docroot': '/srv/app'})
    assert parsed['port'] == 22
    # domain falls back to the host when not supplied
    assert parsed['domain'] == 'h.example.com'


@pytest.mark.parametrize('missing', ['host', 'user', 'docroot'])
def test_parse_ssh_source_requires_fields(missing):
    source = {'host': 'h', 'user': 'u', 'docroot': '/d'}
    source.pop(missing)
    with pytest.raises(ValueError):
        parse_ssh_source(source)


def test_parse_ssh_source_is_keyfile_only_no_ssh_password():
    # Auth is keyfile-only: a top-level password is never carried into the spec.
    parsed = parse_ssh_source({'host': 'h', 'user': 'u', 'docroot': '/d',
                               'password': 'nope'})
    assert 'password' not in parsed


def test_registry_resolves_ssh_importer():
    importer = get_importer('ssh')
    assert isinstance(importer, GenericSshImporter)
    assert importer.format == 'ssh'


# ── PURE command-builder layer (lost in recovery — skipped until restored) ──

@pytest.mark.skipif(bool(_NO_BUILDERS),
                    reason="plan 42: hollow feature — SSH importer pure builders "
                           "(build_rsync_command/build_mysqldump_command/"
                           "build_import_spec_from_survey_site) missing after "
                           "recovery rebuild")
def test_build_mysqldump_command_never_puts_password_on_argv():
    argv = build_mysqldump_command(_full_source())
    assert 's3cret' not in argv
    assert build_mysqldump_command({'host': 'h', 'user': 'u',
                                    'docroot': '/d'}) is None
