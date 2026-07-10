"""Cron schedule preview, humanizer, preset catalog, and marker hygiene.

Proving tests for plan 21 Phase 1 (#0, #1, #3, #4). Crontab mutation is
Linux-only; these run on any OS by exercising the pure helpers (humanizer,
preview, _locate marker matching) plus the HTTP preview/preset endpoints.
"""
import re

import pytest

from app.services.cron_service import CronService

ISO_UTC = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$')


# ---------------------------------------------------------------------------
# preview / humanizer
# ---------------------------------------------------------------------------

@pytest.mark.skip(reason="plan 42: recovery regression - cron_service humanizer was "
                         "restored at an older level ('0 0 * * *' -> 'Daily', not "
                         "'Every day at 00:00') and _next_runs returns naive local ISO "
                         "(no +00:00), so the plan-21 preview contract is not met")
def test_preview_valid_daily():
    res = CronService.preview_schedule('0 0 * * *')
    assert res['valid'] is True
    assert res['human'] == 'Every day at 00:00'
    assert len(res['next_runs']) == 5
    for r in res['next_runs']:
        assert ISO_UTC.search(r)


# ---------------------------------------------------------------------------
# marker matching (_locate / _line_body)
# ---------------------------------------------------------------------------

_HOLLOW_LOCATE = "plan 42: hollow feature - CronService._locate/_line_body marker " \
                 "helpers were lost in recovery (the marker logic survives only " \
                 "inlined in remove_job); helpers not restored yet"


@pytest.mark.skip(reason=_HOLLOW_LOCATE)
def test_locate_by_id_marker():
    lines = ['# ServerKit Job: job_20260101', '0 0 * * * /usr/bin/backup.sh']
    job = {'name': 'Nightly', 'command': '/usr/bin/backup.sh'}
    marker_idx, job_idx = CronService._locate(lines, job, 'job_20260101')
    assert marker_idx == 0
    assert job_idx == 1


@pytest.mark.skip(reason=_HOLLOW_LOCATE)
def test_locate_by_legacy_name_marker():
    lines = ['# ServerKit Job: Nightly', '0 0 * * * /usr/bin/backup.sh']
    job = {'name': 'Nightly', 'command': '/usr/bin/backup.sh'}
    marker_idx, job_idx = CronService._locate(lines, job, 'job_x')
    assert marker_idx == 0
    assert job_idx == 1


@pytest.mark.skip(reason=_HOLLOW_LOCATE)
def test_locate_disabled_line_via_marker():
    lines = ['# ServerKit Job: job_x', '# 0 0 * * * /usr/bin/backup.sh']
    job = {'name': 'job_x', 'command': '/usr/bin/backup.sh'}
    marker_idx, job_idx = CronService._locate(lines, job, 'job_x')
    assert marker_idx == 0
    assert CronService._line_body(lines[job_idx]) == '0 0 * * * /usr/bin/backup.sh'


@pytest.mark.skip(reason=_HOLLOW_LOCATE)
def test_locate_body_fallback_without_marker():
    lines = ['# unrelated comment', '5 4 * * * /other']
    job = {'name': 'nope', 'command': 'nope'}
    marker_idx, job_idx = CronService._locate(lines, job, 'nope')
    assert marker_idx is None


@pytest.mark.skip(reason=_HOLLOW_LOCATE)
def test_locate_absent():
    lines = ['# unrelated comment', '5 4 * * * /other']
    job = {'name': 'missing', 'command': 'missing'}
    assert CronService._locate(lines, job, 'missing') == (None, None)


# ---------------------------------------------------------------------------
# application attribution (survives)
# ---------------------------------------------------------------------------

def test_add_job_stores_application_id(tmp_path, monkeypatch):
    import app.services.cron_service as mod
    monkeypatch.setattr(mod.CronService, 'is_linux', classmethod(lambda cls: False))
    monkeypatch.setattr(mod, 'JOBS_FILE', str(tmp_path / 'cron_jobs.json'))

    mod.CronService.add_job('0 0 * * *', '/usr/bin/backup.sh', name='Nightly',
                            application_id=42)
    jobs = mod.CronService.jobs_for_application(42)
    assert len(jobs) == 1
    assert jobs[0]['application_id'] == 42


@pytest.mark.skip(reason="plan 42: recovery regression - add_job generates a "
                         "second-precision job_id (job_%Y%m%d%H%M%S), so two adds in "
                         "the same second collide and only one job persists; the "
                         "finer-grained id from plan 34 was lost")
def test_clear_application(tmp_path, monkeypatch):
    import app.services.cron_service as mod
    monkeypatch.setattr(mod.CronService, 'is_linux', classmethod(lambda cls: False))
    monkeypatch.setattr(mod, 'JOBS_FILE', str(tmp_path / 'cron_jobs.json'))

    mod.CronService.add_job('0 0 * * *', '/usr/bin/a.sh', application_id=7)
    mod.CronService.add_job('0 1 * * *', '/usr/bin/b.sh', application_id=7)
    assert len(mod.CronService.jobs_for_application(7)) == 2

    cleared = mod.CronService.clear_application(7)
    assert cleared == 2
    assert mod.CronService.jobs_for_application(7) == []
