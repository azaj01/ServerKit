#!/usr/bin/env node
/**
 * export-registry-entries.mjs — generate index-v2 `bundled: true` entries for
 * the serverkit-extensions registry from the panel's builtin extensions.
 *
 * The source of truth is `builtin-extensions/<slug>/plugin.json`. This script
 * reads every manifest and emits a JSON array of catalog entries the operator
 * pastes into the registry's `index.json` (schema_version 2) whenever the
 * bundled set changes. Bundled entries are listings only — they ship inside
 * the panel, so they carry no `source`/`sha256`.
 *
 * Usage:
 *   node scripts/export-registry-entries.mjs [--assets-dir <path>] [--repo <url>]
 *
 *   --assets-dir  Path to the registry repo's `assets/` tree. When a
 *                 `<slug>/logo.svg` or `<slug>/logo.png` exists there, the
 *                 entry gets a repo-relative `logo` field. Omit to skip logos
 *                 (the operator adds art per-PR).
 *   --repo        The `repo` URL stamped on every entry.
 *                 Default: https://github.com/jhd3197/ServerKit
 *
 * Output goes to stdout; redirect or copy the array into index.json.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const BUILTIN_DIR = join(REPO_ROOT, 'builtin-extensions');

// Registry category vocabulary (schema/index.schema.json). Panel manifests use
// a slightly wider set; map the strays onto the registry enum.
const REGISTRY_CATEGORIES = new Set([
  'ai', 'monitoring', 'security', 'deployment', 'integration', 'ui', 'utility',
]);
const CATEGORY_ALIASES = {
  networking: 'integration',
  network: 'integration',
  database: 'utility',
  databases: 'utility',
};

function parseArgs(argv) {
  const opts = { assetsDir: null, repo: 'https://github.com/jhd3197/ServerKit' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--assets-dir') opts.assetsDir = argv[++i];
    else if (argv[i] === '--repo') opts.repo = argv[++i];
  }
  return opts;
}

function normalizeCategory(cat) {
  if (!cat) return undefined;
  const c = String(cat).toLowerCase();
  if (REGISTRY_CATEGORIES.has(c)) return c;
  return CATEGORY_ALIASES[c] || 'utility';
}

function findLogo(assetsDir, slug) {
  if (!assetsDir) return undefined;
  for (const ext of ['svg', 'png']) {
    const rel = `assets/${slug}/logo.${ext}`;
    const abs = join(assetsDir, slug, `logo.${ext}`);
    if (existsSync(abs) && statSync(abs).isFile()) return rel;
  }
  return undefined;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(BUILTIN_DIR)) {
    process.stderr.write(`builtin-extensions dir not found at ${BUILTIN_DIR}\n`);
    process.exit(1);
  }

  const slugs = readdirSync(BUILTIN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const entries = [];
  for (const slug of slugs) {
    const manifestPath = join(BUILTIN_DIR, slug, 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    let m;
    try {
      m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      process.stderr.write(`skip ${slug}: ${e.message}\n`);
      continue;
    }

    const entry = {
      slug: m.name || slug,
      display_name: m.display_name || m.name || slug,
      description: m.description || '',
      version: String(m.version || '1.0.0'),
      category: normalizeCategory(m.category),
      author: m.author || 'ServerKit',
      first_party: true,
      bundled: true,
      permissions: Array.isArray(m.permissions) ? m.permissions : [],
      min_panel_version: m.min_panel_version ?? null,
      max_panel_version: m.max_panel_version ?? null,
      repo: opts.repo,
    };
    if (entry.category === undefined) delete entry.category;
    const logo = findLogo(opts.assetsDir, entry.slug);
    if (logo) entry.logo = logo;

    entries.push(entry);
  }

  process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
  process.stderr.write(
    `\n${entries.length} bundled entr${entries.length === 1 ? 'y' : 'ies'} generated `
    + `from ${BUILTIN_DIR}\n`,
  );
}

main();
