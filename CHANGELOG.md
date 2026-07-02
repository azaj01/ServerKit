# Changelog

All notable changes to ServerKit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Scope:** This changelog tracks the **control panel** (Flask backend + React
> frontend). The cross-platform **agent** ships on its own cadence and is tagged
> separately (`agent-vX.Y.Z`) — see [`agent/README.md`](agent/README.md) for its
> install and release notes.
>
> Commit-level history lives in `git log`; this file curates the user-facing
> changes by theme.

## [Unreleased]

The `dev` branch is well ahead of the last `main` release. The headline work
awaiting a stable release:

### Added

- **Extensions platform (Phase 4 — Email is now an extension)** — the mail-server
  stack (Postfix/Dovecot, domains, mailboxes, DKIM/SpamAssassin, Roundcube webmail,
  and the `/api/v1/email` API) has moved out of core into the bundled
  **`serverkit-email`** extension. Panels that never run mail no longer load any of
  it — a real "smaller core" win. Existing panels that actually used mail
  auto-install the extension once on upgrade (detected by existing mail domains/
  accounts); everyone else finds it in the Marketplace. Outbound notification SMTP
  is unaffected — it never depended on the mail server. (The Email "module toggle"
  is retired in favor of installing/disabling the extension.)
- **Extensions platform (Phase 3 — platform primitives)** — the machinery that
  makes extensions first-class and safe. Extensions can now own **data models**
  (manifest `models` → `ext_<slug>_*` tables, created on install, dropped on
  purge), **background jobs & schedules** (wired into the Jobs system, and paused
  automatically when the extension is disabled), and a **real-time Socket.IO
  namespace** (`/ext/<slug>`, status-guarded). Declared **permissions** are now a
  consent step and enforced by an SDK capability gate (`require_permission`).
  **Panel-version compatibility** (`min_panel_version`/`max_panel_version`) is
  enforced at install and update. Uninstall offers **keep-data vs purge**. New
  generic **contribution slots** (`dashboard.top`, `service.detail.tab`,
  `domain.drawer.panel`) let extensions enrich core surfaces, not just add pages.
  The frontend-delivery decision is recorded in
  [`docs/adr/0001-extension-frontend-delivery.md`](docs/adr/0001-extension-frontend-delivery.md).
- **Extensions platform (Phase 2 — remote registry & updates)** — the Marketplace
  Browse tab can now show extensions from a curated remote **registry** (a single
  `index.json`), merged in and labeled "Registry", with no per-panel seeding. The
  fetch is offline-tolerant (last-good cache → a bundled fallback index) and
  cached. Installing from the registry is **checksum-verified** — the downloaded
  zip's sha256 must match the index before extraction, or the install hard-fails.
  Panel-version gates (`min_panel_version`/`max_panel_version`) block installs a
  panel is too old to run. Installed extensions listed in the registry now get an
  "Update available" badge and a one-click **Update**. Format + publishing guide in
  [`docs/EXTENSIONS_REGISTRY.md`](docs/EXTENSIONS_REGISTRY.md).
- **Extensions platform (Phase 1 — seed the marketplace)** — the Marketplace is
  now genuinely populated. **GPU Monitor** and **Workflow Builder** became bundled
  builtin extensions (`serverkit-gpu`, `serverkit-workflows`) — same route, but
  their nav/route/title/command-palette entries now come from the extension
  manifest. An upgraded panel auto-installs a converted builtin once so nothing
  disappears; fresh installs simply see it in the Marketplace. New **Module
  toggles** (Settings → Modules) let an admin hide the Email and WordPress
  verticals — nav, routes, and the module's API (`/api/v1/email`,
  `/api/v1/wordpress`) all switch off — for a smaller panel without uninstalling
  anything. The Marketplace gained a "by ServerKit" first-party badge, real
  category chips, and an extension detail view with icon + screenshots.
- **Extensions platform (Phase 0 — hygiene)** — groundwork for the small-core +
  marketplace direction. A single **extension author guide**
  ([`docs/EXTENSIONS.md`](docs/EXTENSIONS.md)) documents the manifest schema,
  contribution envelope, lifecycle hooks, backend SDK, install sources, and the
  production frontend-delivery constraint. Builtin-extension frontends are now
  mechanically kept in sync with their source
  (`scripts/sync-builtin-frontends.mjs` + an `Extensions CI` drift gate) instead
  of hand-duplicated. The Marketplace labels bundled entries honestly ("Built-in"
  rather than "Local mapping/Entries"). First automated coverage for the plugin
  install pipeline (builtin install, contributions envelope, disable→503 guard,
  reinstall metadata refresh, zip-slip rejection).

