#!/usr/bin/env node
/**
 * Dev-time skeleton bone capture (Phase 2 of docs/plans/50_SKELETON_LOADING_UX_PLAN.md).
 *
 * Boneyard's insight is that the most accurate loading skeleton is the *real*
 * rendered layout, measured. This script drives a headless browser against a
 * running dev server (logged in as admin/admin, with seeded dev data), snapshots
 * designated page regions into "bones" — `{x, y, w, h, r}` where x/w are
 * percentages of the region width and y/h are absolute pixels — and bakes the
 * result into `frontend/src/skeletons/<key>.json` as a static asset.
 *
 * `SkeletonBoundary`'s optional `bones` prop replays these via `renderBones`
 * (SCSS-classed absolutely-positioned divs), so the shipped product never
 * imports boneyard or runs a browser — it just reads the baked JSON.
 *
 * The in-page snapshot below is a faithful port of boneyard-js `snapshotBones`
 * (github: boneyard-js, `packages/boneyard/src/extract.ts`). We embed it rather
 * than injecting the npm ESM bundle into the page so the script stays runnable
 * from a fresh checkout; `boneyard-js` is kept as a devDependency for parity and
 * as the upstream source of truth for the bone format.
 *
 * Usage:
 *   1. Start the dev stack (backend on :47927, `npm run dev` frontend) with
 *      seeded data and the default admin/admin credentials.
 *   2. npm run capture:skeletons          # captures every target in TARGETS
 *      SK_ONLY=ssl npm run capture:skeletons   # just one target
 *
 * Env knobs:
 *   SK_BASE_URL   frontend base URL (default http://127.0.0.1:41921)
 *   SK_USER       login username (default admin)
 *   SK_PASS       login password (default admin)
 *   SK_ONLY       comma list of target keys to capture (default: all)
 *   SK_HEADED     set to watch the browser (default headless)
 *   SK_WIDTH      viewport width used for the capture (default 1440)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(FRONTEND_DIR, 'src', 'skeletons');

const BASE = (process.env.SK_BASE_URL || 'http://127.0.0.1:41921').replace(/\/$/, '');
const USER = process.env.SK_USER || 'admin';
const PASS = process.env.SK_PASS || 'admin';
const HEADLESS = !process.env.SK_HEADED;
const WIDTH = Number(process.env.SK_WIDTH) || 1440;
const ONLY = (process.env.SK_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

// Regions to snapshot. `selector` is the element whose subtree becomes bones;
// `waitFor` gates the capture until the real (non-skeleton) content has rendered.
const TARGETS = [
    { key: 'ssl', path: '/ssl', selector: '.ssl-page', waitFor: '.ssl-status-bar' },
    { key: 'wordpress-list', path: '/wordpress', selector: '.wordpress-page', waitFor: '.sk-table, .wp-sites-grid, .empty-state' },
];

const log = (...a) => console.log('[bones]', ...a);

// ---- the in-page snapshot (faithful port of boneyard snapshotBones) --------
// Serialized into the page via Playwright's evaluate. Returns a SkeletonResult:
//   { name, viewportWidth, width, height, bones: [{x, y, w, h, r, c?}] }
// x/w are percentages of the root width; y/h are absolute px from the root top.
function inPageSnapshot(el, name) {
    const round = (n) => Math.round(n);
    const round4 = (n) => Math.round(n * 10000) / 10000;
    const MEDIA = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS']);
    const FORM = new Set(['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);
    const LEAF_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH']);
    const rootRect = el.getBoundingClientRect();
    const bones = [];

    const parseRadius = (cs) => {
        const r = cs.borderTopLeftRadius;
        if (!r || r === '0px') return null;
        const px = parseFloat(r);
        return Number.isFinite(px) ? px : null;
    };
    const visible = (node) => {
        const cs = getComputedStyle(node);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    const relX = (rect) => round4(((rect.left - rootRect.left) / rootRect.width) * 100);
    const relW = (rect) => round4((rect.width / rootRect.width) * 100);

    const walk = (node) => {
        if (!(node instanceof Element) || !visible(node)) return;
        const cs = getComputedStyle(node);
        const kids = Array.from(node.children).filter((c) => c instanceof Element && visible(c));
        const tag = node.tagName;
        const isLeaf = kids.length === 0 || MEDIA.has(tag) || FORM.has(tag) || LEAF_TAGS.has(tag);

        if (isLeaf) {
            const rect = node.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return;
            const squarish = MEDIA.has(tag) && Math.abs(rect.width - rect.height) < 4;
            const r = squarish ? '50%' : (parseRadius(cs) ?? 8);
            bones.push({ x: relX(rect), y: round(rect.top - rootRect.top), w: relW(rect), h: round(rect.height), r });
            return;
        }

        // Non-leaf: emit a lighter container bone for visual surfaces, then recurse.
        const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        const hasBgImage = cs.backgroundImage && cs.backgroundImage !== 'none';
        const hasBorder = parseFloat(cs.borderTopWidth) > 0
            && cs.borderTopColor && cs.borderTopColor !== 'rgba(0, 0, 0, 0)';
        const hasRadius = parseFloat(cs.borderTopLeftRadius) > 0;
        if (hasBg || hasBgImage || (hasBorder && hasRadius)) {
            const rect = node.getBoundingClientRect();
            if (rect.width >= 1 && rect.height >= 1) {
                bones.push({ x: relX(rect), y: round(rect.top - rootRect.top), w: relW(rect), h: round(rect.height), r: parseRadius(cs) ?? 8, c: true });
            }
        }
        kids.forEach(walk);
    };

    Array.from(el.children).forEach(walk);
    return {
        name: name || 'component',
        viewportWidth: round(rootRect.width),
        width: round(rootRect.width),
        height: round(rootRect.height),
        bones,
    };
}

// ---- driver ---------------------------------------------------------------
async function loadPlaywright() {
    try {
        return (await import('playwright')).chromium;
    } catch {
        console.error(
            'Playwright is required for bone capture but is not installed.\n' +
            'Install it once (dev-only, not shipped):\n' +
            '  npm i -D playwright && npx playwright install chromium',
        );
        process.exit(2);
    }
}

async function login(page) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Already authenticated? A redirect away from /login means we're in.
    if (!/\/login/.test(page.url())) return;
    const user = page.locator('input[name="username"], input[type="text"]').first();
    const pass = page.locator('input[type="password"]').first();
    if (await user.count()) {
        await user.fill(USER);
        await pass.fill(PASS);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
            page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click(),
        ]);
    }
}

async function main() {
    await mkdir(OUT_DIR, { recursive: true });
    const targets = ONLY.length ? TARGETS.filter((t) => ONLY.includes(t.key)) : TARGETS;
    if (!targets.length) { console.error(`No targets matched SK_ONLY=${ONLY.join(',')}`); process.exit(2); }

    const chromium = await loadPlaywright();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();

    let failed = 0;
    try {
        await login(page);
        for (const t of targets) {
            process.stdout.write(`[bones] ${t.key.padEnd(16)} `);
            try {
                await page.goto(`${BASE}${t.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForSelector(t.waitFor, { timeout: 15000, state: 'visible' });
                await page.waitForTimeout(600); // let layout settle
                const snapshot = await page.evaluate(
                    ({ selector, key, fnSrc }) => {
                        const el = document.querySelector(selector);
                        if (!el) return null;
                        // eslint-disable-next-line no-new-func
                        const fn = new Function(`return (${fnSrc})`)();
                        return fn(el, key);
                    },
                    { selector: t.selector, key: t.key, fnSrc: inPageSnapshot.toString() },
                );
                if (!snapshot || !snapshot.bones.length) throw new Error(`no bones captured for ${t.selector}`);
                await writeFile(path.join(OUT_DIR, `${t.key}.json`), JSON.stringify(snapshot, null, 2) + '\n');
                console.log(`OK  (${snapshot.bones.length} bones, ${snapshot.height}px)`);
            } catch (e) {
                failed += 1;
                console.log(`FAIL  ${e.message}`);
            }
        }
    } finally {
        await context.close();
        await browser.close();
    }

    log(`done -> ${OUT_DIR}`);
    if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
