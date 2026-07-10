"""Cron run ingest + history + failure alerts.

Records the runs reported by the ``serverkit-cron-run`` shim, exposes run
history / success-rate for the UI, and fires edge-triggered failure/recovery
notifications (Decision: transition-based like environment-health, never a
cooldown timer).
"""
from datetime import datetime

from app import db
from app.models.cron_run import (
    CronRun,
    OUTPUT_TAIL_LIMIT,
    STATUS_SUCCESS,
    STATUS_FAILURE,
)


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if dt.tzinfo is not None:
            dt = dt.astimezone(tz=None).replace(tzinfo=None)
        return dt
    except (ValueError, TypeError):
        return None


class CronRunService:
    """Stateless helpers over the CronRun table."""

    @staticmethod
    def _last_status(job_id):
        """Status of the most recent completed run for a job, or None."""
        last = (CronRun.query
                .filter_by(job_id=job_id)
                .order_by(CronRun.id.desc())
                .first())
        return last.status if last else None

    @classmethod
    def record_run(cls, job_id, started_at=None, finished_at=None,
                   exit_code=None, output_tail=None):
        """Insert a completed run. Returns (run, transition) where transition is
        'failure' (fresh failure edge), 'recovery' (fresh success-after-failure
        edge), or None (no status change / first-ever success)."""
        prev = cls._last_status(job_id)
        status = STATUS_SUCCESS if exit_code == 0 else STATUS_FAILURE

        tail = output_tail or ''
        if len(tail) > OUTPUT_TAIL_LIMIT:
            tail = tail[-OUTPUT_TAIL_LIMIT:]

        run = CronRun(
            job_id=job_id,
            started_at=_parse_dt(started_at),
            finished_at=_parse_dt(finished_at) or datetime.utcnow(),
            exit_code=exit_code,
            status=status,
            output_tail=tail or None,
        )
        db.session.add(run)
        db.session.commit()

        transition = None
        if status == STATUS_FAILURE and prev != STATUS_FAILURE:
            transition = 'failure'
        elif status == STATUS_SUCCESS and prev == STATUS_FAILURE:
            transition = 'recovery'
        return run, transition

    @staticmethod
    def recent_runs(job_id, limit=10):
        runs = (CronRun.query
                .filter_by(job_id=job_id)
                .order_by(CronRun.id.desc())
                .limit(limit)
                .all())
        return [r.to_dict() for r in runs]

    @staticmethod
    def stats(job_id, window=20):
        """Success-rate over the last `window` runs + the last run summary."""
        runs = (CronRun.query
                .filter_by(job_id=job_id)
                .order_by(CronRun.id.desc())
                .limit(window)
                .all())
        total = len(runs)
        if not total:
            return {
                'total': 0,
                'success': 0,
                'failure': 0,
                'success_rate': None,
                'last_status': None,
                'last_run': None,
            }
        success = sum(1 for r in runs if r.status == STATUS_SUCCESS)
        last = runs[0]
        return {
            'total': total,
            'success': success,
            'failure': total - success,
            'success_rate': round(success / total, 3),
            'last_status': last.status,
            'last_run': last.finished_at.isoformat() if last.finished_at else None,
        }
