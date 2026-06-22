"""Tests for the unified job system (app/jobs)."""
import pytest

from app import db
from app.jobs import registry
from app.jobs.models import Job, ScheduledJob
from app.jobs.service import JobService, ScheduledJobService, GROUP_SLUG, QUEUE_SLUG
from app.jobs.consumer import JobConsumer
from app.jobs.scheduler import JobScheduler
from app.queue_bus.service import QueueBusService
from app.queue_bus.models import QueueMessage


@pytest.fixture(autouse=True)
def reset_jobs(app):
    """Clean broker + handler registry before each test (after create_app has
    registered the built-in handlers)."""
    QueueBusService.reset_broker()
    registry.clear()
    yield
    registry.clear()


def _drain_once(consumer=None):
    """Receive and process exactly one job message; return it processed."""
    consumer = consumer or JobConsumer()
    messages = QueueBusService.receive(GROUP_SLUG, QUEUE_SLUG, max_messages=1)
    assert messages, 'expected a queued job message'
    consumer.process_message(messages[0])
    return messages[0]


class TestEnqueueAndRun:
    def test_enqueue_creates_job_and_message(self, app):
        job = JobService.enqueue('test.noop', {'x': 1})
        assert job.id is not None
        assert job.status == Job.STATUS_PENDING
        assert Job.query.count() == 1
        # A thin {job_id} pointer is on the bus.
        msgs = QueueBusService.list_messages(GROUP_SLUG, QUEUE_SLUG)
        assert len(msgs) == 1
        assert msgs[0]['payload'] == {'job_id': job.id}

    def test_handler_runs_and_succeeds(self, app):
        seen = {}

        @registry.handler('test.ok')
        def _ok(job):
            seen['payload'] = job.get_payload()
            return {'done': True}

        job = JobService.enqueue('test.ok', {'x': 42})
        _drain_once()

        refreshed = Job.query.get(job.id)
        assert refreshed.status == Job.STATUS_SUCCEEDED
        assert refreshed.get_result() == {'done': True}
        assert refreshed.completed_at is not None
        assert seen['payload'] == {'x': 42}

    def test_unregistered_kind_fails_without_retrying(self, app):
        job = JobService.enqueue('test.no_handler', {}, max_attempts=3)
        msg = _drain_once()

        refreshed = Job.query.get(job.id)
        assert refreshed.status == Job.STATUS_FAILED
        assert 'No handler' in (refreshed.error_message or '')
        # Message completed (not left to retry an unroutable job).
        qm = QueueBusService.get_message(GROUP_SLUG, QUEUE_SLUG, msg['id'])
        assert qm['status'] == QueueMessage.STATUS_COMPLETED

    def test_failure_retries_then_dead_letters_to_failed(self, app):
        @registry.handler('test.boom')
        def _boom(job):
            raise RuntimeError('kaboom')

        # max_attempts=1 → the first failure exhausts attempts → dead-letter.
        job = JobService.enqueue('test.boom', {}, max_attempts=1)
        msg = _drain_once()

        refreshed = Job.query.get(job.id)
        assert refreshed.status == Job.STATUS_FAILED
        assert 'kaboom' in (refreshed.error_message or '')
        qm = QueueBusService.get_message(GROUP_SLUG, QUEUE_SLUG, msg['id'])
        assert qm['status'] == QueueMessage.STATUS_DEAD_LETTER

    def test_failure_with_attempts_left_stays_pending(self, app):
        @registry.handler('test.flaky')
        def _flaky(job):
            raise RuntimeError('again')

        job = JobService.enqueue('test.flaky', {}, max_attempts=3)
        _drain_once()

        refreshed = Job.query.get(job.id)
        # Not terminal yet — the queue will redeliver after backoff.
        assert refreshed.status == Job.STATUS_PENDING
        assert refreshed.status not in Job.TERMINAL_STATUSES or refreshed.status == Job.STATUS_PENDING


