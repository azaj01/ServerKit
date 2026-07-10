# Agent probe pack v2 — `doctor:probe` + `systemd:restart`

> Status: SPEC (plan 26 Phase 4). The panel side is implemented and negotiates
> to these commands when an agent advertises them; the agent-side handlers land
> in the Go agent component (`agent/`, not in this checkout) and reach boxes via
> the AgentVersion / staged-rollout rails, capability-gated.

The fleet doctor v1 composes only commands every already-deployed agent
understands (`systemd:status` per unit + `system:metrics`). That is correct but
chatty: N units = N round trips per server per sweep. v2 adds one batched probe
so a sweep is a single round trip per server, plus the restart command the
allowlisted repair path needs. Both are **optimisations gated on a capability** —
the composed v1 path stays as the permanent fallback (Fleet Contract, rule 5).

## Capabilities advertised

An agent that implements these adds them to its `capabilities` map on connect:

```json
{ "capabilities": { "doctor.probe": true, "systemd.restart": true } }
```

Older agents simply never advertise them and keep working on the v1 composed
path forever (rule 2).

## `doctor:probe` (read; capability `doctor.probe`)

One round trip returning the batched health facts the fleet doctor needs.

**Request params**

```json
{ "units": ["nginx", "docker"] }
```

`units` is the list of systemd service names to report. The agent MUST ignore
unknown units (report them absent rather than erroring the whole probe).

**Response `data`**

```json
{
  "units": {
    "nginx":  { "active": true,  "state": "active"   },
    "docker": { "active": false, "state": "inactive" }
  },
  "disk": { "percent": 61.0, "path": "/" },
  "listening": [ { "port": 80, "proc": "nginx" }, { "port": 443, "proc": "nginx" } ]
}
```

- `units[name].active` — boolean; the panel keys off this. `state` is the raw
  systemd `ActiveState` for display and is optional.
- `disk.percent` — used-percent of the root filesystem (0–100). The panel
  computes headroom as `100 - percent`.
- `listening` — optional summary of listening ports; informational, not yet a
  check in v1 of the panel consumer (reserved).

**Permission scope:** read-only; gate under the agent's existing system-read
scope. No state is changed.

## `systemd:restart` (write; capability `systemd.restart`)

Restart one systemd unit. This is the target of the allowlisted `fleet.service`
repair (Fleet Contract, rule 6); the panel refuses any unit not on its
allowlist (`nginx`, `docker`) before dispatch, and `send_command` enforces the
`systemd:restart` permission scope server-side.

**Request params**

```json
{ "unit": "nginx" }
```

**Response `data`**

```json
{ "restarted": true, "unit": "nginx" }
```

On failure the agent returns `{"success": false, "error": "<systemctl stderr>"}`.

**Permission scope:** `systemd:restart` (a write scope; must be explicitly
granted to the server — it is not implied by the read scopes).

## Panel negotiation (implemented)

`FleetDoctorService._compose_server_checks` negotiates per server:

```
if connected and capabilities.doctor.probe:
    rows = _probe_checks(server_id)      # one doctor:probe round trip
    if rows is None:                      # probe errored / unusable payload
        rows = compose_v1()               # fall back to systemd:status + system:metrics
else:
    rows = compose_v1()
```

Both paths emit **identical** check rows (`service.<name>`, `disk.headroom`), so
the report/UI/repair layers don't care which path produced them. A stopped core
service is `repairable` only when the agent also advertises `systemd.restart`.

This is the canonical shape for adding a new agent command as an optimisation:
ship it capability-gated, keep the composed path as the fallback, and make both
produce the same rows.
