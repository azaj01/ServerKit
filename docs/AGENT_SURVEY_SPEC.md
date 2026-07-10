# Agent survey executor — `survey:read` (read-only "flight")

> Status: SPEC (plan 27 Phase 2). The panel side is implemented (catalog,
> dispatch, normalization, snapshots, diff, API). The agent-side executor lands
> in the Go agent component (`agent/`, not in this checkout) and reaches boxes
> via the AgentVersion / staged-rollout rails, capability-gated. This document
> is the contract between the two.

Observe mode's heart is a **read-only survey**: install the agent on any Linux
box — including one still managed by another control panel — and it flies a
single pass that answers "what is running here, and what serves what?" without
touching anything. The panel ships a declarative **probe catalog**, sends it per
run, and stores the returned **Server Map** as an immutable snapshot.

## Trust boundary — the agent enforces it, not the panel (Decision 2)

This is the load-bearing security property. The panel is UNTRUSTED for the
purposes of the survey: a compromised panel must not be able to make the agent
execute arbitrary work or exfiltrate secrets.

- The agent implements a **FIXED allowlist of read-only primitives**. Catalog
  entries can only *combine* those primitives; a catalog can never name a shell
  command, a binary to run, or a file whose *contents* leave the box wholesale.
- The allowed primitives are exactly:
  1. **file-exists** — does a path exist (and is it a file/dir)?
  2. **glob** — expand a shell glob to a list of paths.
  3. **parse-light** — read a text file and extract only whitelisted directive
     lines (e.g. `server_name`, `root`, `proxy_pass`, `ServerName`,
     `DocumentRoot`, `ProxyPass`, cron schedule lines). Never returns the whole
     file; never returns comments or secrets.
  4. **unit-status** — is a systemd unit active? (`ActiveState` only.)
  5. **socket-list** — listening sockets → `{port, proto, process-name}` (the
     process *name*, never its full command line or environment).
  6. **process-list** — running process names (names only).
  7. **cert-meta** — for a cert path, the subject/SAN domains and `notAfter`
     expiry. Private keys are **never** read.
- **Env / credential files are listed by PATH ONLY, never read.** No file
  contents leave the box beyond the parse-light directive extractions above.
- If a catalog entry asks for anything outside this set, the agent MUST refuse
  that entry (skip it, note it) rather than execute it.

Panel-side, dispatch is gated by the `survey:read` permission scope (enforced by
`send_command` before it reaches the agent) plus the `survey` capability. Old
agents that never advertise `survey` degrade cleanly to "unsupported" (rule 2) —
they are never errored.

## Capability advertised

```json
{ "capabilities": { "survey": true } }
```

## `survey:read` (read; capability `survey`)

**Request params** — the whole catalog, verbatim, so the agent needs no built-in
knowledge of what to check and new probes ship as panel data:

```json
{ "catalog": { "version": 1, "probes": [ /* see survey_probe_catalog.yaml */ ] } }
```

Each probe entry carries `id`, `kind`, and a `detect` block (`ports` / `units` /
`bins` / `paths`) and an optional `map` block (globs whose matched files are
parse-light-extracted). The agent iterates probes, runs `detect` with the
primitives above, and — when a probe is detected — fills its result.

**Response `data`** — keyed by probe id. Every field is optional; the panel
normalizes defensively (`normalize_map` in `survey_service.py`), so a partial
payload from a partially-implemented agent still yields a valid (sparse) map:

```json
{
  "catalog_version": 1,
  "probes": {
    "nginx": {
      "detected": true,
      "service": { "active": true, "ports": [80, 443] },
      "vhosts": [
        { "server_name": "example.com", "root": "/var/www/example", "upstream": null },
        { "server_name": "api.example.com", "root": null, "upstream": "http://127.0.0.1:8001" }
      ]
    },
    "apache":  { "detected": false },
    "php-fpm": { "detected": true, "service": { "active": true } },
    "foreign-panel": { "detected": true, "markers": ["/usr/local/cpanel"] },
    "docker":  { "detected": true, "service": { "active": true },
                 "containers": [ { "name": "site1", "image": "wordpress:6", "ports": ["8001->80"] } ] },
    "databases": { "detected": true,
                   "engines": [ { "name": "mysql", "active": true, "port": 3306 } ] },
    "crontabs": { "crontabs": [ { "user": "root", "lines": ["0 3 * * * /usr/bin/backup"] } ] },
    "certs":    { "certs": [ { "domain": "example.com", "expires_at": "2026-10-01T00:00:00Z" } ] },
    "mail":     { "detected": false },
    "listeners":{ "listeners": [ { "port": 80, "proto": "tcp", "process": "nginx" } ] }
  }
}
```

Field notes:

- `probes.<id>.detected` — boolean; the panel adds a service row when true.
- `vhosts[].server_name` / `root` / `upstream` — parse-light only. `upstream`
  (or `proxy_pass`) present + no `root` ⇒ the panel treats the site as a reverse
  proxy. The panel maps each vhost to a **site** row (`domain → stack → doc_root
  → upstream → managed_by`).
- `foreign-panel.markers` — the marker directories that existed. The panel
  raises the **foreign-panel badge** and the "switch to Observed" suggestion
  from this (Decision 4 — it SUGGESTS, never flips).
- `certs[].expires_at` — ISO-8601; from `cert-meta` (`notAfter`). No key bytes.
- Unknown/absent units MUST be reported absent, never error the whole survey.

## Normalized Server Map (what the panel stores)

`normalize_map` collapses the per-probe payload into stable top-level
collections: `services`, `sites`, `databases`, `certs`, `cron`, `listeners`,
`foreign_panels`, plus `foreign_panel_detected` and `probes_run`. Snapshots are
immutable rows (`server_surveys`); any two are diffable by identity (site by
domain, service by id, db by engine, cert by domain).

## Rollout

Ships like every agent feature: staged rollout via AgentVersion, capability
negotiated. The panel works against agents that don't have it yet (they show
"survey unsupported"), so there is no flag day.
