# Extension CI recipe (build → hash → publish)

For a **runtime-ESM** extension (one that ships a prebuilt `frontend/dist/index.mjs`
and loads with no panel rebuild — see [EXTENSIONS.md](EXTENSIONS.md) → *Runtime
frontend bundles*), automate the release so every published artifact is built,
integrity-hashed, and linted the same way.

> Mirror this file into the `serverkit-extensions` registry repo's contributor
> guide so publishers find it where they submit.

---

## The pipeline

1. **Build** the runtime bundle with the shared libs externalized
   (`react`, `react-dom`, `react/jsx-runtime`, `react-router-dom`, `serverkit-sdk`).
   The `--template frontend-esm` scaffold's `vite.config.mjs` already does this.
2. **Hash** the built bundle (`dist/hashes.json` via `hash-bundle.mjs`) and the
   release **zip** (the `sha256` the registry entry pins).
3. **Lint** the manifest + bundle (rejects embedded React / un-externalized libs).
4. **Attach** the zip to a GitHub release.
5. **Open the registry PR** bumping your `index.json` entry (`version`, `source`,
   `sha256`, `sdk_version`).

---

## GitHub Actions example

`.github/workflows/release.yml` in the extension repo:

```yaml
name: release
on:
  push:
    tags: ['v*']

jobs:
  build-and-publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # create the release + upload the asset
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      # 1. Build the runtime bundle (externalized).
      - name: Build frontend bundle
        working-directory: frontend
        run: |
          npm ci
          npm run build        # → frontend/dist/index.mjs (+ dist/hashes.json)

      # 2. Lint manifest + bundle against the panel's own rules.
      #    Vendored copy of scripts/new-extension.mjs, or fetch it from the panel
      #    repo at a pinned tag.
      - name: Validate manifest + bundle
        run: node tools/new-extension.mjs --validate .

      # 3. Package the extension (plugin.json + frontend/dist + backend/…).
      - name: Package zip
        id: pkg
        run: |
          SLUG=$(node -p "require('./plugin.json').name")
          VER=$(node -p "require('./plugin.json').version")
          ZIP="${SLUG}-${VER}.zip"
          zip -r "$ZIP" plugin.json frontend/dist backend 2>/dev/null || \
            zip -r "$ZIP" plugin.json frontend/dist
          echo "zip=$ZIP" >> "$GITHUB_OUTPUT"
          echo "sha256=$(sha256sum "$ZIP" | cut -d' ' -f1)" >> "$GITHUB_OUTPUT"

      # 4. Attach to the release.
      - name: Release
        uses: softprops/action-gh-release@v2
        with:
          files: ${{ steps.pkg.outputs.zip }}
          body: |
            sha256: `${{ steps.pkg.outputs.sha256 }}`

      - name: Registry entry to paste
        run: |
          echo "Add/bump this in serverkit-extensions/index.json:"
          echo '  "version": "'"$(node -p "require('./plugin.json').version")"'",'
          echo '  "source": "<release-zip-url>",'
          echo '  "sha256": "${{ steps.pkg.outputs.sha256 }}",'
          echo '  "sdk_version": "'"$(node -p "require('./plugin.json').sdk_version||''")"'"'
```

The printed `sha256` is exactly what the registry `index.json` entry must pin — the
panel re-verifies it before extraction, and the runtime loader re-verifies the
bundle's own sha256 at every load.

## What the panel checks at load time

Two guarantees apply to your runtime bundle on every panel, and you don't have to
do anything extra for them — but knowing them explains the failure cards users may
see:

- **Integrity works on HTTP-only panels too.** ServerKit's SSL is optional, so
  some panels run over plain HTTP where the browser's `crypto.subtle` is
  unavailable. The loader falls back to a bundled pure-JS sha256 that computes the
  **same** digest — there is no unverified path. Practical note: JS hashing is
  slower than native, so keep the bundle lean (it's size-capped regardless).

- **Declare `sdk_version`.** Pin the SDK range your bundle was built against in
  `plugin.json` (e.g. `"sdk_version": "^1.0.0"`). The loader compares it against
  the panel's SDK **before** fetching your bundle and refuses an incompatible one
  with a clear "needs SDK x, panel has y" card instead of a cryptic import error.
  Omitting the range gets a one-release grace (warn-and-load), but declare it —
  the Marketplace also uses it to flag incompatible installs/updates up front.

---

## Local one-shot (no CI)

```bash
cd frontend && npm ci && npm run build && cd ..
node <serverkit>/scripts/new-extension.mjs --validate .
zip -r my-ext-1.0.0.zip plugin.json frontend/dist backend
sha256sum my-ext-1.0.0.zip     # → the index.json `sha256`
```

Then open the registry PR. See [EXTENSIONS_REGISTRY.md](EXTENSIONS_REGISTRY.md) for
the index format and the maintainer review checklist.
