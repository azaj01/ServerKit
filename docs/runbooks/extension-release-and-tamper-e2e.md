# Runbook — Extension release cut + runtime-bundle tamper e2e

> Plan 32 #9 (carries plan 25 #13/#14). The no-rebuild runtime-frontend loader
> ships with real sha256 integrity, a load-time SDK gate, an HTTP-only digest
> fallback, and a Marketplace failure badge — all proven by unit/backend tests.
> What is **not** yet proven on a live box is the full **release → registry
> install → on-disk tamper → visible failure** loop, because it needs push/publish
> authority and a real server. This runbook is that proof.
>
> **Status: NOT YET EXECUTED.** Requires: (a) permission to cut a GitHub release
> and open a registry PR (publish authority), and (b) the DO test box (or any
> Linux VPS running the panel). Execute the steps, paste the scrubbed transcript
> into "Result", and the proving debt from plan 25 is closed.

## What this proves

1. A first-party extension can be shipped as a **released artifact** (zip +
   sha256) and installed **from the registry** onto a box — no repo checkout.
2. Its prebuilt runtime frontend loads through the hardened loader:
   integrity-verified, SDK-gated, blob-imported — with **no panel rebuild**.
3. If the on-disk bundle is **modified after install**, the next load **fails
   closed**: a failure card on the extension's routes and a `failed` runtime
   badge on the Marketplace installed row (plan 32 #5), never a silent execution.

`serverkit-gui` is the vehicle (it is already the first runtime-bundle builtin,
CORE_SLIM Tier A). The same recipe applies to any runtime-ESM extension.

## Preconditions

- The **serverkit-gui** source (sibling repo) builds a runtime bundle:
  `frontend/dist/index.mjs` via the externalized Vite lib build
  (see [../EXTENSIONS_CI.md](../EXTENSIONS_CI.md)).
- A Linux box running the panel over HTTPS **and**, for step 5, reachable over
  plain HTTP (to prove the pure-JS digest fallback also catches tampering).
- Admin JWT (`$TOKEN`) and the panel base URL (`$PANEL`).
- Registry write access (a PR against the public `serverkit-extensions` index).

## Steps

### 1. Cut the release artifact

In the `serverkit-gui` repo, on a clean tag:

```bash
cd frontend && npm ci && npm run build && cd ..      # → frontend/dist/index.mjs (+ dist/hashes.json)
node <serverkit>/scripts/new-extension.mjs --validate .   # manifest + bundle lint (rejects embedded React)
zip -r serverkit-gui-<VERSION>.zip plugin.json frontend/dist backend
sha256sum serverkit-gui-<VERSION>.zip                # ← the registry `sha256`
```

Attach the zip to a GitHub release for the tag. Record the release URL + sha256.

### 2. Swap the registry entry to the released artifact

Open a PR against the registry `index.json` changing the `serverkit-gui` entry
`source` to the release zip URL and pinning the printed `sha256` + the manifest's
`sdk_version`. Merge it. (The panel re-verifies the zip sha256 before extraction,
independently of the loader's per-load bundle check.)

### 3. Install from the registry on the test box

```bash
curl -s -X POST "$PANEL/api/v1/plugins/registry/serverkit-gui/install" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Confirm in the panel: the extension is **active**, its page renders, and the
Marketplace installed row shows a **Runtime loaded** badge (plan 32 #5). Capture
the recorded bundle hash:

```bash
curl -s "$PANEL/api/v1/plugins/contributions" -H "Authorization: Bearer $TOKEN" \
  | jq '.frontends["serverkit-gui"]'
# → { entry, sdk_version, hashes: { "dist/index.mjs": "<sha256>" } }
```

### 4. Tamper with the on-disk bundle → verify fail-closed

Flip a single byte in the **installed** bundle on the box (not the source):

```bash
# Locate the installed dist (frontend plugins dir), then mutate one byte:
BUNDLE="$(find / -path '*serverkit-gui/dist/index.mjs' 2>/dev/null | head -1)"
printf '\0' | dd of="$BUNDLE" bs=1 seek=0 count=1 conv=notrunc
```

Reload the panel (hard refresh). Expected:

- The extension's routes render the **ExtensionFailureCard** — "integrity check
  failed … the on-disk bundle was modified" — not the real UI, and no white
  screen.
- The Marketplace installed row shows a **Failed to load** runtime badge; its
  popover carries the integrity error string.
- The rest of the panel is unaffected.

Restore the bundle (reinstall from the registry) and confirm the card clears.

### 5. Repeat over plain HTTP (digest fallback)

Point a browser at the panel over **HTTP** (insecure context, no `crypto.subtle`)
and repeat step 4. The tamper must still be caught — the loader's bundled pure-JS
sha256 computes the same digest (plan 32 #3). This closes the optional-SSL gap:
integrity holds with or without TLS.

### 6. (Optional) SDK-gate refusal on a live box

Temporarily pin the registry entry's `sdk_version` to a range the panel can't
satisfy (e.g. `^99.0.0`) and reinstall. Expected: the loader **refuses before
fetching**, the row shows an **SDK incompatible** badge, and the failure card
reads "needs SDK … panel has …". Revert the pin afterward.

## Result

> _NOT YET EXECUTED._ Paste the scrubbed transcript (install response, the
> `frontends` hash, the failure-card + badge screenshots for both HTTPS and HTTP,
> and the restore) here once run on a real box, and mark this runbook EXECUTED
> with the date.
