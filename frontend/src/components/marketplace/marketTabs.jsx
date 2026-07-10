import { Puzzle, PackageCheck, Download } from 'lucide-react';

// Shared sub-nav for the Marketplace page group (Marketplace / Installed /
// Downloads). Rendered in each page's <PageTopbar tabs={MARKET_TABS}> — the
// top-bar layout replaces the old sidebar sub-menu (see docs/REDESIGN_MAP.md
// §6 dec. 3). Installed is a real route (/marketplace/installed) so it deep-links.
export const MARKET_TABS = [
    { to: '/marketplace', label: 'Marketplace', end: true, icon: <Puzzle size={15} /> },
    { to: '/marketplace/installed', label: 'Installed', icon: <PackageCheck size={15} /> },
    { to: '/downloads', label: 'Downloads', icon: <Download size={15} /> },
];
