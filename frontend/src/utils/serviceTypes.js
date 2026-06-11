// Categorical palette: literal hex on purpose (consumed as inline styles in
// JS). Values follow the redesign palette in styles/_theme-variables.scss —
// green #3ddc97 / red #fb6f6f / amber #f5b945 / accent #6d7cff /
// cyan #49c7f0 / violet #b07bf5, neutral gray #646b7a.
const SERVICE_TYPES = {
    docker: {
        label: 'Docker',
        color: '#49c7f0',
        bgColor: 'rgba(73, 199, 240, 0.1)',
        borderColor: 'rgba(73, 199, 240, 0.2)',
        icon: 'docker',
        tabs: ['overview', 'events', 'logs', 'environment', 'shell', 'metrics', 'settings'],
    },
    flask: {
        label: 'Flask',
        color: '#f5b945',
        bgColor: 'rgba(245, 185, 69, 0.1)',
        borderColor: 'rgba(245, 185, 69, 0.2)',
        icon: 'flask',
        tabs: ['overview', 'events', 'logs', 'environment', 'packages', 'gunicorn', 'commands', 'metrics', 'settings'],
    },
    django: {
        label: 'Django',
        color: '#3ddc97',
        bgColor: 'rgba(61, 220, 151, 0.1)',
        borderColor: 'rgba(61, 220, 151, 0.2)',
        icon: 'django',
        tabs: ['overview', 'events', 'logs', 'environment', 'packages', 'gunicorn', 'commands', 'metrics', 'settings'],
    },
    php: {
        label: 'PHP',
        color: '#b07bf5',
        bgColor: 'rgba(176, 123, 245, 0.1)',
        borderColor: 'rgba(176, 123, 245, 0.2)',
        icon: 'php',
        tabs: ['overview', 'events', 'logs', 'environment', 'settings'],
    },
    static: {
        label: 'Static',
        color: '#6d7cff',
        bgColor: 'rgba(109, 124, 255, 0.1)',
        borderColor: 'rgba(109, 124, 255, 0.2)',
        icon: 'static',
        tabs: ['overview', 'events', 'environment', 'settings'],
    },
    wordpress: {
        label: 'WordPress',
        color: '#49c7f0',
        bgColor: 'rgba(73, 199, 240, 0.1)',
        borderColor: 'rgba(73, 199, 240, 0.2)',
        icon: 'wordpress',
        tabs: ['overview', 'events', 'logs', 'environment', 'settings'],
    },
};

const STATUS_CONFIG = {
    running: { label: 'Live', color: '#3ddc97', dotClass: 'live' },
    stopped: { label: 'Stopped', color: '#646b7a', dotClass: 'stopped' },
    deploying: { label: 'Deploying', color: '#f5b945', dotClass: 'deploying' },
    failed: { label: 'Failed', color: '#fb6f6f', dotClass: 'failed' },
    building: { label: 'Building', color: '#49c7f0', dotClass: 'building' },
};

const DEPLOY_STATUS = {
    success: { label: 'Live', color: '#3ddc97' },
    failed: { label: 'Failed', color: '#fb6f6f' },
    in_progress: { label: 'In Progress', color: '#f5b945' },
    rolled_back: { label: 'Rolled Back', color: '#646b7a' },
    pending: { label: 'Pending', color: '#49c7f0' },
};

export function getServiceType(appType) {
    return SERVICE_TYPES[appType] || {
        label: appType?.charAt(0).toUpperCase() + appType?.slice(1) || 'Unknown',
        color: '#646b7a',
        bgColor: 'rgba(100, 107, 122, 0.1)',
        borderColor: 'rgba(100, 107, 122, 0.2)',
        icon: 'default',
        tabs: ['overview', 'events', 'logs', 'environment', 'settings'],
    };
}

export function getStatusConfig(status) {
    return STATUS_CONFIG[status] || STATUS_CONFIG.stopped;
}

export function getDeployStatus(status) {
    return DEPLOY_STATUS[status] || DEPLOY_STATUS.pending;
}

export function getTabsForType(appType) {
    const type = getServiceType(appType);
    return type.tabs;
}

export function isPythonApp(appType) {
    return ['flask', 'django'].includes(appType);
}

export function isDockerApp(appType) {
    return appType === 'docker';
}

export function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString();
}

export function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '-';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const min = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return `${min}m ${sec}s`;
}

export { SERVICE_TYPES, STATUS_CONFIG, DEPLOY_STATUS };
