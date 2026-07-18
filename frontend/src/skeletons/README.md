# Baked skeleton bones

These `*.json` files are **measured loading-skeleton layouts** — the real
rendered UI of a page region, snapshotted into positioned "bones". They are
static assets: the shipped product reads them, but never runs a browser or
imports `boneyard-js` to produce them.

`SkeletonBoundary`'s optional `bones` prop replays a file here via `renderBones`,
giving a pixel-accurate placeholder instead of a hand-composed one:

```jsx
import sslBones from '@/skeletons/ssl.json';

<SkeletonBoundary loading={loading} bones={sslBones}>
  {status && <SslContent data={status} />}
</SkeletonBoundary>
```

## Bone format

Each file is a `SkeletonResult` (the `boneyard-js` shape):

```jsonc
{
  "name": "ssl",
  "viewportWidth": 1440,   // capture viewport width
  "width": 1200,           // captured region width (px)
  "height": 320,           // captured region height (px)
  "bones": [
    // x, w are PERCENTAGES of the region width (responsive)
    // y, h are ABSOLUTE PIXELS from the region top
    // r is a number (px) or a CSS string ("50%" = circle)
    // c: true marks a background/container bone (skipped on render)
    { "x": 1.5, "y": 0, "w": 5.3, "h": 44, "r": "50%" },
    { "x": 8.0, "y": 6, "w": 40, "h": 20, "r": 6 }
  ]
}
```

## Regenerating (dev-only)

Bones drift when the UI changes. Re-capture from a **running, logged-in** dev
session with seeded data:

```bash
# one-time: the capture tool needs a headless browser (dev-only, not shipped)
npm i -D playwright && npx playwright install chromium

# with the backend (:47927) and `npm run dev` frontend up, admin/admin:
npm run capture:skeletons            # all targets in scripts/capture-skeletons.mjs
SK_ONLY=ssl npm run capture:skeletons # just one
```

The script logs in, navigates each target page, waits for the real content, and
writes `<key>.json` here. Add/adjust targets in
`frontend/scripts/capture-skeletons.mjs`.

> **PR checklist:** if you change the layout of a page that has baked bones,
> re-run `npm run capture:skeletons` for that page and commit the updated JSON,
> or the skeleton will drift from the real layout.

`example.json` is a **format sample only** (a 3-row list), committed so the shape
is self-documenting and the render path has fixture data; real captures are named
after their page key (`ssl.json`, `wordpress-list.json`, …).
