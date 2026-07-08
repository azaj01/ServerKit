# Extension Registry & Publishing

The **registry** is how third-party (and non-bundled first-party) extensions
become browsable in the Marketplace without any per-panel seeding. It is a single
curated `index.json`; panels fetch it, merge its entries into Browse labeled
"Registry", and install from it with checksum verification.

This document is the format spec (task #16) and the publisher guide (task #21).

---

## How a panel consumes the registry

- The panel fetches the index from `SERVERKIT_REGISTRY_URL` (env var). When unset
  it defaults to the curated public registry
  (`https://raw.githubusercontent.com/jhd3197/serverkit-extensions/main/index.json`);
  set it **empty** to disable remote fetching entirely (air-gapped panels). When
  the fetch fails (offline), it falls back to the **last good cache**, then to a
  **bundled copy** shipped at `backend/app/data/registry_index.json`. The
  Marketplace never blanks.
- Results are cached in-memory for `SERVERKIT_REGISTRY_TTL` seconds (default 3600).
- Discovery is **read-only** — nothing in the registry is ever auto-installed.
- Installing a registry entry downloads its `source`, verifies `sha256` (when
  present) before extraction, and checks the panel version against
  `min_panel_version` / `max_panel_version`.

Relevant endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/marketplace/registry` | list registry entries + live install state |
| `POST /api/v1/marketplace/registry/<slug>/install` | checksum-verified install (admin) |
| `GET /api/v1/plugins/updates` | installed plugins with a newer registry version |
| `POST /api/v1/plugins/<id>/update` | update a plugin to the registry version (admin) |

---

## `index.json` format (schema_version 1)

```jsonc
{
  "schema_version": 1,
  "updated": "2026-07-01",
  "extensions": [
    {
      "slug": "serverkit-gui",                 // required — matches the manifest name
      "display_name": "ServerKit Agent GUI",   // required
      "description": "…",
      "version": "0.1.0",                       // required — the published version
      "category": "monitoring",                 // ai|monitoring|security|deployment|integration|ui|utility
      "author": "Juan Denis",
      "first_party": false,                     // true only for ServerKit-authored entries
      "permissions": ["network"],               // declared host permissions (honesty is reviewed)
      "min_panel_version": "1.7.0",             // optional compat gate (inclusive)
      "max_panel_version": null,                // optional
      "sdk_version": "^1.0.0",                   // optional (additive) — frontend SDK range the bundle targets
      "source": "https://github.com/owner/repo", // repo URL (latest release), release URL, or direct .zip
      "sha256": "…",                            // sha256 of the release zip — STRONGLY recommended
      "release_notes": "…",                      // optional (additive) — shown in the update-diff modal
      "homepage": "https://…",
      "icon": "<svg-inner-markup/>",            // rendered on the detail view
      "screenshots": ["https://…/1.png"]        // rendered on the detail view
    }
  ]
}
```

Notes:
- `source` accepts the same forms as a URL install: a GitHub repo URL (resolves the
  latest release asset), a release-tag URL, or a direct `.zip` URL.
- `sha256` is the digest of the exact zip `source` resolves to. When present it is
  **enforced** — a mismatch is a hard failure with no partial install. Omit only
  while prototyping.
- `min_panel_version`/`max_panel_version` are compared against the panel's
  `VERSION`. An incompatible entry can be listed but not installed/updated.
- `sdk_version` (additive) is the semver range of the frontend SDK a **runtime
  bundle** targets — see [EXTENSIONS.md](EXTENSIONS.md) → *The SDK contract*. Checked
  at install and at load. Older panels ignore it; older indexes omit it.
- `release_notes` (additive) is free text shown in the Marketplace **update-diff**
  modal alongside the version + permissions delta. Old panels ignore it.

---

## Publishing an extension

1. **Structure the repo** per [`docs/EXTENSIONS.md`](EXTENSIONS.md): a `plugin.json`
   at the archive root, plus `backend/` and/or `frontend/`. A third-party extension
   that ships a **prebuilt runtime bundle** (`frontend_entry: dist/index.mjs`,
   externalized shared libs) now renders on a prebuilt panel **with no rebuild** —
   see [`docs/EXTENSIONS_CI.md`](EXTENSIONS_CI.md) for the build→hash→publish recipe.
   (Backend-only extensions need no frontend at all.)

2. **Cut a release.** Tag a version and attach a plugin `.zip` as a release asset
   (the installer prefers a `.zip` asset over the source zipball). Record the
   asset's `sha256`:
   ```bash
   sha256sum my-extension-0.1.0.zip
   ```

3. **Submit the index PR.** Open a PR against the `serverkit-extensions` repo adding
   (or bumping) your entry in `index.json`. Bumping `version` is what surfaces the
   "Update available" badge on installed panels.

### Review checklist (what a maintainer verifies)

- **Permissions honesty** — declared `permissions` match what the code actually
  uses (`docker|filesystem|shell|network|db`, or `agent.command:*`). Over-broad or
  undeclared permissions are rejected. Enforcement (Phase 3 #25) makes an
  undeclared capability raise at runtime — declare accurately.
- **Checksum** — `sha256` present and matches the release asset.
- **License** — a real OSS license (`license` field + a LICENSE in the repo).
- **Compat** — `min_panel_version` reflects the oldest panel actually tested.
- **Frontend bundle** — if the extension ships UI, it's a **runtime ESM bundle**
  (`frontend_entry: dist/index.mjs`) that passes `--validate` (no embedded React,
  shared libs externalized). Raw `.jsx` frontends don't render on prebuilt panels.
- **SDK range** — `sdk_version` present for any extension shipping a runtime bundle
  and reflects the SDK it was actually built + tested against.
- **Brand-neutral** — no competitor names in the name/description (project policy).

Free/OSS project: there are **no paid extensions, quotas, or billing** — ever.