- **Managed databases** — the databases ServerKit provisions are now tracked as
  first-class resources (beside the existing live explorer): durable rows for
  backups and connection strings. A managed database backs a `BackupPolicy` by a
  real foreign key (not an untethered descriptor), one-click "Protect" creates
  that policy, and a real connection URI can be revealed/copied (audited, secret
  Fernet-encrypted at rest). Adopt an existing database to start tracking it. API
  under `/api/v1/databases/managed`. Not a DBaaS — no pooling/replicas/scaling.
- **Per-app managed volumes** — first-class, tracked persistent storage for a
  service. Attach a named Docker volume at a chosen container path under
  Settings → Storage; it survives redeploys and is visible with live
  present/size state, instead of a fragile relative bind mount
  (`./mysql-data:/var/lib/mysql`). Detaching keeps the data by default; wiping is
  blocked while the app runs. API under `/api/v1/apps/<id>/volumes`.
- **Private container registries** — store credentials once under Settings →
  Connections (GHCR, Docker Hub, GitLab, ECR, or any generic registry) and
  ServerKit runs `docker login` before pulling a private image, then logs out.
  Secrets are Fernet-encrypted at rest and piped via stdin (never on argv);
  attach a registry to a service under Container Ops. Anonymous pulls are
  unchanged. API under `/api/v1/connections/registries`.
- **Container status aggregator** — collapses an app's per-container Docker
  states into one deterministic status (`running:healthy` … `degraded` …
  `unknown`) at `/api/v1/status/app/<id>` and `/api/v1/status/apps`, with
  change-only pushes over the `container_status` Socket.IO channel.
- **API token scopes** — fine-grained, additive scopes for API keys (enforced
  only for `X-API-Key` requests; JWT/session callers stay RBAC-governed), a
  `require_scope` decorator, and a scope catalog at `/api/v1/api-keys/scopes`.
- **Server onboarding state machine** — a linear lifecycle (validating →
  installing prerequisites → installing Docker → pairing agent → ready/failed)
  driven on the job bus, with start/retry/status at
  `/api/v1/servers/<id>/onboarding/*` and an ordered progress log.
- **Declarative template catalog** — a documented catalog schema
  (`/api/v1/templates/catalog/schema`) with auto-resolved `${SERVICE_*}` magic
  variables (password/user/FQDN/URL/base64) so templates never hardcode generated
  secrets or hosts. See [docs/TEMPLATE_CATALOG_SCHEMA.md](docs/TEMPLATE_CATALOG_SCHEMA.md).
- **Build packs** — zero-Dockerfile detection that inspects a repo and generates
  a Dockerfile + compose from a build plan (`/api/v1/buildpacks/detect`,
  `/generate`), persisted on the application row; defers to an author-provided
  Dockerfile when present.
- **Deployment config snapshots** — immutable, secret-masked config snapshots
  captured before each deploy, with diff and one-click restore + redeploy at
  `/api/v1/apps/<id>/snapshots[/<id>/diff|/restore]`.
- **Projects & Environments** — a Workspace → Project → Environment → Apps
  hierarchy (`/api/v1/projects`, `/api/v1/environments`) with workspace-scoped
  access and resource counts.
- **Shared resources** — polymorphic tags and attachable shared variable groups
  with a merged "resolved" view and masked secrets (`/api/v1/shared/...`).
- **PR preview environments** — ephemeral previews driven by a pull-request
  webhook (`/api/v1/webhooks/pull-request/<token>`) that open, redeploy, and tear
  down per PR, managed at `/api/v1/apps/<id>/previews`.
- **Per-server managed proxy stack** — opt-in Dockerized Traefik or Caddy per
  server with a compose preview before switching, host nginx remaining the
  default (`/api/v1/servers/<id>/proxy*`).
- **Multi-platform agent & fleet management** — native Go agent for Linux,
  Windows, and macOS with HMAC-SHA256 auth and WebSocket + HTTP-poll transports,
  plus a fleet dashboard (inventory, connection status, approval queue,
  discovery, rollouts, and command queue).
- **Native Windows agent** — Windows service, desktop setup wizard (WebView2),
  system tray, and MSI installer; also `.deb`/`.rpm` packages and ARM64 builds.
