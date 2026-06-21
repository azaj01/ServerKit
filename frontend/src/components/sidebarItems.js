import { SERVER_TABS } from './servers/serverTabs';
import { DOMAIN_TABS } from './domains/domainTabs';
import { SERVICE_TABS } from './services/serviceTabs';
import { FILE_TABS } from './files/fileTabs';
import { MONITOR_TABS } from './monitoring/monitorTabs';
import { MARKET_TABS } from './marketplace/marketTabs';

// Path prefixes for a tab group, used to keep the group's sidebar item lit
// across all its tabs (e.g. Servers stays active on /fleet, /cloud, …).
const groupPrefixes = (tabs) => tabs.map((t) => t.to);

// Sidebar navigation items definition
// Items with subItems render as collapsible groups (collapsed by default)
// The 'dashboard' item is always visible and cannot be hidden

export const SIDEBAR_CATEGORIES = ['overview', 'infrastructure', 'operations', 'system'];

export const CATEGORY_LABELS = {
    overview: 'Overview',
    infrastructure: 'Infrastructure',
    operations: 'Operations',
    system: 'System'
};

export const SIDEBAR_ITEMS = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        route: '/',
        category: 'overview',
        alwaysVisible: true,
        end: true,
        icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'
    },
    {
        // Redesign: Servers uses the top-bar layout (REDESIGN_MAP §6 decision 3).
        // Its Agent Fleet / Fleet Monitor / Cloud Servers / Config Templates
        // sub-nav now lives in the page's top bar (PageTopbar SERVER_TABS), not
        // as sidebar sub-items. Routes /fleet, /fleet-monitor, /cloud,
        // /server-templates are unchanged and reachable from those tabs.
        id: 'servers',
        label: 'Servers',
        route: '/servers',
        // Keep "Servers" lit across the whole tab group (Agent Fleet, Fleet
        // Monitor, Cloud Servers, Config Templates) — see serverTabs.jsx.
        matchPrefixes: groupPrefixes(SERVER_TABS),
        category: 'infrastructure',
        icon: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'
    },
    {
        // Redesign: Domains is migrated to the top-bar layout (REDESIGN_MAP §6
        // decision 3). Its DNS Zones + SSL sub-nav now lives in the page's top
        // bar (PageTopbar tabs), not as sidebar sub-items. Routes /dns and /ssl
        // are unchanged and still reachable from those tabs.
        id: 'domains',
        label: 'Domains',
        route: '/domains',
        matchPrefixes: groupPrefixes(DOMAIN_TABS),
        category: 'infrastructure',
        icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'
    },
    {
        // Redesign: Services uses the top-bar layout (REDESIGN_MAP §6 decision 3).
        // New Service / Templates / Deploy Activity now live in the page's top
        // bar (PageTopbar SERVICE_TABS), not as sidebar sub-items. Routes
        // /services/new, /templates, /deployments are unchanged.
        id: 'services',
        label: 'Services',
        route: '/services',
        matchPrefixes: groupPrefixes(SERVICE_TABS),
        category: 'infrastructure',
        icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'
    },
    {
        // Redesign: WordPress uses the top-bar layout (REDESIGN_MAP §6 dec. 3).
        // Pipeline now lives in the page's top bar (PageTopbar WORDPRESS_TABS),
        // not as a sidebar sub-item. Route /wordpress/projects is unchanged.
        id: 'wordpress',
        label: 'WordPress',
        route: '/wordpress',
        category: 'infrastructure',
        icon: '<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M3.5 9h17M3.5 15h17"/>'
    },
    {
        id: 'workflow',
        label: 'Workflow Builder',
        route: '/workflow',
        category: 'infrastructure',
        icon: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98"/><path d="M15.41 6.51l-6.82 3.98"/>'
    },
    {
        id: 'databases',
        label: 'Databases',
        route: '/databases',
        category: 'infrastructure',
        icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'
    },
    {
        id: 'docker',
        label: 'Docker',
        route: '/docker',
        category: 'infrastructure',
        icon: '<rect x="2" y="7" width="6" height="6" rx="1"/><rect x="9" y="7" width="6" height="6" rx="1"/><rect x="16" y="7" width="6" height="6" rx="1"/><rect x="2" y="14" width="6" height="6" rx="1"/><rect x="9" y="14" width="6" height="6" rx="1"/>'
    },
    // NOTE: "Git" appears under Infrastructure too, but it is contributed by the
    // built-in serverkit-git PLUGIN (see plugins/contributions.js), which also
    // registers the /git route. Keeping it plugin-owned means it correctly
    // disappears (no dead link) when the plugin is disabled — so do NOT add a
    // core 'git' item here. Sidebar presets that list 'git' still hide the
    // plugin's nav item via getHiddenItemIds().
    {
        // Redesign: Files uses the top-bar layout (REDESIGN_MAP §6 decision 3).
        // FTP Server now lives in the page's top bar (PageTopbar FILE_TABS), not
        // as a sidebar sub-item. Route /ftp is unchanged, reachable from the tab.
        id: 'files',
        label: 'Files',
        route: '/files',
        matchPrefixes: groupPrefixes(FILE_TABS),
        category: 'operations',
        icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
    },
    {
        // Redesign: Monitoring uses the top-bar layout (REDESIGN_MAP §6 dec. 3).
        // Status Pages now lives in the page's top bar (PageTopbar MONITOR_TABS),
        // not as a sidebar sub-item. Route /status-pages is unchanged.
        id: 'monitoring',
        label: 'Monitoring',
        route: '/monitoring',
        matchPrefixes: groupPrefixes(MONITOR_TABS),
        category: 'operations',
        icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'
    },
    {
        id: 'backups',
        label: 'Backups',
        route: '/backups',
        category: 'operations',
        icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
    },
    {
        id: 'cron',
        label: 'Cron Jobs',
        route: '/cron',
        category: 'operations',
        icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
    },
    {
        id: 'security',
        label: 'Security',
        route: '/security',
        category: 'operations',
        icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4m0 4h.01"/>'
    },
    {
        id: 'email',
        label: 'Email Server',
        route: '/email',
        category: 'operations',
        icon: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'
    },
    {
        id: 'queue',
        label: 'Queue Bus',
        route: '/queue',
        category: 'operations',
        icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'
    },
    {
        id: 'workspaces',
        label: 'Workspaces',
        route: '/workspaces',
        category: 'system',
        icon: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>'
    },
    {
        id: 'terminal',
        label: 'Terminal / Logs',
        route: '/terminal',
        category: 'system',
        icon: '<path d="M4 17l6-6-6-6M12 19h8"/>'
    },
    {
        id: 'gpu',
        label: 'GPU Monitor',
        route: '/gpu',
        // Hidden unless the panel host reports a GPU (Sidebar sets gpuAvailable
        // from api.getGpuInfo) — no point showing an empty monitor.
        requiresCondition: 'gpuAvailable',
        category: 'system',
        icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 6v12"/><circle cx="13" cy="12" r="2.5"/><path d="M17 6v12"/>'
    },
    {
        id: 'secrets',
        label: 'Secrets & Webhooks',
        route: '/secrets',
        category: 'system',
        icon: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><circle cx="12" cy="12" r="2"/><path d="M12 12v-6"/><path d="M16 12h3"/><path d="M8 12H5"/>'
    },
    {
        // Redesign: Marketplace uses the top-bar layout (REDESIGN_MAP §6 dec. 3).
        // Downloads now lives in the page's top bar (PageTopbar MARKET_TABS), not
        // as a sidebar sub-item. Route /downloads is unchanged.
        id: 'marketplace',
        label: 'Marketplace',
        route: '/marketplace',
        matchPrefixes: groupPrefixes(MARKET_TABS),
        category: 'system',
        icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>'
    }
];

