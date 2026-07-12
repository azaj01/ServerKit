// Illustrated raster cover icons for bundled extensions. These sit ahead of the
// flat Simple Icons brand marks (ExtensionBrands.jsx) in the cover fallback
// chain so recognizable ServerKit capabilities show a rich 3D icon, and every
// category has a sensible default. Slugs/categories with no match return null so
// the caller falls back to the brand mark, manifest SVG, or category glyph.
//
// PNGs are bundled + hashed by Vite via these URL imports.
import automations from '../../assets/extension-icons/automations.png';
import backup from '../../assets/extension-icons/backup.png';
import faro from '../../assets/extension-icons/faro.png';
import cloudflare from '../../assets/extension-icons/cloudflare.png';
import extensions from '../../assets/extension-icons/extensions.png';
import git from '../../assets/extension-icons/git.png';
import gpu from '../../assets/extension-icons/gpu.png';
import hosting from '../../assets/extension-icons/hosting.png';
import mail from '../../assets/extension-icons/mail.png';
import mailserver from '../../assets/extension-icons/mailserver.png';
import monitor from '../../assets/extension-icons/monitor.png';
import network from '../../assets/extension-icons/network.png';
import security from '../../assets/extension-icons/security.png';
import terminal from '../../assets/extension-icons/terminal.png';
import vpn from '../../assets/extension-icons/vpn.png';
import workflow from '../../assets/extension-icons/workflow.png';

// Strip the conventional `serverkit-` prefix and lowercase, matching
// ExtensionBrands.normalizeSlug so keyword rules hit both `serverkit-mail`
// and `mail`.
const normalizeSlug = (slug) => String(slug || '').toLowerCase().replace(/^serverkit-/, '');

// Ordered keyword rules — first match wins. Keep the most specific keys first.
const KEYWORD_RULES = [
    // tramo/Automations ships its own illustrated cover; keep it ahead of the
    // generic workflow rule so 'serverkit-tramo' resolves to it.
    { keys: ['tramo', 'automation'], icon: automations },
    // Faro ships its own illustrated lighthouse cover; keep it ahead of the
    // generic 'remote' rule so 'serverkit-faro' resolves here.
    { keys: ['faro'], icon: faro },
    { keys: ['cloudflare'], icon: cloudflare },
    { keys: ['gitea', 'forgejo', 'git'], icon: git },
    { keys: ['gpu', 'nvidia', 'cuda'], icon: gpu },
    { keys: ['wireguard', 'vpn', 'tunnel', 'remote'], icon: vpn },
    { keys: ['mailserver', 'mail-relay', 'relay'], icon: mailserver },
    { keys: ['mail', 'email', 'smtp', 'imap'], icon: mail },
    { keys: ['backup', 'restore', 'snapshot', 'sync', 'import', 'migrate'], icon: backup },
    { keys: ['crowdsec', 'fail2ban', 'security', 'firewall', 'waf', 'cve'], icon: security },
    { keys: ['dns', 'domain', 'network'], icon: network },
    { keys: ['cron', 'job', 'workflow', 'automation', 'queue', 'pipeline', 'schedule'], icon: workflow },
    { keys: ['terminal', 'console', 'shell', 'cli'], icon: terminal },
    { keys: ['monitor', 'metric', 'status', 'uptime', 'analytic', 'observ'], icon: monitor },
    { keys: ['plugin', 'extension', 'marketplace', 'gui', 'theme'], icon: extensions },
    { keys: ['host', 'deploy', 'provision'], icon: hosting },
];

// Per-category fallbacks. AI intentionally omitted — none of these icons read as
// "AI", so it keeps the lucide Sparkles glyph.
const CATEGORY_ICONS = {
    monitoring: monitor,
    security,
    deployment: hosting,
    integration: network,
    ui: extensions,
    utility: terminal,
};

// Resolve a raster cover icon URL for an extension, or null when nothing fits.
export function resolveExtensionIcon(slug, category) {
    const normalized = normalizeSlug(slug);
    const rule = KEYWORD_RULES.find((item) => item.keys.some((key) => normalized.includes(key)));
    if (rule) return rule.icon;
    return CATEGORY_ICONS[category] || null;
}

export function hasExtensionIcon(slug, category) {
    return Boolean(resolveExtensionIcon(slug, category));
}
