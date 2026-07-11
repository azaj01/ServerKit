#!/usr/bin/env node
// Completeness guard for the settings search index (plan 41, Phase 2).
//
// Every settings tab declared in pages/Settings.jsx (VALID_TABS) must have at
// least one entry in data/settingsIndex.js, so a future settings tab can't ship
// invisible to the command palette. Also checks that ids are unique and that no
// entry points at a tab that doesn't exist. Dependency-free; wired into the
// frontend `lint` script (the frontend has no unit-test runner, so a lint-stage
// guard is the house-consistent check).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Tabs intentionally NOT indexed (dev-only surfaces with no user-facing
// settings). Keep this list tiny and justified.
const EXEMPT = new Set(['developer']);

function fail(msg) {
    console.error(`\n✖ settings-index check failed:\n  ${msg}\n`);
    process.exit(1);
}

// 1. Extract VALID_TABS from pages/Settings.jsx (can't import JSX in node).
const settingsSrc = readFileSync(resolve(root, 'src/pages/Settings.jsx'), 'utf8');
const match = settingsSrc.match(/const VALID_TABS\s*=\s*\[([^\]]*)\]/);
if (!match) fail('could not find VALID_TABS in src/pages/Settings.jsx');
const tabs = [...match[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
if (tabs.length === 0) fail('VALID_TABS parsed as empty');

// 2. Import the settings index (pure ESM data module, no runtime deps).
const { SETTINGS_INDEX } = await import(new URL('../src/data/settingsIndex.js', import.meta.url));
if (!Array.isArray(SETTINGS_INDEX)) fail('SETTINGS_INDEX is not an array');

// 3. Every non-exempt tab must have at least one entry.
const tabsWithEntries = new Set(SETTINGS_INDEX.map((e) => e.tab));
const missing = tabs.filter((t) => !EXEMPT.has(t) && !tabsWithEntries.has(t));
if (missing.length) {
    fail(`settings tabs with no entry in data/settingsIndex.js: ${missing.join(', ')}`);
}

// 4. Ids must be globally unique (they are the ?focus=setting:<id> deep-link key).
const ids = SETTINGS_INDEX.map((e) => e.id);
const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
if (dupes.length) fail(`duplicate settings index ids: ${dupes.join(', ')}`);

// 5. No entry may reference an unknown tab.
const validTab = new Set(tabs);
const stray = [...tabsWithEntries].filter((t) => !validTab.has(t));
if (stray.length) fail(`settingsIndex entries reference unknown tabs: ${stray.join(', ')}`);

console.log(`✓ settings-index: ${SETTINGS_INDEX.length} entries cover ${tabsWithEntries.size} settings tabs`);
