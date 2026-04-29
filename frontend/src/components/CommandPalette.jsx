import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import {
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from '@/components/ui/command';

const STATIC_PAGES = [
    { label: 'Services', path: '/services', category: 'Pages', keywords: 'apps containers' },
    { label: 'Docker', path: '/docker', category: 'Pages', keywords: 'containers images' },
    { label: 'Databases', path: '/databases', category: 'Pages', keywords: 'mysql postgres sql' },
    { label: 'Domains', path: '/domains', category: 'Pages', keywords: 'dns nginx' },
    { label: 'SSL Certificates', path: '/ssl', category: 'Pages', keywords: 'https tls' },
    { label: 'Templates', path: '/templates', category: 'Pages', keywords: 'deploy one-click' },
    { label: 'Deployments', path: '/deployments', category: 'Pages', keywords: 'deploy jobs status logs' },
    { label: 'Workflow Builder', path: '/workflow', category: 'Pages', keywords: 'automation pipeline' },
    { label: 'WordPress', path: '/wordpress', category: 'Pages', keywords: 'wp sites' },
    { label: 'WordPress Projects', path: '/wordpress/projects', category: 'Pages', keywords: 'wp environments' },
    { label: 'Git', path: '/git', category: 'Pages', keywords: 'repos deploy' },
    { label: 'Files', path: '/files', category: 'Pages', keywords: 'file manager explorer' },
    { label: 'FTP Server', path: '/ftp', category: 'Pages', keywords: 'sftp upload' },
    { label: 'Monitoring', path: '/monitoring', category: 'Pages', keywords: 'metrics uptime' },
    { label: 'Backups', path: '/backups', category: 'Pages', keywords: 'snapshots restore' },
    { label: 'Cron Jobs', path: '/cron', category: 'Pages', keywords: 'schedule tasks' },
    { label: 'Security', path: '/security', category: 'Pages', keywords: 'firewall fail2ban' },
    { label: 'Email', path: '/email', category: 'Pages', keywords: 'smtp postfix' },
    { label: 'Terminal', path: '/terminal', category: 'Pages', keywords: 'shell ssh console' },
    { label: 'Servers', path: '/servers', category: 'Pages', keywords: 'fleet agents' },
    { label: 'Fleet Monitor', path: '/fleet-monitor', category: 'Pages', keywords: 'agents status' },
    { label: 'DNS Zones', path: '/dns', category: 'Pages', keywords: 'records nameserver' },
    { label: 'Status Pages', path: '/status-pages', category: 'Pages', keywords: 'uptime incidents' },
    { label: 'Cloud Provision', path: '/cloud', category: 'Pages', keywords: 'vps deploy' },
    { label: 'Marketplace', path: '/marketplace', category: 'Pages', keywords: 'extensions plugins' },
    { label: 'Downloads', path: '/downloads', category: 'Pages', keywords: 'agent installer' },
    { label: 'Settings', path: '/settings', category: 'Settings', keywords: 'profile preferences' },
    { label: 'Settings: Users', path: '/settings/users', category: 'Settings', keywords: 'accounts team' },
    { label: 'Settings: API Keys', path: '/settings/api', category: 'Settings', keywords: 'tokens access' },
    { label: 'Settings: SSO', path: '/settings/sso', category: 'Settings', keywords: 'oauth saml login' },
    { label: 'Settings: Appearance', path: '/settings/appearance', category: 'Settings', keywords: 'theme dark light' },
    { label: 'Settings: Notifications', path: '/settings/notifications', category: 'Settings', keywords: 'alerts email slack' },
    { label: 'Settings: System', path: '/settings/system', category: 'Settings', keywords: 'server config' },
];

function fuzzyMatch(text, query) {
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return -1;
    return idx === 0 ? 2 : 1;
}

function scoreItem(item, query) {
    const labelScore = fuzzyMatch(item.label, query);
    if (labelScore > 0) return labelScore + 1;
    const kwScore = fuzzyMatch(item.keywords || '', query);
    if (kwScore > 0) return kwScore;
    const pathScore = fuzzyMatch(item.path, query);
    if (pathScore > 0) return pathScore;
    return -1;
}

const CommandPalette = ({ open, onClose }) => {
    const [query, setQuery] = useState('');
    const [dynamicItems, setDynamicItems] = useState([]);
    const navigate = useNavigate();

    // Fetch dynamic items (services/containers + servers) when opened
    useEffect(() => {
        if (!open) return;
        setQuery('');

        let cancelled = false;
        async function fetchDynamic() {
            const items = [];
            try {
                const containers = await api.getContainers();
                if (!cancelled && Array.isArray(containers)) {
                    containers.forEach(c => {
                        items.push({
                            label: c.name || c.Names?.[0]?.replace(/^\//, ''),
                            path: `/docker`,
                            category: 'Containers',
                            keywords: `${c.Image || ''} ${c.State || ''}`,
                        });
                    });
                }
            } catch (_e) {} // eslint-disable-line no-empty
            try {
                const serverData = await api.getServers();
                const servers = serverData?.servers || serverData || [];
                if (!cancelled && Array.isArray(servers)) {
                    servers.forEach(s => {
                        items.push({
                            label: s.name || s.hostname,
                            path: `/servers/${s.id}`,
                            category: 'Servers',
                            keywords: `${s.hostname || ''} ${s.ip_address || ''}`,
                        });
                    });
                }
            } catch (_e) {} // eslint-disable-line no-empty
            if (!cancelled) setDynamicItems(items);
        }
        fetchDynamic();
        return () => { cancelled = true; };
    }, [open]);

    const allItems = useMemo(() => [...STATIC_PAGES, ...dynamicItems], [dynamicItems]);

    const results = useMemo(() => {
        if (!query.trim()) return allItems.slice(0, 20);
        return allItems
            .map(item => ({ ...item, score: scoreItem(item, query.trim()) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);
    }, [query, allItems]);

    const handleSelect = useCallback((item) => {
        navigate(item.path);
        onClose();
    }, [navigate, onClose]);

    // Group results by category
    const grouped = useMemo(() => {
        const groups = {};
        results.forEach(item => {
            if (!groups[item.category]) groups[item.category] = [];
            groups[item.category].push(item);
        });
        return groups;
    }, [results]);

    return (
        <CommandDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
            <CommandInput
                placeholder="Search pages, services, servers..."
                value={query}
                onValueChange={setQuery}
            />
            <CommandList>
                <CommandEmpty>No results found</CommandEmpty>
                {Object.entries(grouped).map(([category, items]) => (
                    <CommandGroup key={category} heading={category}>
                        {items.map(item => (
                            <CommandItem
                                key={`${item.category}-${item.path}-${item.label}`}
                                value={`${item.label} ${item.path} ${item.keywords || ''}`}
                                onSelect={() => handleSelect(item)}
                            >
                                <span className="command-palette__item-label">{item.label}</span>
                                <span className="command-palette__item-path">{item.path}</span>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ))}
            </CommandList>
        </CommandDialog>
    );
};

export default CommandPalette;
