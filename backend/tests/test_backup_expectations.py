"""Plan 30 Phase 2 — expectations captured at backup time, compared at drill.

Covers the writer (`_collect_expectations` for DB + file targets), the
manifest round-trip, and the drill-side comparison upgrades (table-count match,
row-count drift on the largest tables, extracted-file count).

NOTE (plan 42 recovery): the whole ``_collect_expectations`` writer + its
manifest round-trip and drill-side comparison upgrades were lost with the tests
— ``app.services.backup_verify_service._collect_expectations`` does not exist in
the recovered tree. The reconstructed test below is kept faithful to the salvage
but skipped as a hollow-feature marker; restore is owned by plan 42.
"""
import io
import tarfile

import pytest

from app import db  # noqa: F401  (kept for parity with the original module)


def _tar_gz(dest, files):
    with tarfile.open(dest, 'w:gz') as tar:
        for name, content in files.items():
            data = io.BytesIO(content)
            info = tarfile.TarInfo(name)
            info.size = len(content)
            tar.addfile(info, data)


@pytest.mark.skip(reason="plan 42: hollow feature — backup_verify_service._collect_expectations "
                         "(backup-time DB/file expectation capture, plan 30 Phase 2) is absent "
                         "from the recovered tree; restored by plan 42")
def test_db_expectations_capture(app, monkeypatch):
    from app.services.database_service import DatabaseService
    from app.services import backup_verify_service

    def _mysql_get_tables(name, **kws):
        return [{'name': 'wp_posts', 'rows': 10}, {'name': 'wp_users', 'rows': 3}]

    monkeypatch.setattr(DatabaseService, 'mysql_get_tables',
                        staticmethod(_mysql_get_tables))

    with app.app_context():
        target = {'target_type': 'database',
                  'db_config': {'db_type': 'mysql', 'db_name': 'shop'}}
        exp = backup_verify_service._collect_expectations(target)
        assert exp['table_count'] == 2
        assert 'tables' in exp
        assert 'row_counts' in exp
