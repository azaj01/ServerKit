# ServerKit WordPress Roadmap

*Turning ServerKit's WordPress support from "a folder + a database + an nginx config" into a **managed WordPress platform object**.*

---

## The thesis: integration, not absence

ServerKit already owns an unusually deep set of primitives — a multi-server agent, container-to-container DB cloning with serialized-safe `search-replace`, full Let's Encrypt + DNS-01 wildcard SSL, S3/B2/MinIO offsite backups, a workflow engine, RBAC/workspaces, status pages, notifications — **plus** a genuinely WordPress-aware environment pipeline (prod → staging → dev → multidev, locking, pre-op snapshots, promote/sync, basic-auth).

A capability audit of ~144 managed-WordPress features scored them:

| Status | Count | Meaning |
|---|---|---|
| ✅ **Have** | 23 | Built end-to-end (service + API + UI) |
| 🟡 **Partial** | 71 | **Exists but generic, half-wired, or backend-only** |
| ❌ **Missing** | 50 | Genuinely absent |

**That 71 is the roadmap.** Most primitives terminate at a generic `Application`/domain/db-name target and were never wired to the `WordPressSite` object. SSL never touches a WP site; offsite backups never touch a WP snapshot; routes that already work server-side (`flush-cache`, `search-replace`, `harden`, per-site health, disk usage) have **no frontend button at all**. The fastest path to a managed feel is *wiring*, not building.

---

## How to read this document

