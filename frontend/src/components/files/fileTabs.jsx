import { FolderOpen, Network } from 'lucide-react';

// Shared sub-nav for the Files page group (Files / FTP Server). Rendered in each
// page's <PageTopbar tabs={FILE_TABS}> — the demo's top-bar layout replaces the
// old sidebar sub-menu (see docs/REDESIGN_MAP.md §6 decision 3).
export const FILE_TABS = [
    { to: '/files', label: 'Files', end: true, icon: <FolderOpen size={15} /> },
    { to: '/ftp', label: 'FTP Server', icon: <Network size={15} /> },
];
