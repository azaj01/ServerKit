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
        id: 'servers',
        label: 'Servers',
        route: '/servers',
        category: 'infrastructure',
        icon: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
        subItems: [
            { id: 'fleet', label: 'Agent Fleet', route: '/fleet', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
            { id: 'fleet-monitor', label: 'Fleet Monitor', route: '/fleet-monitor', icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
            { id: 'cloud', label: 'Cloud Servers', route: '/cloud', icon: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>' },
            { id: 'server-templates', label: 'Config Templates', route: '/server-templates', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>' }
        ]
    },
    {
        id: 'domains',
        label: 'Domains',
        route: '/domains',
        category: 'infrastructure',
        icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
        subItems: [
            { id: 'dns', label: 'DNS Zones', route: '/dns', icon: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>' },
            { id: 'ssl', label: 'SSL Certificates', route: '/ssl', icon: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' }
        ]
    },
    {
        id: 'services',
        label: 'Services',
        route: '/services',
        category: 'infrastructure',
        icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
        subItems: [
            { id: 'new-service', label: 'New Service', route: '/services/new', icon: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' },
            { id: 'templates', label: 'Templates', route: '/templates', icon: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>' },
            { id: 'deployments', label: 'Deploy Activity', route: '/deployments', icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' }
        ]
    },
    {
        id: 'wordpress',
        label: 'WordPress',
        route: '/wordpress',
        category: 'infrastructure',
        icon: '<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M3.5 9h17M3.5 15h17"/>',
        subItems: [
            { id: 'wp-pipeline', label: 'Pipeline', route: '/wordpress/projects', requiresCondition: 'wpInstalled', icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' }
        ]
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
    {
        id: 'files',
        label: 'Files',
        route: '/files',
        category: 'operations',
        icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
        subItems: [
            { id: 'ftp', label: 'FTP Server', route: '/ftp', icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>' }
        ]
    },
    {
        id: 'monitoring',
        label: 'Monitoring',
        route: '/monitoring',
        category: 'operations',
        icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
        subItems: [
            { id: 'status-pages', label: 'Status Pages', route: '/status-pages', icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' }
        ]
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
        id: 'marketplace',
        label: 'Marketplace',
        route: '/marketplace',
        category: 'system',
        icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
        subItems: [
            { id: 'downloads', label: 'Downloads', route: '/downloads', icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' }
        ]
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
