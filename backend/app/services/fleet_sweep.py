"""Bounded fan-out over connected agents — the one primitive every fleet
sweep reuses (Fleet Parity Sweep, plan 26, Decision 4).

A "sweep" runs the same per-server probe across every targeted server, with a
bounded worker pool, a per-agent timeout, and a hard wall-clock budget so a
single slow (or hung) agent can never stall the panel. A server that doesn't
finish inside the budget yields a ``timeout`` result row — a partial result,
never a blocked request thread.

Invariants this enforces so callers don't have to:

* **Runs off the request thread only.** The gateway registry is single-worker
  and in-memory (CLAUDE.md / ARCHITECTURE / SECURITY), so fan-out must happen
  inside a job handler, never inline in a request. This helper spins its own
  bounded pool; call it from a job.
* **App context per worker.** Worker threads don't inherit the Flask app
  context, so each ``action_composer`` call is wrapped in one — composers may
  freely query the DB / registry.
* **Statuses are uniform.** Every result dict carries a ``status`` of
  ``ok`` / ``failed`` / ``offline`` / ``unsupported`` / ``timeout`` so the
  aggregating layer (fleet doctor, KPIs) treats every sweep the same.

See ``docs/FLEET_CONTRACT.md`` for the surrounding contract.
"""
import concurrent.futures
import logging
import time

from flask import current_app

logger = logging.getLogger(__name__)

# Conservative defaults — the single-worker constraint means a sweep competes
# with live agent traffic, so keep the pool small and the budget finite.
DEFAULT_POOL = 4
DEFAULT_PER_AGENT_TIMEOUT = 20.0
DEFAULT_BUDGET = 90.0

# The uniform status vocabulary a composer may return (Decision 2). Anything a
# composer returns without a 'status' key defaults to 'ok'; exceptions and
# budget overruns are mapped here by the helper itself.
SWEEP_STATUSES = ('ok', 'failed', 'offline', 'unsupported', 'timeout')


def _run_one(app, composer, server_id, per_agent_timeout):
    """Invoke ``composer(server_id, per_agent_timeout)`` inside an app context,
    normalising its return value / exceptions into a status-bearing dict."""
    try:
        with app.app_context():
            res = composer(server_id, per_agent_timeout)
    except Exception as exc:  # noqa: BLE001 — one bad agent must not sink the sweep
        logger.warning("fleet_sweep composer failed for %s: %s", server_id, exc)
        return {'status': 'failed', 'error': str(exc)}
    if not isinstance(res, dict):
        return {'status': 'failed', 'error': 'composer returned a non-dict result'}
    res.setdefault('status', 'ok')
    return res


def fleet_sweep(action_composer, servers, pool=DEFAULT_POOL,
                per_agent_timeout=DEFAULT_PER_AGENT_TIMEOUT, budget=DEFAULT_BUDGET):
    """Run ``action_composer`` across ``servers`` with a bounded pool + budget.

    Args:
        action_composer: ``callable(server_id: str, per_agent_timeout: float)``
            returning a dict. Runs on a worker thread inside an app context; may
            call ``agent_registry.send_command`` and query the DB. Should set a
            ``status`` from :data:`SWEEP_STATUSES` (defaults to ``ok``). Should
            use ``per_agent_timeout`` as the ceiling for any ``send_command`` it
            issues so the per-agent bound is honoured end-to-end.
        servers: iterable of server-id strings, or objects exposing ``.id``.
        pool: max agents probed concurrently (kept small — single-worker panel).
        per_agent_timeout: ceiling passed to each composer for its remote calls.
        budget: hard wall-clock ceiling for the whole sweep, in seconds. Agents
            that haven't produced a result by then get a ``timeout`` row.

    Returns:
        ``{server_id: result_dict}`` — one row per input server, always. Rows
        never raise: a composer exception → ``failed``; budget overrun →
        ``timeout``.
    """
    ids = []
    for s in servers:
        ids.append(s.id if hasattr(s, 'id') else s)
    # De-dupe while preserving order (a caller may pass overlapping lists).
    seen = set()
    ids = [sid for sid in ids if not (sid in seen or seen.add(sid))]

    results = {}
    if not ids:
        return results

    app = current_app._get_current_object()
    # NOT used as a context manager on purpose: ThreadPoolExecutor.__exit__
    # calls shutdown(wait=True), which would block the caller until a hung
    # composer finishes — exactly the stall the budget exists to prevent. We
    # shut down with wait=False so a slow agent's worker is abandoned (it holds
    # only a bounded send_command, which times out on its own) and the panel
    # returns immediately with a partial result set.
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, int(pool)))
    try:
        futures = {
            executor.submit(_run_one, app, action_composer, sid, per_agent_timeout): sid
            for sid in ids
        }
        try:
            for future in concurrent.futures.as_completed(futures, timeout=budget):
                sid = futures[future]
                try:
                    results[sid] = future.result()
                except Exception as exc:  # noqa: BLE001 — belt & suspenders
                    logger.warning("fleet_sweep future errored for %s: %s", sid, exc)
                    results[sid] = {'status': 'failed', 'error': str(exc)}
        except concurrent.futures.TimeoutError:
            # Wall-clock budget hit — everything still pending becomes a partial
            # 'timeout' row so the panel gets a bounded, complete result set.
            logger.warning(
                "fleet_sweep hit its %.0fs wall-clock budget with %d/%d agents done",
                budget, len(results), len(ids),
            )
        for future, sid in futures.items():
            if sid not in results:
                future.cancel()
                results[sid] = {
                    'status': 'timeout',
                    'error': 'agent did not respond within the sweep budget',
                }
    finally:
        # Reap finished threads; don't wait on the abandoned slow one.
        executor.shutdown(wait=False, cancel_futures=True)
    return results
