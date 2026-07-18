"""Rollups + retention for serverkit-analytics.

* :func:`run_retention_prune` — drop raw ``event`` rows older than
  ``raw_retention_days`` and ``daily`` rollups older than
  ``rollup_retention_months``. Implemented in Phase 1 (operates on the event
  table that exists from Phase 1; the daily table is pruned harmlessly while
  empty until Phase 2 populates it).
* :func:`run_rollup` — aggregate raw events into the daily table. Implemented in
  Phase 2.

Both are called by the scheduled jobs in ``jobs.py`` and must be safe to call
repeatedly (idempotent) and outside a request context (they open their own
session via the shared ``db``).
"""
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


def run_retention_prune():
    """Delete raw events + rollups past their retention windows. Idempotent."""
    from app import db
    from .config import cfg_int
    from .models import AnalyticsEvent, AnalyticsDaily

    raw_days = cfg_int('raw_retention_days', minimum=1, maximum=3650)
    rollup_months = cfg_int('rollup_retention_months', minimum=1, maximum=120)

    event_cutoff = datetime.utcnow() - timedelta(days=raw_days)
    daily_cutoff = (datetime.utcnow() - timedelta(days=rollup_months * 31)).date()

    deleted_events = (AnalyticsEvent.query
                      .filter(AnalyticsEvent.ts < event_cutoff)
                      .delete(synchronize_session=False))
    deleted_daily = (AnalyticsDaily.query
                     .filter(AnalyticsDaily.date < daily_cutoff)
                     .delete(synchronize_session=False))
    db.session.commit()

    return {
        'deleted_events': int(deleted_events or 0),
        'deleted_daily': int(deleted_daily or 0),
        'event_cutoff': event_cutoff.isoformat(),
        'daily_cutoff': daily_cutoff.isoformat(),
    }


def run_rollup():
    """Aggregate raw events into the daily rollup table. Filled in Phase 2."""
    return {'skipped': True, 'reason': 'rollup implemented in Phase 2'}