class TestCancelAndRetry:
    def test_cancel_prevents_execution(self, app):
        ran = {'count': 0}

        @registry.handler('test.cancelme')
        def _h(job):
            ran['count'] += 1

        job = JobService.enqueue('test.cancelme', {})
        JobService.cancel(job.id)
        assert Job.query.get(job.id).status == Job.STATUS_CANCELLED

        _drain_once()  # consumer should skip the cancelled job
        assert ran['count'] == 0
        assert Job.query.get(job.id).status == Job.STATUS_CANCELLED

    def test_retry_requeues_failed_job(self, app):
        job = JobService.enqueue('test.no_handler', {}, max_attempts=1)
        _drain_once()
        assert Job.query.get(job.id).status == Job.STATUS_FAILED

        # Now register a handler and retry.
        @registry.handler('test.no_handler')
        def _now_ok(job):
            return 'recovered'

        JobService.retry(job.id)
        assert Job.query.get(job.id).status == Job.STATUS_PENDING
        _drain_once()
        assert Job.query.get(job.id).status == Job.STATUS_SUCCEEDED
        assert Job.query.get(job.id).get_result() == 'recovered'


class TestScheduler:
    def test_ensure_is_idempotent(self, app):
        a = ScheduledJobService.ensure('nightly', 'test.x', interval_seconds=60)
        b = ScheduledJobService.ensure('nightly', 'test.x', interval_seconds=120)
        assert a.id == b.id
        assert ScheduledJob.query.count() == 1
        assert ScheduledJob.query.get(a.id).interval_seconds == 120

    def test_tick_fires_due_schedule_and_advances(self, app):
        # startup_delay 0 → next_run_at = now → immediately due.
        scheduled = ScheduledJobService.ensure(
            'due-now', 'test.tick', interval_seconds=3600, startup_delay_seconds=0)
        before = scheduled.next_run_at

        fired = JobScheduler().tick()
        assert fired == 1

        # A job was enqueued for the schedule, and next_run advanced past now.
        job = Job.query.filter_by(kind='test.tick').first()
        assert job is not None
        assert job.owner_type == 'schedule'
        assert job.owner_id == 'due-now'
        refreshed = ScheduledJob.query.get(scheduled.id)
        assert refreshed.next_run_at > before
        assert refreshed.last_job_id == job.id
        # No longer due.
        assert JobScheduler().tick() == 0

    def test_disabled_schedule_does_not_fire(self, app):
        scheduled = ScheduledJobService.ensure(
            'off', 'test.tick', interval_seconds=60, startup_delay_seconds=0)
        ScheduledJobService.set_enabled(scheduled.id, False)
        assert JobScheduler().tick() == 0


class TestBuiltins:
    def test_register_and_seed(self, app):
        from app.jobs import builtin_handlers
        builtin_handlers.register_builtin_handlers()
        kinds = registry.registered_kinds()
        assert 'builtin.auto_sync' in kinds
        assert 'builtin.health_check' in kinds
        assert len([k for k in kinds if k.startswith('builtin.')]) == 8

        builtin_handlers.seed_builtin_schedules()
        assert ScheduledJob.query.count() == 8
        # Seeding twice doesn't duplicate.
        builtin_handlers.seed_builtin_schedules()
        assert ScheduledJob.query.count() == 8


class TestApi:
    def test_list_and_get_via_api(self, client, auth_headers, app):
        job = JobService.enqueue('test.api', {'hello': 'world'})

        resp = client.get('/api/v1/jobs', headers=auth_headers)
        assert resp.status_code == 200
        assert any(j['id'] == job.id for j in resp.get_json()['jobs'])

        resp = client.get(f'/api/v1/jobs/{job.id}', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['job']['payload'] == {'hello': 'world'}

    def test_stats_endpoint(self, client, auth_headers, app):
        JobService.enqueue('test.api', {})
        resp = client.get('/api/v1/jobs/stats', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['total'] >= 1

    def test_cancel_via_api(self, client, auth_headers, app):
        job = JobService.enqueue('test.api', {})
        resp = client.post(f'/api/v1/jobs/{job.id}/cancel', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['job']['status'] == Job.STATUS_CANCELLED

    def test_scheduled_listing(self, client, auth_headers, app):
        ScheduledJobService.ensure('api-sched', 'test.x', interval_seconds=60)
        resp = client.get('/api/v1/jobs/scheduled', headers=auth_headers)
        assert resp.status_code == 200
        assert any(s['name'] == 'api-sched' for s in resp.get_json()['scheduled'])
