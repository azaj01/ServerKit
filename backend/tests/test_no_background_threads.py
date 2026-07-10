"""Regression gate for the "unguarded background writer" bug class.

create_app() must not spawn background threads under the testing config.
The app fixture is function-scoped, so any thread started per create_app()
call piles up one immortal copy per test — and if that thread writes to the
DB (analytics flush, metrics collection), the copies race the running test's
own transactions on the shared SQLite file and the suite fails with
intermittent "database is locked" errors in unrelated tests.

Background workers must either be gated on ``app.config['TESTING']`` (like
the queue-bus consumers) or started only by an explicit runtime trigger
(socket connect, API call), never as an unconditional create_app side effect.
"""
import threading


def _thread_ids():
    return {t.ident for t in threading.enumerate()}


def _is_allowed(thread):
    """Library-internal housekeeping we can't gate: flask-limiter's in-memory
    storage arms a threading.Timer to expire rate-limit events. Memory-only."""
    fn = getattr(thread, 'function', None)  # threading.Timer callback
    return getattr(fn, '__module__', '').startswith('limits.')


def test_create_app_testing_spawns_no_background_threads():
    from app import create_app, db

    before = _thread_ids()
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        try:
            # Exercise the request hooks too — a per-request spawn (analytics
            # buffers, audit trails) must also stay inert under testing.
            client = app.test_client()
            client.get('/api/v1/system/health')

            leaked = [t.name for t in threading.enumerate()
                      if t.ident not in before and not _is_allowed(t)]
            assert leaked == [], (
                f'create_app(testing) spawned background thread(s): {leaked}. '
                'Gate the spawn on app.config["TESTING"] (see the queue-bus '
                'consumers) so per-test app instances do not leak writers '
                'that race the suite\'s shared database.')
        finally:
            db.session.remove()
            db.drop_all()
