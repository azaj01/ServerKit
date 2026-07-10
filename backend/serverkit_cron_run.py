#!/usr/bin/env python3
"""Standalone entry for the cron-run shim.

Kept at the backend root (not under app/) so a tracked crontab line can invoke
it by absolute path without needing PYTHONPATH set: it puts its own directory on
sys.path and delegates to app.cron_runner.main().
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.cron_runner import main  # noqa: E402

if __name__ == '__main__':
    sys.exit(main())
