# runtime-extension fixture

A tiny **runtime-loadable** ServerKit extension (plan 25 #12). It ships a
prebuilt, externalized `frontend/dist/index.mjs` and no source/build tooling, so
it doubles as:

- a **backend test** fixture (`test_runtime_frontend.py`) — install it and assert
  the dist bundle survives a local install, its sha256 is recorded, and it shows
  up in the `/plugins/contributions` `frontends` map;
- a **render smoke test** target for the screenshots skill (a real extension page
  that loads through the runtime path).

The bundle imports its shared libraries (`react/jsx-runtime`, `serverkit-sdk`) as
**bare specifiers** — exactly what a `vite build` with those libs externalized
emits — so the panel resolves them to its own singletons via the import map. It
bundles no React of its own. Hand-checked-in on purpose: no `npm install`/build
is needed to run the tests.