- **Agent pairing** — short-code and passphrase pairing flows with keypair
  enrollment, the `sk1` connection-string format, and automatic fallback to
  polling when WebSocket connections flap.
- **Remote operations over the agent** — files, packages, services, cron, sudo,
  Docker, Cloudflare tunnels, and streamed job progress on connected servers.
- **Plugin / extension system** — plugin SDK, contribution points, capabilities
  and permissions, marketplace UI, built-in extensions, and a GUI plugin
  (`serverkit-gui`).
- **Status pages** — public status pages with HTTP/TCP/DNS/Ping checks,
  component monitoring, and incident management.
- **Cloud provisioning** — provision servers on DigitalOcean, Hetzner, Vultr,
  and Linode with cost tracking.
- **Git-based services** — GitHub source connections, repository picker,
  manifest detection, and "New Service from repo" (Git extension canonical at
  `/git`).
- **RHEL-family support** — the installer now covers Rocky, AlmaLinux, RHEL, and
  CentOS in addition to Ubuntu/Debian/Fedora.
- **Per-app Web Application Firewall** — ModSecurity v3 + OWASP Core Rule Set
  with detect/block modes, paranoia tuning, a disabled-rule editor, one-click
  apply (nginx include injection), and parsed audit-log events.
- **Container lifecycle controls** — image-update detection with one-click
  apply, idle container auto-sleep, and CPU-driven horizontal auto-scaling, with
  cron-drivable sweeps for the sleep/scale policies.
- **GPU monitoring** — NVIDIA utilization, memory, temperature, power, and
  per-process / per-container usage.
- **Dynamic DNS** — token-authenticated A/AAAA updates synced through a
  connected DNS provider (e.g. Cloudflare).
- **Secrets manager & inbound webhook gateway** — encrypted secret storage and
  inbound webhook endpoints for triggering automation.
- **Passkeys / WebAuthn** — passwordless and second-factor authentication with
  hardware keys, Touch ID, and Windows Hello.
- **Remote service tunnels** — expose a private or NAT'd service through an edge
  server over an agent-managed, NAT-traversing WireGuard tunnel, reusing nginx,
  DNS, and certificates.
- **Connections hub** — a single place to link external accounts (source code,
  cloud, DNS, domain registrars with expiry tracking, SMTP relays, and S3/B2
  storage), with credentials encrypted at rest.
- **WordPress publishing** — publish managed sites at a real subdomain, swap a
  site's URL safely with preview, and attach a custom domain with automatic DNS.
- **Guided installer / updater** — health-checked install and update flow with
  automatic rollback.

### Security

- **Container CVE scanning & SBOM** — per-image vulnerability scans with grype
  and software bill-of-materials generation with syft.
- **Optional, hardened TLS** — best-effort HTTPS that never blocks an install
  (falls back to HTTP), a server-wide TLS 1.2+/AEAD-cipher floor applied at
  install and update, Cloudflare-aware nginx configs, automatic CAA records on
  certificate issuance, and HSTS gated on the operator's recorded SSL choice so
  HTTPS stays optional.
- **Encryption at rest** — system-setting secrets and DNS/cloud provider
  credentials sealed with Fernet; optional client-side backup encryption.

### Changed

- Overhauled the Docker UI (bulk container stats, compose listing) and migrated
  the frontend design system to SCSS `.ui-*` components.
- Unified the local dev launcher (`dev.sh` / `dev.ps1`).
- Agent capabilities and system info are cached to the database, surfaced in the
  System Status card, and re-sent on a periodic cadence.

### Fixed

- Resolved systemic silent failures: empty logs, dead WebSocket connections, and
  locked-out agents; stale "online" status is now auto-corrected.
- Hardened the installer: Docker install on Fedora/RHEL, SELinux + nginx
  reverse-proxy configuration, and low-RAM swap setup.
- Stopped dropping capability/sysinfo payloads on transient `/poll` failures.

### Testing & Infra

- Added a Vagrant + Hyper-V runner (Debian/Fedora/Rocky) and a Multipass-based
  end-to-end harness that runs on Windows.

---

## Released

Current development version: **1.6.7**. Recent point releases (`1.4.x` → `1.6.7`)
delivered the agent fleet, plugin system, and installer hardening listed above.
Until tagged panel releases land, consult `git log` and the
[GitHub releases page](https://github.com/jhd3197/ServerKit/releases) for the
detailed history.
