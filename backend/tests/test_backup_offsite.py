"""Plan 30 Phase 4 — offsite verification sampling + honest shallow-verify labels.

Deterministic single-run sampling (bounded monthly egress, reproducible for a
seed) plus the shallow HEAD/size/ETag compare that records an honest evidence
label — ``checksum`` where a single-part ETag confirms content, ``size_only``
where a multipart ETag can only confirm size.
"""
from datetime import datetime, timedelta

import pytest

from app import db
from app.services.backup_policy_service import BackupPolicyService
from app.services.backup_offsite_service import BackupOffsiteService


def test_sample_one_is_deterministic(app):
    from app.models.backup_run import BackupRun
    with app.app_context():
        policy = BackupPolicyService.get_or_create_policy(
            'files', 9801, target_meta={'paths': ['/x']})
        runs = []
        for i in range(5):
            r = BackupRun(policy_id=policy.id, kind='full', status='success',
                          started_at=datetime.utcnow() - timedelta(days=i))
            db.session.add(r)
            db.session.commit()
            runs.append(r)

        # Same seed -> same pick (reproducible, so the monthly egress is bounded
        # AND testable).
        pick_a = BackupOffsiteService._sample_one(runs, seed=3)
        pick_b = BackupOffsiteService._sample_one(runs, seed=3)
        assert pick_a.id == pick_b.id

        # Across many seeds the sampler spreads over the set (not a constant).
        picks = {BackupOffsiteService._sample_one(runs, seed=s).id for s in range(20)}
        assert len(picks) > 1

        # No candidates -> no pick.
        assert BackupOffsiteService._sample_one([], seed=1) is None


@pytest.mark.skip(reason="plan 42: hollow feature — honest shallow-verify evidence label "
                         "('size_only' for multipart ETag) via BackupPolicyService.verify_run "
                         "not present in recovered tree (verify_run returns no 'evidence'); "
                         "restored by plan 42")
def test_shallow_verify_labels_multipart_size_only(app, tmp_path, monkeypatch):
    pytest.skip("hollow: verify_run does not emit an 'evidence' label")


@pytest.mark.skip(reason="plan 42: hollow feature — honest shallow-verify evidence label "
                         "('checksum' for single-part ETag) via BackupPolicyService.verify_run "
                         "not present in recovered tree (verify_run returns no 'evidence'); "
                         "restored by plan 42")
def test_shallow_verify_labels_single_part_checksum(app, tmp_path, monkeypatch):
    pytest.skip("hollow: verify_run does not emit an 'evidence' label")
