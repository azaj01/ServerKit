# `serverkit.yaml` — Declarative Service Manifest

A repository can carry a single `serverkit.yaml` (or `serverkit.json`) that
declares everything you would otherwise click into existence in the panel:
services, databases, disks, backups, environment variables, cron jobs and
domains. ServerKit parses it, diffs it against live state, and applies the
difference — at import, on push (per-service `autoDeploy`), or on demand.

The manifest is an **optional overlay**. Panel-first users see zero change; the
imperative APIs stay authoritative for apps without a manifest.

## Editor support

Add a `$schema` header comment so editors give you validation and autocomplete:

```yaml
# yaml-language-server: $schema=https://serverkit.ai/serverkit-yaml.schema.json
version: 1
```

The JSON Schema ships in the repo at [`docs/serverkit-yaml.schema.json`](./serverkit-yaml.schema.json).

## Versioning

`version: 1` is the discriminator that selects the declarative multi-service
spec. **A file without `version: 1` is a legacy flat manifest and keeps behaving
exactly as before** — no breaking change, ever, to the v0 shape. Legacy files
use flat `build`/`deploy` keys and describe a single service.

## Key casing

`camelCase` is canonical in this document and the schema. `snake_case` aliases
are accepted everywhere (`buildCommand` == `build_command`,
`healthCheckPath` == `healthcheck_path`, `fromSecret` == `from_secret`, …).

## Full example

```yaml
# yaml-language-server: $schema=https://serverkit.ai/serverkit-yaml.schema.json
version: 1
server: vps-frankfurt          # optional fleet target (Phase 5); omit for local

services:
  - name: api
    type: web
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn app:app
    port: 8000
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: DATABASE_URL
        fromService: { name: db, property: connectionString }
      - key: STRIPE_KEY
        fromSecret: stripe_prod
      - key: SESSION_SECRET
        generate: true
      - key: LOG_LEVEL
        value: info
    disks:
      - name: uploads
        mountPath: /data/uploads
        backup: { schedule: daily, retain: 7 }
    cron:
      - schedule: "0 3 * * *"
        command: python manage.py cleanup

  - name: db
    type: postgres
    version: "16"
    disk:
      size: 10GB
      backup: { schedule: daily, retain: 7 }

domains:
  - host: api.example.com
    service: api
    ssl: auto                  # best-effort — SSL stays optional, never blocks
```

## Top-level keys

| Key | Type | Notes |
|---|---|---|
| `version` | `1` | Required. Selects the declarative spec. |
| `server` | string | Optional default fleet target. A service may override it. |
| `project` | string | Optional project name; defaults to the repository name. A manifest maps to one Project. |
| `envVars[]` | list | Manifest-level (project-scoped) variables applied to every service. |
| `services[]` | list | The services that make up the deployment. |
| `domains[]` | list | Public domains routed to services. |

## Services

Each `services[]` entry becomes an `Application` (app types) or a
`ManagedDatabase` (db types) inside the manifest's Project, in the default
environment.

| Key | Applies to | Notes |
|---|---|---|
| `name` | all | Unique within the manifest. `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. |
| `type` | all | `web` / `worker` / `static` / `docker` → Application; `postgres` / `mysql` / `mariadb` / `redis` → ManagedDatabase. |
| `runtime` | app | Build runtime hint (`python`, `node`, `static`, `docker`). |
| `buildCommand` / `startCommand` | app | Buildpack command overrides. |
| `port` | app | Container listen port (1–65535). |
| `healthCheckPath` | app | Used for health checks and the zero-downtime restart gate. |
| `autoDeploy` | app | `true` auto-applies on a changing push; otherwise the manifest flips to `pending`. |
| `cpu` / `memory` | app | Resource limits (best-effort). |
| `version` | db | Engine version (e.g. `"16"`). |
| `server` | all | Per-service fleet target override. |
| `envVars[]` | all | Per-service environment variables. |
| `disks[]` | app | Persistent volumes. |
| `disk` | db | Single primary disk for a db service. |
| `cron` | app | One object or a list — scheduled jobs. |

## Environment variables

Each entry has a `key` plus **exactly one** value source:

| Source | Meaning |
|---|---|
| `value: <literal>` | A non-secret literal. Secrets never live in the manifest. |
| `fromSecret: <name>` | Reference to a vault secret by name. Resolved at injection time; the value never lands in the env row and masking stays intact. A missing secret is a **plan-time** error. |
| `fromService: { name, property }` | Reference to a sibling service's connection property. For db services: `connectionString`, `host`, `port`, `database`, `username`, `password`. For app services: `host`, `port`, `url`. |
| `generate: true` | On first apply ServerKit generates a random value, stores it as a vault secret, and rewires the entry as a `fromSecret` reference — a committable manifest with zero secrets in git. |

## Disks & backups

```yaml
disks:
  - name: uploads
    mountPath: /data/uploads
    size: 5GB              # recorded; not enforced by the local driver
    backup: { schedule: daily, retain: 7 }
```

`disks[]` become `AppVolume` rows; a `backup:` block becomes a `BackupPolicy` on
the `files` target scoped to the mount path. `schedule` is one of
`hourly` / `daily` / `weekly` / `monthly`; `retain` is the number of backups to
keep.

## Domains & SSL

```yaml
domains:
  - host: api.example.com
    service: api
    ssl: auto
```

`ssl: auto` is **best-effort**: certificate failure degrades to a warning and
never blocks the deploy or the domain attach. HTTPS is optional in ServerKit,
period. Use `ssl: off` for HTTP only.

## Apply model

- **Explicit apply by default.** `plan` (dry-run) → `apply` is the base flow.
  A dry-run is always available and is the default UX.
- **`autoDeploy: true`** opts a service into auto-apply on a changing push.
- Every apply is logged, runs inside a `DeploymentJob`, and snapshots config
  before and after — the same auto-apply-sandboxed-logged trust model as the
  rest of ServerKit.
- **Secrets never live in YAML.** The manifest is committable by construction.

## Out of scope

The manifest is an *app* manifest. It does **not** declare multi-replica /
load-balanced / blue-green services, non-app server resources (firewall rules,
global nginx, system packages), or act as a general-purpose IaC engine. Live
panel state *is* the state; the manifest is the desired state.
