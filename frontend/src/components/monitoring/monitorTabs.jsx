import { Activity, Globe, ScrollText } from 'lucide-react';

// Shared sub-nav for the Observability page group — Monitoring (live metrics +
// alerts), Events (the unified SystemEvent stream, formerly "Telemetry"), and
// public Status Pages (§4 unification). Rendered in each page's
// <PageTopbar tabs={MONITOR_TABS}>. Fleet Monitor stays under the Servers group
// (it is server-scoped); GPU is its own hardware page.
export const MONITOR_TABS = [
    { to: '/monitoring', label: 'Monitoring', end: true, icon: <Activity size={15} /> },
    { to: '/telemetry', label: 'Events', icon: <ScrollText size={15} /> },
    { to: '/status-pages', label: 'Status Pages', icon: <Globe size={15} /> },
];