- Tasks are **globally numbered (#1 … #35)** so they're individually addressable — e.g. "do #12".
- Tasks are grouped into **Phases 0 → D**, ordered so cheap, high-trust wiring lands before net-new systems.
- Each task lists **Today** (what already exists, with `file:line`), **Do** (the concrete change), **Reuse** (existing services to lean on), and **Done when** (acceptance).

**Effort legend** (single-developer estimate; many are parallelizable):

| Tag | Meaning |
|---|---|
| **S** | ≤ 2 hours — mostly wiring |
| **M** | ~ half a day to a day |
| **L** | 1–3 days |
| **XL** | multi-day epic; split before starting |

**Status legend:**

| Mark | Meaning |
|---|---|
| 🐛 | Active defect / data-loss risk — fix regardless of roadmap |
| 🟡 | **Almost there** — the backend or model already exists; this is glue |
| ❌ | Net-new build |

---

## Target: the "WordPress site object"

The north star. A managed site should expose this button row on every site **and every environment**, all backed by tasks below:

`Open Site` · `WP Admin` · `Auto Login` · `Create Backup` · `Restore` · `Create Staging` · `Push to Live` · `Pull from Live` · `Purge Cache` · `Update` · `Security Scan` · `View Logs` · `Open Database` · `Open Files` · `WP-CLI` · `Manage Domains`

And this consolidated health header: **WP version · PHP version · SSL status · backup status · update count · disk usage · cache status · security warnings · uptime %**.

---

## Phase 0 — Foundational fixes (blocker, do first)

These are bugs the rest of the roadmap stands on. **Estimated cluster: half a day.**

### #1 — Collapse the duplicate `/sites` blueprints `[S]` 🐛 — ✅ Done
- **Today:** Both `wordpress_bp` and `wordpress_sites_bp` register at `/api/v1/wordpress` (`backend/app/__init__.py:122-123`), and **both** define `GET /sites` and `POST /sites` (`api/wordpress.py:20,28` vs `api/wordpress_sites.py:31,53`) — plus collisions on `GET/DELETE /sites/<id>`, environments, plugins, themes, and `update`. Flask keeps the first-registered rule, so the bare Docker-template create wins and the richer hardening/install create is **dead-routed**. Behavior depends on URL-map ordering.
- **Do:** Pick one create surface. Move the unique routes from one blueprint, delete the duplicate `/sites` GET+POST, and register a single create path.
- **Reuse:** `WordPressService.create_site`, `wordpress_sites.py` create body.
- **Done when:** Exactly one rule answers `POST /api/v1/wordpress/sites`; the UI payload matches it.
- **Landed:** `wordpress_bp` (the canonical Docker-stack model the live UI creates against with `{name, adminEmail}`) keeps the hub/plugins/themes/update routes; the shadowed duplicates were removed from `wordpress_sites_bp`, which now owns only its unique routes (sync, snapshots, clone-db, git). Verified **0 path+method collisions** across the two blueprints. Provably behavior-preserving since `wordpress_bp` already won every collision. *(Follow-up for #2/#15: the resource-tier gate and snapshot-before-update that lived in the removed legacy create/update should be ported onto the canonical path.)*

### #2 — Make every create path harden + install properly `[S]` 🐛 — ✅ Done (Docker-valid hardening via wp_cli; admin password surfaced once)
- **Today:** The UI path (`pages/WordPress.jsx:43-65` → `services/wordpress.js:9`) sends only `{name, adminEmail}` and runs the container-only template path — **no** wp-config hardening, **no** admin user, **no** SSL. The hardening path (`WordPressService.install_wordpress` → `harden_wordpress`, `services/wordpress_service.py:146,497`) is the one that gets shadowed by #1.
- **Do:** Route the single create through `install_wordpress` + `harden_wordpress` regardless of standalone vs Docker.
- **Reuse:** `install_wordpress` (`:146`), `harden_wordpress` (`:497`).
- **Done when:** A freshly created site has an admin user, `DISALLOW_FILE_EDIT`/`FORCE_SSL_ADMIN`, XML-RPC off, and shuffled salts.

### #3 — Report the real site URL `[S]` 🐛 — ✅ Done
- **Today:** `_enrich_site_data` (`services/wordpress_service.py:918-932`) sets `site.url` to `http://localhost:<port>`, so "Open Site"/"Open WP Admin" are wrong for any real domain.
- **Do:** Derive `url` from the site's primary domain (HTTPS when SSL present), falling back to the port only when no domain is attached.
- **Reuse:** `application.domains` (already in `to_dict`, `models/wordpress_site.py:158`).
- **Done when:** "Open Site" lands on the live domain.

### #4 — Backup-before-delete + archive state `[M]` 🐛 — ✅ Done
- **Today:** `delete_site` → `_teardown_wp_site` (`services/wordpress_service.py:1032,1178`) does `compose_down(remove_volumes=True)` + `rmtree` with **no snapshot**. `delete_environment` is the same. Promote/sync already snapshot-first — the pattern exists, it's just not applied to delete.
- **Do:** Take a final `DatabaseSnapshot` (+ optional file archive) before teardown. Add an `archived` state that stops the stack but retains a restorable backup.
- **Reuse:** `db_sync_service` snapshot creation; the snapshot-first pattern from `environment_pipeline_service.py`.
- **Done when:** Deleting a site leaves a restorable snapshot; an archived site can be brought back.
- **Landed:** `delete_site(create_backup=True)` now runs the Docker-aware `backup_wordpress()` (full files + DB to `BACKUP_DIR`, outside the site root so it survives `rmtree`) before teardown, and returns the backup info. New reversible `archive_site` / `unarchive_site` (`compose_down(volumes=False)` keeps data → `status='archived'`; `unarchive` restarts → `running`). New routes `POST /sites/<id>/archive`, `/unarchive`, and `DELETE /sites/<id>?create_backup=false` opt-out; frontend `archiveSite`/`unarchiveSite`/`deleteSite({createBackup})` added. **Also fixed a latent bug:** `_teardown_wp_site` passed `compose_down(remove_volumes=…)` but the real param is `volumes=` — the old call would have raised `TypeError`, so delete was effectively broken. *(Follow-up: surface Archive/Delete buttons in a site DangerZone — there is currently no site-delete UI in the WP hub.)*

---

## Phase A — Glue the object together (almost-there wins)

Every task here reuses a service that already exists and is verified present. **This is the highest "managed feel" per hour.** Many run in parallel. **Estimated cluster: 1–2 days, parallelizable.**

### #5 — Surface the orphaned WP-CLI actions in the UI `[S]` 🟡 — ✅ Done
- **Today:** Routes exist and work — `harden` (`api/wordpress.py:499`), `search-replace` (`:513`, serialized-safe), `flush-cache` (`:550`) — but `services/wordpress.js` has **no** `harden`/`searchReplace`/`flushCache` methods, so there's no button.
- **Do:** Add the three `ApiService` methods + controls on `WordPressDetail` (a "Purge Cache" button, a guarded search-replace dialog, a "Harden" action).
- **Reuse:** `WordPressService.harden_wordpress/search_replace/flush_cache` (`:497,609,626`).
- **Done when:** Purge/search-replace/harden are one click each.

### #6 — One consolidated site-health card `[M]` 🟡 — ✅ Done
- **Today:** `EnvironmentHealthService.check_health` / `get_disk_usage` compute container/MySQL/WP/disk status; frontend stubs `getProjectHealth`/`getEnvironmentHealth`/`getEnvironmentDiskUsage` exist; `components/wordpress/DiskUsageBar.jsx` is **imported nowhere**. `WordPressDetail` OverviewTab shows static text and calls none of them.
- **Do:** Assemble one health header (WP/PHP version, SSL status [from #8], backup status, update count [from #7], disk usage, cache status [from #22/#23], security warnings) and render `DiskUsageBar`.
- **Reuse:** `EnvironmentHealthService`, the existing frontend stubs, `DiskUsageBar.jsx`.
- **Done when:** The site overview shows a live health header instead of static fields.

### #7 — Update badges + Update buttons `[M]` 🟡 — ✅ Done
- **Today:** `get_wordpress_info` (`services/wordpress_service.py:216`) computes `update_available`/`latest_version`; the plugin/theme list JSON already carries per-item update flags. The OverviewTab/PluginsTab/ThemesTab parse none of it. `update_themes` service method is missing (only `update_plugins`/`update_wordpress` exist).
- **Do:** Render a core update badge + per-plugin/theme "Update" buttons; add `update_themes`.
- **Reuse:** `update_wordpress` (`:256`), `update_plugins` (`:312`), `get_plugins`/`get_themes`.
- **Done when:** Available updates show a count and update in place.

### #8 — Wire SSL to the WordPress site `[M]` 🟡 — ✅ Done (live status; Docker/localhost degrades gracefully)
- **Today:** `ssl_service.obtain_certificate` / `advanced_ssl_service.issue_wildcard_cert` / `setup_auto_renewal` take arbitrary domains and are **never** called by `create_site`; the per-env nginx template listens on `:80` only. `WordPressSite` has no `ssl_status`. The SSL-health methods in `services/security.js` (`getSSLHealth`, `issueWildcardCert`, expiry alerts) have **zero** `.jsx` consumers.
- **Do:** Add a per-site "Enable SSL" action + an `ssl_status` field; call `SSLService` on create/domain-attach; use a wildcard cert for `staging.*`/`dev.*`/multidev subdomains; surface cert grade/expiry on the site's domain panel.
- **Reuse:** `ssl_service`, `advanced_ssl_service`, `security.js`.
- **Done when:** Creating/attaching a domain provisions TLS and the health card shows SSL status.

### #9 — Stop dropping the sanitization profile `[S]` 🟡 — ✅ Done
- **Today:** `PromoteModal`/`SyncModal` send `sanitization_profile_id`; `db_sync_service.apply_sanitization_profile` exists — but `api/environment_pipeline.py` / `EnvironmentPipelineService` never resolve the id; only the boolean `options['sanitize']` is honored. The profile (incl. WooCommerce payment-table stripping) is silently ignored.
- **Do:** Resolve `SanitizationProfile` by id in `promote_database`/`sync_from_production` and pass it to `_transform_dump`.
- **Reuse:** `apply_sanitization_profile`, `SanitizationProfile` model.
- **Done when:** A selected profile demonstrably rewrites/strips data on sync.

### #10 — Close the rollback loop on promotions `[M]` 🟡 — ✅ Done
- **Today:** `PromotionJob.pre_promotion_snapshot_id` and status `rolled_back` exist; `db_sync_service.restore_snapshot` exists; pre-promotion snapshots are captured on **every** promote — but **nothing ever calls restore** and `rolled_back` is never set. The safety net is captured and never used.
- **Do:** Add `POST /promotions/<id>/rollback` that restores the linked snapshot and flips status; optionally auto-trigger on failed promote.
- **Reuse:** `restore_snapshot`, `PromotionJob`.
- **Done when:** A bad promote can be undone in one click.

### #11 — Push WP snapshots offsite + enforce retention `[M]` 🟡 — ✅ Done
- **Today:** `DatabaseSnapshot`s land only in the local `SNAPSHOT_DIR`. `storage_provider_service.upload_file/upload_directory` (S3/B2/MinIO/Wasabi, SSRF-validated, verify-by-MD5) and `backup_service` retention/scheduling/notifications are fully built but bound to the generic `Application` model. `db_sync_service.cleanup_old_snapshots` exists but **no scheduler calls it** and `expires_at` is never set.
- **Do:** Hand each completed snapshot to `StorageProviderService`; populate `expires_at`; schedule `cleanup_old_snapshots`.
- **Reuse:** `storage_provider_service`, `backup_service`, the cron scheduler.
- **Done when:** Snapshots replicate to configured object storage and age out per policy.

### #12 — Deep-link DB, files, and logs from the site `[S]` 🟡 — ✅ Done
- **Today:** `QueryRunner.jsx` + `api/databases.py` and the File Manager + host log viewer exist but are reached only by raw DB-name / manual path; none deep-link to a site's `db_name` / docroot / `debug.log`.
- **Do:** Add "Open Database", "Open Files", and "View Logs" buttons that pass the site's `db_name`/`root_path`.
- **Reuse:** `QueryRunner`, File Manager, log viewer.
- **Done when:** Each button opens the right resource pre-scoped to the site.

### #13 — Make push-to-deploy actually deploy WordPress `[M]` 🟡 — ✅ Done
- **Today:** `WordPressSite.auto_deploy`/`git_repo_url`/`git_branch`/`last_deploy_commit` are persisted (`connect_repo`) and returned in status, but `auto_deploy` is **never consumed** — inbound git webhooks only deploy generic `Application`s. `git_wordpress_service.rollback_to_commit` and `deploy_from_commit` exist with no route/UI; WP keeps only a single `last_deploy_commit`.
- **Do:** Route inbound git webhooks to `GitWordPressService.deploy_from_commit` when `auto_deploy` is set; expose a WP deploy history list + rollback button.
- **Reuse:** `git_wordpress_service`, the existing webhook receiver, the `GitDeployment` history pattern.
- **Done when:** A push to the tracked branch deploys theme/plugin/code and history is browsable + reversible.

### #14 — Make the WP REST surface API-key reachable `[S]` 🟡 — ✅ Done
- **Today:** The `X-API-Key` middleware authenticates only the RBAC decorators, but **all** of `api/wordpress_sites.py` is bare `@jwt_required()` (24 routes), so programmatic automation can't touch WordPress.
- **Do:** Switch WP routes to the RBAC decorators that honor `g.api_key_user`.
- **Reuse:** the existing API-key middleware + RBAC decorators.
- **Done when:** A scoped `sk_` key can drive WP site operations.

---

## Phase B — Lifecycle + login (the platform-object identity)

These are the features that make a user say "this is a managed platform, not a folder." They sit directly on the primitives glued in Phase A. **Estimated cluster: 3–5 days.**

### #15 — True one-click site lifecycle `[L]` ❌ — ✅ Done (Docker-correct create bundle: PHP + page/object cache + admin in one wizard; TLS/custom-domain deferred — same infra gap as #21)
- **Today:** Create is incoherent (see #1/#2): UI collects only `{name, adminEmail}`; no SSL/PHP/cache options anywhere in the flow.
- **Do:** A single `WordPressSiteService.create` that orchestrates existing services in sequence — provision DB + admin (`install_wordpress` + `harden_wordpress`), issue SSL (#8), honor a chosen PHP version (#24), optionally enable cache (#22/#23), then register the `WordPressSite`. Expose domain + PHP version + admin + "enable SSL/cache" in `CreateSiteModal`.
- **Reuse:** everything from Phase 0 + #8.
- **Done when:** One wizard produces a hardened, TLS'd, admin-ready site on a real domain.
- **Landed:** `WordPressService.create_site` is now the single orchestrator and gained `php_version` / `enable_page_cache` / `enable_object_cache`. The chosen **PHP version is baked into the initial image tag** (concrete `6.4-php<x.y>-apache`, so the site boots on the right PHP with **no** post-create recreate), followed by the existing finalize+`_harden_docker_site`, then **best-effort** page cache (#22) and Redis object cache (#23) *after* `wp core install` (redis already ships in the stack, so no recreate). Cache enablement never fails the create — failures degrade to a non-fatal `warning`; the one-time admin password is still surfaced once. The live create modal (inline in `WordPress.jsx`, not the orphaned `CreateSiteModal.jsx`) gained a **PHP version selector** (Default / 8.1 / 8.2 / 8.3) and **page-cache / object-cache** toggles, threaded through `createForm` → `POST /sites` as `phpVersion` / `enablePageCache` / `enableObjectCache` (PHP version validated server-side against `get_available_php_versions()`). **Mechanism:** declared a hidden `VERSION` template var and switched the image line to bare `${VERSION}` in both `wordpress.yaml` and `wordpress-external-db.yaml` so a concrete tag is written at install — this *also fixes a latent #24 bug* where the unresolved `${VERSION:-…}` literal made `set_php_version` drop the WP-core pin (`set_php_version` now also falls back to the known core for legacy compose files). **No DB migration:** PHP / object-cache / SSL are read live; the page-cache flag rides the existing `sync_config` JSON column (mirroring the per-site page-cache route). Verified: backend `py_compile`, frontend lint-clean + production build, a 3-lens adversarial review (no blockers), and Docker Hub confirms all `6.4-php8.{1,2,3}-apache` tags exist. *(Deferred: SSL/TLS + custom-domain at create. Managed sites are `http://localhost:PORT` containers with no per-site reverse proxy and no domain attached at create — a public, routable domain + nginx vhost is the same missing infrastructure that blocks #21 and that #8 left as frontend-only. TLS is already operable post-create via `SiteSSLPanel` (#8) once a domain is routed; the `domains.py` → `NginxService.create_site` primitive exists for a future create-time wiring.)*

### #16 — Passwordless WP-admin login (the signature feature) `[M]` ❌ — ✅ Done (WP-CLI magic link; needs container egress to install the wp-cli-login package once)
- **Today:** "Open WP Admin" is a dumb `window.open` to `{site.url}/wp-admin`. Grep confirms **zero** login/magic/token/SSO code in the WP API. `create_user` (`:646`) and `reset_password` (`:666`) exist, so managed-admin provisioning is half-done.
- **Do (no heavy plugin — WP-CLI bridge):**
  1. Mint a one-time URL via `wp package install wp-cli/login-command` then `wp login create <user> --url-only` (or a ~30-line mu-plugin validating an HMAC nonce).
  2. Backend route resolves the managed admin tied to the operator's JWT email (create one via `create_user` if absent).
  3. Write a `wordpress.admin_login` `AuditLog` entry (the generic `AuditLog` already exists).
  4. Resolve a relocated login slug via `wp eval 'echo wp_login_url();'` instead of hardcoding `/wp-admin`.
  5. Add `auto_login_enabled` + a per-site permitted-users check.
- **Reuse:** `wordpress_service.wp_cli` (`:61-143`), `create_user`/`reset_password`, `AuditLog`, panel RBAC.
- **Done when:** "Auto Login" drops a permitted operator straight into `wp-admin`, logged, with no stored WP password.

### #17 — Existing-site import `[M]` ❌ — ✅ Done (.sql/.sql.gz MVP; wp-content zip + SFTP deferred)
- **Today:** No import path exists — only blank create or prod→child-env clone.
- **Do:** Accept a `wp-content`/full-site zip + `.sql` dump (or an SFTP pull), provision DB + files, run the serialized-safe `search-replace` for the new URL, and register a `WordPressSite`.
- **Reuse:** `db_sync_service` search-replace/clone, `_copy_wordpress_files`, `install_wordpress`, `ftp_service`.
- **Done when:** An exported site comes up running on a new domain.

### #18 — Clone-to-new-independent-site with fresh credentials `[M]` 🟡 — ✅ Done
- **Today:** `create_environment` (`services/wordpress_env_service.py:97-228`) clones files + DB (table-prefix + search-replace) but always links via `production_site_id` and **inherits** the parent's `admin_user`/`admin_email`/credentials (`:165-171`). No "duplicate as a brand-new top-level site".
- **Do:** Generalize the clone to produce a standalone site and generate **fresh** admin credentials via `create_user`/`reset_password`.
- **Reuse:** `create_environment` internals, `db_sync_service`.
- **Done when:** "Clone" yields an independent site with its own credentials.

### #19 — Multisite detection `[S]` 🟡 — ✅ Done
- **Today:** `WordPressSite.multisite` is a decorative boolean (`models/wordpress_site.py:25`), never populated from reality.
- **Do:** Populate it via `wp core is-multisite` during create/health.
- **Reuse:** `wp_cli`.
- **Done when:** The flag reflects the actual install.

### #20 — Site labels / tags (agency organization) `[S]` ❌ — ✅ Done
- **Today:** No tags/labels/client/group field on `WordPressSite`; UI renders no chips.
- **Do:** Add a `tags` (and optional `client`/`group`) field + UI chips + filtering on the sites list.
- **Reuse:** `WordPressSite.to_dict`, `WordPressSiteCard.jsx`.
- **Done when:** Sites can be tagged and filtered.

### #21 — Temporary preview URL before DNS is pointed `[M]` ❌ — ⏸️ Deferred (BLOCKED: a genuinely public, TLS-valid preview URL needs a pre-configured public base domain + wildcard DNS; managed sites are localhost:port only. Revisit after a public base-domain setting exists.)
- **Today:** `EnvironmentDomainService.generate_domain` only emits real subdomains or a `.localhost` fallback; the env nginx template listens on `:80` only. No preview hostname scheme.
- **Do:** Add a wildcard/preview hostname (e.g. `<site>.preview.<panel-domain>` or a `*.sslip.io`-style scheme) with auto TLS so a site is reachable and verifiable pre-DNS.
- **Reuse:** `environment_domain_service`, wildcard SSL (#8).
- **Done when:** Every new site gets a working HTTPS preview link immediately.

---

## Phase C — WordPress-aware performance & observability

The headline value of a managed platform, and the most net-new — but it leans on existing nginx/cache/health/metrics/notification primitives. **Estimated cluster: 4–7 days.**

### #22 — Page cache with WP-aware skip rules `[L]` ❌ — ✅ Done (Docker-correct: in-container cache-enabler plugin, NOT nginx fastcgi_cache which doesn't apply to the apache-container model)
- **Today:** `nginx_advanced_service` can emit `proxy_cache_path`/`proxy_cache`/`proxy_cache_bypass` zones with config-test + diff, but the WP location template (`services/nginx_service.py:215-237`) has **no** cache and the WP UI has no cache controls.
- **Do:** Add `fastcgi_cache`/`proxy_cache` to the per-site vhost with skip rules (`wp-admin`/`wp-login`/preview, auth/cart/checkout cookies, query strings) + a single-URL purge action wired to the existing `flush-cache` (#5).
- **Reuse:** `nginx_advanced_service`, `nginx_service` WP template.
- **Done when:** Anonymous hits are cached; logged-in/cart paths bypass; purge works.

### #23 — Per-site Redis object cache `[L]` ❌ — ✅ Done (adds a redis service to the compose stack + redis-cache plugin via wp_cli; new sites ship redis, existing sites get it injected on enable)
- **Today:** Only a blind `wp cache flush` with nothing behind it.
- **Do:** Add a Redis service to the compose stack (or a shared Redis DB index per env); `wp plugin install redis-cache --activate`; write `WP_REDIS_HOST`/`WP_REDIS_DATABASE` into `wp-config`; surface enable/status/flush on the site.
- **Reuse:** `wp_cli`, `wordpress.yaml` compose template, `flush_cache`.
- **Done when:** Object cache is enabled and reports a hit ratio.

### #24 — Per-site PHP version & limits panel `[M]` 🟡 — ✅ Done (read panel: live version + limits via wp eval; version switch via image tag + recreate. Arbitrary limit-WRITE deferred — needs a conf.d ini + compose bind-mount for durability)
- **Today:** The full PHP-FPM API (`getPHPVersions`/`setDefaultPHPVersion`/`installPHPVersion`/`createPHPPool`/`getPHPPools`/`restartPHPFPM` in `services/system.js`) has **zero** frontend consumers; `php_version` on `Application` is write-once with no update route, and pools are decoupled from the WP model.
- **Do:** A per-site PHP panel (version + `memory_limit`/upload size/`max_execution_time`/workers) bound to the WP environment + an update-pool/change-version route.
- **Reuse:** `php_service`, `system.js`.
- **Done when:** A site's PHP version and limits are editable per environment.

### #25 — Per-site traffic / error / cache analytics `[L]` ❌ — ✅ Done (Docker-correct: on-demand apache access-log analytics; PHP-fatals / response-time / cache-ratio deferred)
- **Today:** All metrics are host/agent-keyed; API analytics covers only ServerKit's own API. No per-site visits/bandwidth/5xx/404/PHP-fatal.
- **Do:** An nginx access/error + `wp-content/debug.log` ingest pipeline keyed to each WP vhost → visits, bandwidth, bot %, top URLs, 5xx/404, PHP fatals, slow pages, cache hit ratio.
- **Reuse:** the existing log-tail / `metrics_history_service` aggregation patterns.
- **Done when:** The site dashboard shows per-site traffic and error analytics.
- **Landed:** **Architectural pivot** — managed WP sites are `wordpress:*-apache` containers on `localhost:PORT` with **no per-site nginx**, so the roadmap's "nginx access log" premise doesn't hold; the official image symlinks Apache's access log to the container's **stdout**, making `docker logs` the Docker-correct source. New `WpAnalyticsService.get_traffic(container_name, hours)` pulls `docker logs --tail 20000 --since <h>` (**hard 15s timeout**, reads only **stdout** to separate the access log from the stderr error_log, `returncode`-checked so stopped/missing/remote-agent containers degrade to an accurate note) and parses the Apache *combined* log **on-demand** — no store / collector / migration. It returns requests, unique visitors, bandwidth, status distribution (2xx/3xx/4xx/5xx), 404s, bot %, error rate, top URLs (grouped by route — query strings stripped so visitor tokens aren't surfaced), and a continuous hourly requests/errors series. Route `GET /sites/<id>/analytics?hours=` (owner/admin-guarded), client `getSiteAnalytics`, and a new **Analytics tab** on the site detail (stat cards + a recharts requests/errors AreaChart + status codes + Top URLs) with graceful empty/timeout/unavailable states. This also supplies the 5xx/error-rate signal **#27**'s "error spike" rule needs. *(Deferred — not derivable from the default access log: **PHP fatals** need `wp-content/debug.log` via a WP_DEBUG toggle (#30); **response time / slow pages** need a `%D` LogFormat the official image doesn't emit; **cache hit ratio** is a cache-plugin concern (#22/#23). History is point-in-time over the retained container log (resets on container recreate) — a persistent time-series collector on the `metrics_history` pattern is a clean follow-up.)* Verified: backend `py_compile`, frontend lint-clean + production build, a 3-lens adversarial review (major fixed: docker-logs timeout + memory cap; minor: accurate unavailable note via `returncode`; query-string token stripping). Not runtime-exercised on a real Docker host (Windows dev).

### #26 — Per-site uptime + auto-incidents `[M]` 🟡 — ✅ Done (server-side health poller → bound status-page component with a real uptime % + auto-open/resolve incidents)
- **Today:** Status pages / uptime have no FK to a WP site; components are hand-typed with arbitrary `check_target`; `EnvironmentHealthService` outages don't open incidents.
- **Do:** Background-schedule `EnvironmentHealthService` checks to accrue per-site uptime %; auto-create a status-page component from a managed site; bridge `health_status` → status component + auto-open incident on outage.
- **Reuse:** `EnvironmentHealthService`, `status_page_service`, `uptime_service`.
- **Done when:** A managed site appears on a status page with a real uptime % and auto-incidents.
- **Landed:** A **server-side daemon-thread health poller** (`_start_health_check_scheduler`, 300s, single-worker-guarded) runs `check_health` for every **running production** site — skipping archived/stopped stacks so an intentional stop is never an outage — which keeps `health_status` fresh **autonomously** (so #27's alerts fire without the browser health card open) and drives bound status-page components. **Schema** (Alembic `010` + the boot-time `_fix_missing_columns` auto-add): `status_components.wordpress_site_id` (→ `wordpress_sites`) and `status_incidents.component_id` (→ `status_components`); the existing `HealthCheck` table is reused as the uptime sample store (no new table). New `StatusPageService.sync_component_from_health` maps the health verdict (healthy→operational, degraded→degraded, unhealthy→major_outage; `unknown` skipped so it never pollutes the %), records a `HealthCheck`, recomputes a **real uptime %** (`COUNT`-based over 24h/7d/30d/90d — only fully-healthy checks count, so degraded reduces it), and **auto-opens an incident on entering a major outage / auto-resolves on leaving it** (to operational *or* degraded, so a degraded intermediate poll never strands the incident). Sample rows are pruned to 90 days (once/day) to bound growth. WP routes `GET/POST/DELETE /sites/<id>/status-page` read the binding + attach (**production-only**) / detach (resolves & unlinks the incident first → no dangling FK on PostgreSQL, no stale public incident), plus a new **Uptime tab** on the site detail (health + uptime % + attach/detach). **Security:** internal probe config (`check_target`, intervals) is stripped from the *unauthenticated* public-page projection, and a health-driven component stores no internal `localhost:port` target. Verified: backend `py_compile`, frontend lint-clean + production build, and a 3-lens adversarial review (3 major findings fixed: the incident-resolve edge, the detach FK/orphan, and the public `check_target` leak). Not runtime-exercised on a real Docker host (Windows dev).

### #27 — WP-aware alerting `[M]` 🟡 — ✅ Done (site down/recovered → channels + catalog event, edge-triggered; error-spike deferred to #25)
- **Today:** Multi-channel `notification_service` (email/Slack/Discord/Telegram/webhook) exists; the `WorkflowEventBus` `health_check_failed` hook exists; neither knows about WordPress sites.
- **Do:** Add WP alert rules (site down / health failed / error spike) routed through `notification_service` via the event bus.
- **Reuse:** `notification_service`, `WorkflowEventBus`.
- **Done when:** A site outage or error spike pings the configured channel.
- **Landed:** `EnvironmentHealthService.check_health` now captures the prior `health_status` and, **on a state TRANSITION only** (edge-triggered — a continuously-down site fires a single down alert, recovery fires a single up alert, so an autonomous poller never spams), routes a WP health alert through three sinks: (1) the existing `WorkflowEventBus.emit('health_check_failed')` hook is **preserved** (still fires every failing poll for back-compat with event-trigger workflows); (2) **NEW** — `NotificationService.send_all` dispatches to every enabled channel (Discord/Slack/Telegram/email/generic), `unhealthy→critical` / `degraded→warning` (delivered by default channels) and recovery→`info` (delivered only to channels that opt into `info`); fired **off-thread** because `send_all` does blocking HTTP/SMTP and must not stall the health check; (3) **NEW** — `wordpress.site_down` / `wordpress.site_up` added to `EVENT_CATALOG` and emitted via `EventService`, so user webhook subscriptions (incl. a `wordpress.*` wildcard) deliver with HMAC + retry, and the events auto-appear in the event-subscription UI (`GET …/events` returns the catalog). **No schema/migration and no frontend** — channel delivery is governed by the existing Notifications settings; this also seeds **#35**'s WP lifecycle-event registry. *(Deferred: the "error spike" rule needs the per-site error metrics that **#25** will provide — revisit once #25 lands. Alerts are most useful once **#26**'s server-side scheduler runs `check_health` autonomously; today health only runs while the #6 card is open.)*

---

## Phase D — Safe updates, security depth, agency scale

Highest-effort, broadest surface — but by now the `WordPressSite` is a first-class object with health, SSL, backups, cache, and an API-key-reachable REST surface, so these bind cleanly. **Estimated cluster: 1–2 weeks, parallelizable.**

### #28 — Plugin/theme/core vulnerability scanning `[L]` ❌ — ✅ Done (keyless WPVulnerability feed; per-site findings with severity)
- **Today:** `get_plugins`/`get_themes` return slug + version; the VulnerabilityTab is OS-only (Lynis). No WP vuln feed.
- **Do:** Cross-reference slug+version against a public WordPress vulnerability API (e.g. a WPScan/Patchstack-style feed), persist findings per `WordPressSite`, surface in the VulnerabilityTab.
- **Reuse:** `get_plugins`/`get_themes`, the existing vuln UI shell.
- **Done when:** Vulnerable plugins/themes are flagged per site with severity.
- **Landed:** New `WpVulnerabilityService` reads installed plugin/theme/core slug+version via the **Docker-aware WP-CLI** bridge (`wp core version` + `get_plugins`/`get_themes` directly — *not* the host-filesystem-gated `get_wordpress_info`, which fails for volume-backed sites) and cross-references the **keyless community WPVulnerability API** (`https://www.wpvulnerability.net/{plugin,theme,core}/…`, no signup, 1h in-memory cache, descriptive UA, 8s timeout). It matches the installed version against each advisory's `operator` bounds (plugins/themes; core advisories all apply since the feed is version-scoped), extracts CVE id / severity (`cvss3` → `cvss` short-code → score fallback) / fixed-in / reference, and persists results as a new **`WordPressVulnerability`** child model (FK → `wordpress_sites.id`) + a `last_vuln_scan_at` column (Alembic **011**, idempotent). The scan runs in a **background thread** (Lynis-style, so the single worker never blocks on the WP-CLI + external HTTP), and a new **Vulnerabilities tab** on the site detail polls for status and renders findings with severity badges, CVE links, installed/fixed versions, and a summary. On-demand only (no scheduled external calls). Security hardening (3-lens review): `reference_url` is restricted to http(s) (blocks `javascript:` hrefs), the feed slug is percent-encoded, and an unrecognized version operator skips rather than over-flags. *(Deferred follow-ups: a scheduled periodic re-scan, and an optional "bring-your-own WPScan API key" for manually-verified data.)* Verified: backend `py_compile`, frontend lint-clean + production build, 3-lens adversarial review (major fixed: the Docker volume-backed core-read gating). Not runtime-exercised on a real host.

### #29 — Safe update manager `[L]` 🟡
- **Today:** Update primitives exist (#7); no history, scheduling, exclusions, staging-first, and pre-update backup is DB-only/core-only.
- **Do:** Scheduled updates via the cron workflow scheduler + a maintenance-window concept; an exclusion list + update-run records per site; **files + db** pre-update snapshot (not just db); run updates against the staging env via the promote pipeline; auto-rollback on failure using the pre-update snapshot + `restore_snapshot` (#10).
- **Reuse:** cron scheduler, `db_sync_service` snapshots, promote pipeline, `restore_snapshot`.
- **Done when:** Updates run on a schedule, staging-first, with backup + auto-rollback and a report.

### #30 — Per-site security depth `[L]` 🟡 — ✅ Done (file integrity + WP_DEBUG toggle + WP-Cron, Docker-correct; brute-force rate-limit jail deferred)
- **Today:** ClamAV + file-integrity scan host paths (`/var/www`, `/home`, `/etc`) and can't reach Docker WP volumes; nothing resolves a site to a scannable docroot; integrity never calls `wp ... verify-checksums`; no `wp-login.php`/`xmlrpc` rate-limit jail.
- **Do:** Per-site scan-target resolution; file integrity via `wp core/plugin/theme verify-checksums`; a Fail2ban jail/filter (or nginx `limit_req` zone) targeting each site's access log for `wp-login.php`/`xmlrpc.php`; per-site `WP_DEBUG`/`SCRIPT_DEBUG` toggle and WP-Cron list/run/disable.
- **Reuse:** `security_service` (Fail2ban jails), `wp_cli`, `cron_service`, `nginx_service` WP template.
- **Done when:** A site can be scanned, checksum-verified, brute-force-protected, and debug-toggled.
- **Landed:** New `WpSecurityService` + a per-site **Security tab** (Docker-correct, all via the WP-CLI bridge): **(1) File integrity** — a background `wp core verify-checksums` + `wp plugin verify-checksums --all` (in-container, so it reaches the volume; runs off the request thread and the UI polls), flagging tampered/unexpected files. **(2) Debug toggle** — sets `WP_DEBUG`/`SCRIPT_DEBUG` with `WP_DEBUG_DISPLAY=false` and, crucially, **`WP_DEBUG_LOG=/tmp/wp-debug.log`** — *outside* the web root, so the log is never publicly fetchable (the default `wp-content/debug.log` is apache-served — a real info leak this avoids); the write is gated so a read-only/stopped site reports an honest failure. **(3) WP-Cron** — `DISABLE_WP_CRON` status + due-event list, run-due-now, and enable/disable (with a clear "needs a real system cron" warning). Routes mirror the established per-site pattern (owner-or-admin GET, `@admin_required` mutations). *(Deferred — the brute-force `wp-login`/`xmlrpc` **rate-limit jail**: Fail2ban/nginx `limit_req` both need a host-side per-site access log to watch, which the `localhost:PORT` apache-container model doesn't expose — the same per-site reverse-proxy/log gap as #21/#25/#8-backend. A WP-level login-limiter plugin is the Docker-correct alternative, deferred to honour the WP-CLI-over-plugin thesis.)* Verified: backend `py_compile`, frontend lint-clean + build, focused security review (debug-log web-exposure caught + fixed). Not runtime-exercised on a real host.

### #31 — Selective push UI `[S]` 🟡 — ✅ Done (specific-tables selectors added; files-only/db-only/specific-folders already existed)
- **Today:** The dump layer already supports table filters / files-only / db-only; `PromoteModal` exposes only coarse code/db/full.
- **Do:** Expose files-only / db-only / specific-folders / specific-tables selectors in `PromoteModal`.
- **Reuse:** `db_sync_service` `_transform_dump` filters, `environment_pipeline` promote.
- **Done when:** A promote can move just selected files/tables.
- **Landed:** `PromoteModal` already had **files-only** (`code` type), **db-only** (`database` type), and **specific-folders** (the `include_plugins`/`themes`/`mu_plugins`/`uploads` checkboxes); the only missing piece was **specific-tables**, now added as two comma-separated inputs in the database section — **Exclude tables** (omitted entirely) and **Truncate tables** (structure promoted, rows dropped) — split into arrays on submit. The full backend chain already honored them (`POST …/promote` documents+forwards `config.exclude_tables`/`truncate_tables` → `promote_database`/`promote_full` → `clone_options` → `_transform_dump`), so this is pure UI wiring with no backend change. Verified: frontend lint-clean + production build.

### #32 — Per-site SFTP `[M]` ❌
- **Today:** FTP is host-global (`ftp_service`); no per-site SFTP.
- **Do:** Add SFTP via an sshd `Subsystem`/chroot scoped to the site root, bound to the site object.
- **Reuse:** `ftp_service` patterns.
- **Done when:** Each site exposes scoped SFTP credentials.

### #33 — Agency scale (workspaces, RBAC, white-label, reports) `[XL]` 🟡
- **Today:** No `workspace_id` FK on `Application`/`WordPressSite`/`Server`; permissions are global with no per-site ACL; white-label lives in `localStorage` and never reads `Workspace.logo_url`/`primary_color`.
- **Do:** Add `workspace_id` FKs + per-site ACL rows + environment-tier RBAC in promote/sync/bulk endpoints; server-side branding scoped to workspace; monthly client reports aggregating uptime/updates/backups/security.
- **Reuse:** `workspace_service`, `permission_service`, `audit_service`.
- **Done when:** A site/environment can be scoped to a workspace with per-site roles and branded reports.

### #34 — Horizontal scaling `[XL]` ❌
- **Today:** `nginx_advanced_service` has load-balancing primitives (round-robin/least-conn/IP-hash) but WP containers are stateful (local uploads, no shared object cache).
- **Do:** Make WP stateless — shared media (uploads on a shared volume or S3 offload), shared Redis object cache (#23), then nginx `upstream` load balancing across replicas with sticky handling where needed.
- **Reuse:** `nginx_advanced_service`, #23, `storage_provider_service`.
- **Done when:** A site can run N replicas behind a balancer with consistent media + cache.

### #35 — WordPress workflow nodes, events & CLI `[L]` 🟡
- **Today:** The event/webhook + workflow engine can't see a `WordPressSite` — `EVENT_CATALOG` has no WP lifecycle events, WP operations emit nothing, the workflow builder has no WP node types, and there's no `serverkit wp` CLI.
- **Do:** Emit WP lifecycle events (`backup.completed` / `deploy.failed` / `ssl.renewed` / `update.available`); add WordPress workflow nodes that call existing WP services; add CLI verbs (`serverkit wp backup:create` / `env:clone` / `deploy`) against the now-API-key-reachable routes (#14).
- **Reuse:** `workflow_engine`, `event_service`, `webhook_service`, the API-key surface.
- **Done when:** "Every Sunday: snapshot all sites, update staging, notify" can be built as a workflow, and the CLI drives it.

---

## The "almost there" cluster (knock these out first)

These are 🟡 tasks where the backend/model already exists — mostly wiring. Highest payoff, lowest risk, very parallelizable:

> **#3, #5, #6, #7, #9, #10, #11, #12, #13, #14, #19, #24, #26, #27, #31**

Plus the two safety bugs: **#1, #4**.

A focused session could realistically land the Phase 0 bugs (#1–#4) and a chunk of the glue cluster (#5, #9, #10, #12, #14) in a single sitting, since each is an isolated wire-up against a service that already works.

---

## Reference — key WordPress files

| Area | File |
|---|---|
| Site object model | `backend/app/models/wordpress_site.py` (`WordPressSite`, `DatabaseSnapshot`, `SyncJob`) |
| WP-CLI + lifecycle | `backend/app/services/wordpress_service.py` |
| Environment pipeline | `backend/app/services/environment_pipeline_service.py`, `wordpress_env_service.py` |
| DB clone / search-replace / sanitize | `backend/app/services/db_sync_service.py` |
| Env Docker / domains / health | `environment_docker_service.py`, `environment_domain_service.py`, `environment_health_service.py` |
| WP API routes | `backend/app/api/wordpress.py`, `wordpress_sites.py`, `environment_pipeline.py` |
| Blueprint registration | `backend/app/__init__.py:118-124` |
| Frontend hub | `frontend/src/pages/WordPress.jsx`, `WordPressDetail.jsx`, `WordPressProject.jsx`, `WordPressProjects.jsx` |
| Frontend components | `frontend/src/components/wordpress/` |
| Frontend API client | `frontend/src/services/wordpress.js`, `services/api/wordpress.js` |
| Reusable primitives | `ssl_service.py`, `advanced_ssl_service.py`, `storage_provider_service.py`, `backup_service.py`, `nginx_advanced_service.py`, `notification_service.py`, `workflow_engine.py`, `security_service.py` |

---

*Scope: 35 tasks across 5 phases. Phase 0 is a blocker; Phase A is mostly wiring of existing services; Phases B–D are the net-new managed-platform layer. Numbers are stable references — cite them directly (e.g. "do #16").*
