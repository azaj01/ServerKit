# Analytics (`serverkit-analytics`)

Native, privacy-first web analytics for the sites this panel manages. It is a
built-in **extension** (opt-in) — install it from **Marketplace → Built-in →
Analytics**, or `POST /api/v1/plugins/builtin/serverkit-analytics/install`.

> **Two things share the name `serverkit-analytics`.** This document is about the
> **panel extension** (the dashboard + collector). A separate **WordPress
> companion plugin** of the same name (plan 51) auto-injects this extension's
> tracker into WordPress sites. Until that ships, the panel injects a small
> mu-plugin itself (see [WordPress](#wordpress)).

## What it is (and isn't)

- **Self-hosted, first-party only.** Pageviews and events are stored in the
  panel's own database. Nothing is sent to any third party.
- **Cookieless.** No cookies, no `localStorage`, no fingerprinting, no cross-site
  anything. Visitor identity is a **daily-rotating salted hash** of IP + user
  agent (Matomo-style). The salt lives only in memory, rotates at UTC midnight,
  and is never persisted. **Raw IP addresses are never stored** — only the hash
  and (optionally) a country code.
- **Do Not Track is honored** by default (both the tracker and the server check).
- **Not** session replay, heatmaps, funnels, A/B testing, or e-commerce
  tracking. Bot filtering is a user-agent denylist plus heuristics, not
  Google-grade.

If you want a full third-party stack instead, the **Umami / Plausible / PostHog**
deploy templates are still available under **New Service → Templates** — they run
as their own containers and are unaffected by this extension.

## Two data sources

You can use either or both per site:

1. **JavaScript tracker** (`sk.js`) — a ~3 KB script you paste into your pages
   (or have ServerKit inject). Sends one small beacon per pageview via
   `navigator.sendBeacon` (with a `fetch(keepalive)` fallback). Captures the URL
   path, external referrer, screen-size bucket, language, page-load time
   (Navigation Timing), single-page-app navigations, and — opt-in — outbound and
   download clicks. It fails silently if the panel is down or the extension is
   disabled.
2. **Server-log ingestion** — script-free. ServerKit parses the site's
   apache/nginx **combined** access log incrementally (via `docker logs` for
   containerized sites, or a log file for bare-metal) and records page-like GET
   hits. Assets, non-GET requests, and known bots are skipped. Log-source hits
   are tagged `source='log'` so you can compare them with JS-source hits.

## The dashboard (`/analytics`)

- **Overview** — visitors, pageviews, bounce rate, avg load; a trend chart; top
  pages and referrers; a live "last 30 minutes" counter.
- **Pages / Referrers / Devices** — sortable tables over a date range (1d/7d/
  14d/30d/90d).
- **Realtime** — active visitors and recent hits in the last N minutes (polled).
- **Sites** — add/edit tracked sites, copy the tracking snippet, rotate a site
  key, enable/disable, and manage per-site settings.

## Installing the tracker

### Copy-paste snippet

From **Sites → (a site) → snippet**, or `GET /api/v1/analytics/sites/<id>/snippet`:

```html
<script defer src="https://your-panel/api/v1/analytics/tracker.js"
        data-site-key="YOUR_SITE_KEY"></script>
```

Add `data-outlinks="true"` to also track outbound + download clicks. Put it in
the `<head>` of every page you want to track. It is cookieless and needs no
consent banner for basic pageview counting in most jurisdictions (confirm your
own compliance obligations).

### WordPress

If the WordPress flagship is installed, ServerKit can inject the tracker for you.
For containerized WordPress (the default template uses a Docker **named volume**,
not a host bind-mount), the panel writes a tiny **mu-plugin** into the container
at `wp-content/mu-plugins/serverkit-analytics.php` via `docker exec`. It emits
the snippet in `wp_head`, survives theme switches, and is removed when you
disable injection or uninstall the extension. Bare-metal WordPress gets the same
file written to the host path (owned by `www-data`).

Trigger it with `POST /api/v1/analytics/sites/<id>/inject/wordpress` (the site's
`app_id` must point at the WordPress site). The WordPress **Analytics** tab shows
a banner linking here when the extension is installed.

### Any nginx-proxied app

For a managed app whose vhost ServerKit owns, it can inject an nginx `sub_filter`
that rewrites `</body>` to include the snippet in HTML responses — no app change
needed. The edit is a guarded, idempotent, reversible block; ServerKit validates
with `nginx -t` **before** reloading and reverts the file if the test fails, so a
bad edit can never take nginx down. Default **off**; opt-in per app via
`POST /api/v1/analytics/sites/<id>/inject/nginx`.

> nginx caveat: `sub_filter` needs an uncompressed upstream body. ServerKit adds
> `proxy_set_header Accept-Encoding "";` at server scope, but a location-level
> `proxy_set_header` block in the generated vhost can override it. Also, a vhost
> regeneration (domain/SSL/cache change) drops the injected block — re-inject
> after such changes. The JS snippet path has neither caveat.

## Privacy model, in one paragraph

A visit is recorded as: the URL **path** (query strings dropped unless you opt
in), the external referrer **host**, coarse device/browser/OS class, an optional
**country** (see [Geolocation](#geolocation)), and a **visitor hash** =
`HMAC(daily_salt, site | ip | user-agent)` truncated to 32 hex chars. The salt is
random, in-memory, and rotates daily, so hashes can't be correlated across days
or reversed to an IP. Because the salt is not persisted, a panel restart mid-day
rotates it early; and because identity is IP+UA rather than a cookie, shared IPs
and UA churn make visitor counts close **approximations**, not exact identities.

## Configuration

Marketplace → Installed → Analytics → **Configure**:

| Setting | Default | Purpose |
|---|---|---|
| `raw_retention_days` | 30 | How long individual event rows are kept before pruning. |
| `rollup_retention_months` | 13 | How long the daily rollup time series is kept. |
| `honor_dnt` | true | Drop hits from browsers sending `DNT: 1`. |
| `geo_enabled` | false | Fill a country code from a GeoLite2 DB (see below). |
| `geo_db_path` | — | Absolute path to `GeoLite2-Country.mmdb` on the panel host. |
| `collect_rate_per_min` | 600 | Token-bucket cap per site-key and per client IP. |
| `buffer_flush_seconds` | 5 | How often the in-memory event buffer flushes. |
| `buffer_max` | 100 | Flush early once this many events accumulate. |
| `store_query_strings` | false | Persist URL query strings (off avoids capturing tokens/PII). |
| `log_ingestion_enabled` | true | Allow the scheduled log-tail job to run. |

Per-site overrides (honor-DNT, allowed CORS origins, and log-ingestion source)
live on each site in the **Sites** tab.

## Geolocation

Country-level geolocation is **off by default** and **no database ships with the
panel** (licensing). To enable it, drop a `GeoLite2-Country.mmdb` on the panel
host, install the `geoip2` Python package, set `geo_enabled=true` and
`geo_db_path`. Absence of any of these leaves the country column null; no IP is
ever stored either way.

## Scale & the collector's protections

- **SQLite is the default DB.** A busy site can produce a lot of per-hit writes.
  Mitigations built in: a buffered batch-insert flush thread, hourly rollups into
  a compact daily table, and daily retention pruning. **For a high-traffic panel
  (≈10k+ visits/day), run the panel on PostgreSQL.**
- The public `POST /collect` endpoint is protected by: a per-site **key** (not a
  JWT), a token-bucket **rate limit** (per key and per IP), an **8 KB body cap**,
  scoped per-site **CORS**, and **bot/DNT filtering** (filtered hits are silently
  accepted so abusers learn nothing).
- **Disabling the extension stops collection** — the platform returns `503` for a
  disabled plugin's routes, and the tracker fails silently on any non-2xx.
  Uninstalling with `--purge` drops all `ext_serverkit_analytics_*` tables and
  removes any injected WordPress/nginx snippets.

## Single-worker note

Like the rest of the agent-gateway-bearing panel, the collector's in-memory
buffer and rate limiter assume a **single** gunicorn worker (see
[SECURITY.md](../SECURITY.md) and [ARCHITECTURE.md](ARCHITECTURE.md)). This is
already the required deployment topology.