// Preset profiles define which items are hidden (top-level only)
export const SIDEBAR_PRESETS = {
    full: {
        label: 'Full',
        description: 'All sidebar items visible',
        hiddenItems: []
    },
    web: {
        label: 'Web Hosting',
        description: 'Domains, SSL, databases, and web essentials',
        hiddenItems: ['docker', 'git', 'workflow', 'email', 'workspaces', 'marketplace']
    },
    email: {
        label: 'Email Admin',
        description: 'Email server, security, DNS, and monitoring',
        hiddenItems: ['services', 'wordpress', 'workflow', 'databases', 'docker', 'git', 'cron', 'workspaces', 'marketplace']
    },
    devops: {
        label: 'Docker / DevOps',
        description: 'Docker, Git, monitoring, and CI/CD tools',
        hiddenItems: ['wordpress', 'email', 'marketplace']
    },
    minimal: {
        label: 'Minimal',
        description: 'Just the essentials — dashboard, servers, terminal',
        hiddenItems: ['wordpress', 'workflow', 'databases', 'docker', 'git', 'email', 'cron', 'workspaces', 'marketplace']
    }
};

export function getHiddenItemIds(sidebarConfig) {
    const { preset = 'full', hiddenItems = [] } = sidebarConfig || {};

    const hidden = preset === 'custom'
        ? hiddenItems
        : (SIDEBAR_PRESETS[preset]?.hiddenItems || []);

    return new Set(hidden);
}

// Get visible items based on config
export function getVisibleItems(sidebarConfig) {
    const hidden = getHiddenItemIds(sidebarConfig);

    return SIDEBAR_ITEMS.filter(item =>
        item.alwaysVisible || !hidden.has(item.id)
    );
}
