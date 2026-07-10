# Fleet Contract — "runs where?" answered once

> Status: LIVE (plan 26, Fleet Parity Sweep).
> Audience: anyone adding a panel feature that could touch more than the
> primary host. Cite this instead of re-deciding fleet-awareness ad hoc.

ServerKit manages a *fleet* of servers: the panel host plus any number of
connected agents (the Go agent under `agent/`, reached over the Socket.IO
`/agent` gateway or the HTTP long-poll fallback). Historically most panel
features assumed a single host, and each new feature re-decided — usually
implicitly — whether it was fleet-aware. This document is the written
contract so that decision is made once, on purpose.

If you are onboarding a feature to the fleet, skip to
[the checklist](#onboarding-a-feature-to-the-fleet).

---

## The six rules (locked)

These are the load-bearing decisions every fleet feature inherits.

1. **Address by `server_id`, always.** A job that targets a server sets
   `owner_type='server'`, `owner_id=<server_id>`, and repeats the id in
   `payload.server_id` (the manifest precedent). UI surfaces select a
   target with `TargetPicker`, which emits `{kind:'agent', server_id, …}`.
   The panel host itself is addressed as `server_id=None`/`'local'`.

2. **Capability-gate, never error.** Every fleet feature names a capability
   string (e.g. `docker`, `systemd.restart`, `doctor.probe`). An agent that
   doesn't advertise it is shown/recorded as **`unsupported on this agent`**
   (a skipped status) — never an error, never a crash. Older agents keep
   working forever. Check with `agent_registry.has_capability(server_id,
   feature)`; the `TargetPicker` filters non-capable agents out of the list.

3. **Per-server results are ROWS, not blobs.** New fleet result tables key
   by `(server_id, check_key)` (see `FleetDoctorResult`). The legacy
   panel-host blob (e.g. the `doctor_last_report` settings key) stays for
   compatibility; the API/UI merges the two. Never widen a per-host blob
   into an ad-hoc `{server_id: …}` map — add rows.

4. **Sweeps are jobs with a budget.** Fan-out over agents happens **inside
   job handlers only**, never on a request thread — the gateway registry is
   single-worker and in-memory (see `CLAUDE.md`, `docs/ARCHITECTURE.md`,
   `SECURITY.md`). Use the one primitive: `fleet_sweep()` in
   `app/services/fleet_sweep.py`. It gives you a bounded pool (≤4 concurrent
   agents by default), a per-agent timeout, and a hard wall-clock budget. A
   slow or hung agent yields a `timeout` result row, not a stalled panel.

5. **Compose from today's commands first.** Prefer composing a feature from
   the commands every already-deployed agent understands
   (`systemd:status`, `system:metrics`, registry/heartbeat data) so it works
   on the whole fleet on day one. Add a new batched agent command only as a
   capability-gated *optimisation* the panel negotiates to when present, with
   the composed path as the permanent fallback. The worked example is the
   doctor: v1 composes `systemd:status` + `system:metrics`; v2 prefers a single
   `doctor:probe` round trip when the agent advertises `doctor.probe`, and
   falls back to the composed calls if the probe errors — both paths emit
   identical rows. Full spec + negotiation code in
   [`docs/AGENT_DOCTOR_PROBE_SPEC.md`](AGENT_DOCTOR_PROBE_SPEC.md). The
   read-only Observe-mode survey (`survey:read`, capability `survey`) follows the
   same shape — a catalog of read-only primitives the agent enforces, gated by
   `survey:read` + the `survey` capability, degrading to "unsupported" on old
   agents. Full contract in
   [`docs/AGENT_SURVEY_SPEC.md`](AGENT_SURVEY_SPEC.md).

6. **Remote mutations are allowlisted + audited.** Anything that changes
   state on a remote box goes through an explicit allowlist that maps the
   operation → agent command + required permission scope + required
   capability. Anything not on the allowlist is refused server-side. Every
   remote mutation writes an `AuditService.log(...)` entry. The v1 repair
   allowlist is **service restart only** (`fleet.service` →
   `systemd:restart`).

---

## Capability classes × runs-where

Each panel capability falls into one of these classes. The class dictates
where it runs and how results aggregate.

| Class | Runs where | Aggregation | Addressing |
|---|---|---|---|
| **Host probe** (read a fact about a box: is nginx up, disk headroom, agent version) | Per-agent when connected; panel-side for facts the panel already knows (heartbeat age, version-vs-latest, DNS resolution) | Rows keyed `(server_id, check_key)`; UI shows an "All servers" rollup + per-server drill-down | `server_id` |
| **Config write** (write a managed file / restart a unit) | Per-agent, allowlisted + audited (rule 6) | Per-item repair result rows | `server_id` + permission scope + capability |
| **Scheduled sweep** (run a probe across the fleet on a cadence) | Job handler only, via `fleet_sweep()` (rule 4) | Rows; the schedule piggybacks an existing cadence where possible | iterate connected/fleet servers |
| **Metric collection** (CPU/mem/disk time-series) | Per-agent → `ServerMetrics` rows on every heartbeat | Existing rows; FleetMonitor reads them | `server_id` |
| **UI surface** (a page/panel) | Panel; zero-agent installs see no fleet chrome at all; single-box view is unchanged | Consumes the rollup + rows | `TargetPicker` |

**Panel-scoped by design** (do *not* fan these out): anything that is a
property of the control plane itself — the panel's own DB, the panel's
canonical domain, org-wide setup items. Setup-health items carry a `scope`
field (`panel` | `per-server`) precisely so this stays explicit (plan 22 /
plan 26 #15).

---

## Addressing conventions

- **A connected agent:** `server_id` = the `Server.id` UUID. Enumerate live
  agents with `agent_registry.get_connected_servers()`, map back with
  `Server.query.get(server_id)`, read live capabilities with
  `agent_registry.get_capabilities(server_id)`.
- **The panel host:** `server_id` is `None` or the literal `'local'`. Remote
  services (`remote_docker_service`, etc.) treat `not server_id or server_id
  == 'local'` as "run the local service".
- **A server-targeted job:** `owner_type='server'`, `owner_id=server_id`,
  `payload={'server_id': server_id, …}`.
- **A fleet-wide sweep job:** no single server; the handler enumerates and
  calls `fleet_sweep()`.

---

## The sweep primitive

`app/services/fleet_sweep.py`:

```python
from app.services.fleet_sweep import fleet_sweep

def compose(server_id, per_agent_timeout):
    # runs on a worker thread, inside an app context; may send_command + query DB
    caps = agent_registry.get_capabilities(server_id) or {}
    if not caps.get('systemd'):
        return {'status': 'unsupported', 'checks': []}
    res = agent_registry.send_command(server_id, 'systemd:status',
                                      {'unit': 'nginx'}, timeout=per_agent_timeout)
    ...
    return {'status': 'ok', 'checks': [...]}

results = fleet_sweep(compose, servers, pool=4, per_agent_timeout=15, budget=90)
# results == {server_id: {'status': 'ok'|'failed'|'offline'|'unsupported'|'timeout', ...}}
```

- Every row carries a `status` from `ok`/`failed`/`offline`/`unsupported`/`timeout`.
- A composer exception → `failed`. A budget overrun → `timeout`. Neither
  raises out of the sweep.
- The composer runs inside a Flask app context (the helper pushes one per
  worker) so it may query the DB and the registry freely.
- **Never call `fleet_sweep()` from a request handler** — only from a job.

---

## Onboarding a feature to the fleet

A short checklist. If you can answer all of these, the feature is contract-compliant.

1. **Which capability class is it?** (host probe / config write / sweep /
   metric / UI). That fixes where it runs and how it aggregates.
2. **What capability string does it require?** Gate on it with
   `agent_registry.has_capability`; agents without it record `unsupported`.
3. **Does it read or write?** A write must be on an allowlist (rule 6): map
   operation → agent command + permission scope + capability, refuse
   anything else server-side, and audit-log every call.
4. **Does it fan out?** Then it is a job (rule 4). Use `fleet_sweep()`, pick
   a pool/timeout/budget, and piggyback an existing schedule cadence if one
   fits.
5. **How do results aggregate?** Rows keyed `(server_id, check_key)`, merged
   with any legacy panel blob (rule 3). The UI gets an "All servers" rollup +
   per-server drill-down; a zero-agent install must look exactly as it did
   before.
6. **Can it be composed from today's commands?** Prefer that (rule 5). If a
   new agent command genuinely pays for itself, ship it capability-gated with
   the composed path as the permanent fallback.
7. **Update the parity ledger below** with the feature's today-state + verdict.

---

## Parity ledger (Appendix A — living)

Where each capability stands. Update the verdict when you move the line.
Snapshot baseline: 2026-07-05 (Cron/Doctor/Survey rows moved 2026-07-06,
plan 28 — the agent v2 capability pack lit up the batched doctor probe,
the read-only survey, and in-place remote cron edit on agent ≥1.2.0).

| Capability | Fleet story today | Verdict |
|---|---|---|
| Metrics/heartbeat | per-agent → `ServerMetrics` rows, FleetMonitor | fleet-aware |
| Docker ops | `remote_docker_service`, full command set | fleet-aware |
| Cron | `remote_cron_service` — status/list/add/update/remove/toggle; in-place edit via `cron:update` (capability `cron.update`, agent ≥1.2.0); no run-now op yet | fleet-aware (edit shipped; run-now open) |
| Files | `remote_file_service` (allowed_paths-gated) | fleet-aware |
| Systemd | read (list/status/logs); restart is capability-gated `systemd.restart` | read + gated restart |
| Packages/runtimes | full remote support | fleet-aware |
| Terminal | remote via gateway (WS only) | fleet-aware |
| WireGuard/tunnels | pairing + publish rails | fleet-aware |
| Agent upgrades | staged rollouts, offline queue | fleet-aware |
| **Doctor** | **fleet sweep: services/disk/agent-freshness/site-DNS per server; DNS compares each box's IP. Per-server DNS is bounded to 10 domains/sweep but the checked window ROTATES per sweep (persistent counter) so all domains are eventually verified (plan 31 #13). Batched `doctor:probe` path lit up by agent ≥1.2.0 (capability `doctor.probe`), else composed v1 fallback** | **fleet-aware (v1 + gated v2 probe)** |
| Survey / Observe | read-only `survey:read` executor shipped in agent ≥1.2.0 (capability `survey`); fixed primitive allowlist, catalog-as-untrusted-input; degrades to "unsupported" on older agents | fleet-aware (agent ≥1.2.0) |
| Drift | panel-local file checks | deferred (templates — `ServerTemplates` owns config compliance) |
| Backups | policies execute on panel host only | deferred (plan 23) |
| Setup health | `scope` field: panel items panel-scoped, per-server items evaluated in the fleet sweep | fleet-aware (per-server hook) |
| Proxy stacks | per-server via FleetProxy UI | partial by design |
| Manifest apply | `server:` targeting resolves id; remote dispatch deferred | partial (plan 17) |
| Mail live delivery | preflight shipped; runbook `docs/runbooks/mail-live-delivery.md` | see runbook |
| Remote access multi-host | shipped; runbook `docs/runbooks/remote-access-two-host.md` | see runbook |

### Explicitly out of scope (marked so nobody re-opens them ad hoc)

- **Fleet drift / config compliance** — config-template territory;
  `ServerTemplates` owns it.
- **Cross-server backups / DR restores** — deferred (plan 23).
- **Workspace scoping of servers/fleet surfaces** — fleet stays admin (plan 19).
- **Gateway horizontal scaling** — the single-worker constraint stands
  (a `HORIZONTAL_SCALING_SPEC` exists; explicitly not adopted).
- **Streaming over the long-poll transport** — by design; sweeps are
  request/response only.
