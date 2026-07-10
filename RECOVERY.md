# ServerKit — data-loss recovery record (2026-07-07)

This repository was reconstructed after an accidental `rm -rf` (a staging test
run from the wrong directory) deleted the working tree **and** `.git`. This file
documents exactly what was recovered, from where, and what could not be
restored — so the history and code can be trusted for what they are.

## Sources

| Source | Date | Role |
|--------|------|------|
| GitHub `origin/dev` | 2026-07-04 (`07baefb`) | **Full commit history — 1,130 commits.** The baseline everything sits on. |
| VSS shadow copy | 2026-07-06 22:49 | Working tree; ~half its files were corrupted (zeroed blocks). Held 14 recoverable loose commit objects (plans 29–31). |
| File-undelete (winfr) | deleted 2026-07-07 | Frontend/docs/scripts — current (July-7), mostly clean. No `.py`, no git. |
| winfr `/extensive` | — | 18k files; 0 real `.py`, no git data. Ruled out. |

## What was recovered

- **Git history through 2026-07-04** — intact and complete (1,130 commits).
- **Frontend** — current (July-7 from the undelete, verified clean).
- **Backend** — CLEAN recovered files were applied; the many that the shadow
  backup had **corrupted (zeroed) fell back to their July-4 baseline version.**
  So a large part of the backend is at July-4, not July-6/7.
- **14 original commit objects** (July-6, plans 29–31) preserved as reference
  (see `docs/RECOVERED_COMMITS.txt`).

## What was LOST (unrecoverable — the git objects were destroyed everywhere)

- The discrete commits for plans ~32–36 (July-6 night → July-7, ending
  `bea4373`) — code partly reconstructed, original commit granularity gone.
- **New July-5–7 backend files that the shadow corrupted, with no July-4
  fallback, were dropped**, including: `dns_cutover*`, `fleet_doctor*` /
  `fleet_repair`, `survey_service`, `backup_drill_service`, `chat_webhook_service`,
  `setup_health_service` / `setup_reconcile_service`, `security_policy_service`,
  `cron_run_service`, migrations 056–068, `cloudflare.py` /
  `cloudflare_service.py`, and their tests. These features must be re-done.
- Backend files that changed July-5–7 but were corrupt in the backup now show
  their **July-4** content (their recent edits are lost).

## History layout

- `07baefb` (July-4) and earlier — **real GitHub history, untouched.**
- ~14 commits above it — **reconstruction**: grouped by plan (keyword-matched,
  best-effort messages) + a catch-all. These are approximate, built only from
  the CLEAN recovered files; corrupt/lost content is NOT in them.
- Tag `recovery-blob` — an earlier single-commit snapshot (pre-cleanup; ignore).

## ⚠️ Before trusting this repo

Run the test suites — they will surface anything that reverted to July-4 or is
missing, so you know what to re-do:

```sh
cd frontend && npm install && npm run lint && npm run build
cd backend  && python -m venv venv && source venv/bin/activate \
            && pip install -r requirements.txt && pytest
```

Raw recovered data is preserved on `D:\` (the shadow copy under
`ServerKit_RECOVERED`, undelete output under `SK_Recovery` / `SK_ext`) until you
confirm this repo is good.
