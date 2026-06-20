import { Globe, Network, Lock, Radio } from 'lucide-react';

// Shared sub-nav for the Domains / DNS / SSL page group. Rendered in each page's
// <PageTopbar tabs={DOMAIN_TABS}> so the tab group persists across all three
// (the demo's top-bar layout replaces the old sidebar sub-menu — see
// docs/REDESIGN_MAP.md §6 decision 3).
export const DOMAIN_TABS = [
    { to: '/domains', label: 'Domains', end: true, icon: <Globe size={15} /> },
    { to: '/dns', label: 'DNS Zones', icon: <Network size={15} /> },
    { to: '/ssl', label: 'SSL', icon: <Lock size={15} /> },
    { to: '/dynamic-dns', label: 'Dynamic DNS', icon: <Radio size={15} /> },
];
