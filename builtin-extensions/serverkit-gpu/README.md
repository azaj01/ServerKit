# serverkit-gpu

Live NVIDIA GPU metrics (utilization, VRAM, temperature, power, fan) for servers
with a GPU. The first **CORE_SLIM** slice (plan 32 #7): both halves now live in
this extension.

## Layout

```
serverkit-gpu/
  plugin.json                     # entry_point gpu:gpu_bp, url_prefix /api/v1/gpu, sdk_version ^1.0.0
  backend/
    __init__.py
    gpu.py                        # blueprint (gpu_bp) — thin routing over the service
    gpu_service.py                # nvidia-smi parsing (no app.* imports)
  frontend/
    index.jsx                     # exports GpuMonitorPage (matched by contributions.routes)
    components/GpuMonitor.jsx      # the page UI (SDK + @/ imports)
```

The backend loads in-place as `app.plugins.serverkit-gpu` (mirrors the
CrowdSec/WordPress extraction). The frontend ships **baked**: pre-bundled into
`frontend/src/plugins/serverkit-gpu/` by `scripts/sync-builtin-frontends.mjs`
(the CI `--check` drift gate keeps source ↔ artifact in sync).

## Shipping as a runtime-ESM bundle (deferred — plan 32 #9)

This slice is intentionally kept on the **baked** path for one release
(CORE_SLIM dual-path guardrail). To later ship it as an external, no-rebuild
runtime bundle (the loader plan 32 hardens), follow
[docs/EXTENSIONS_CI.md](../../docs/EXTENSIONS_CI.md):

1. Add a `frontend/vite.config.mjs` (via `scripts/new-extension.mjs --template
   frontend-esm`) that externalizes `react`, `react-dom`, `react/jsx-runtime`,
   `react-router-dom`, `serverkit-sdk` and emits `dist/index.mjs`.
2. **Blocker to resolve first:** `GpuMonitor.jsx` imports `EmptyState` and
   `Button` from the host via the `@/` alias — these are NOT on the SDK surface,
   so an externalized build can't resolve them. Either promote both into
   `serverkit-sdk` (a deliberate SDK **minor** bump) or bundle equivalents into
   the extension. `_gpu.scss` (core design-system SCSS) must likewise move into
   the bundle's inlined CSS.
3. Set `frontend_entry: dist/index.mjs`, cut a release + `sha256`, and swap the
   registry entry — the operator runbook
   [docs/runbooks/extension-release-and-tamper-e2e.md](../../docs/runbooks/extension-release-and-tamper-e2e.md)
   covers publishing + the tamper e2e.

Until then the baked path serves the page and the runtime loader is unaffected.
