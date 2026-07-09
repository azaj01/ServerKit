import { ListChecks, Clock } from 'lucide-react';

// Shared sub-nav for the Jobs page group (Activity / Scheduled). Rendered in the
// shared PageTopbar via <TabGroupLayout tabs={JOBS_TABS}> so the two surfaces act
// like real tabs (see docs/REDESIGN_MAP.md §6) instead of one long scroll. Both
// routes render <Jobs/>; the page picks the view from the pathname.
export const JOBS_TABS = [
    { to: '/jobs', label: 'Activity', end: true, icon: <ListChecks size={15} /> },
    { to: '/jobs/scheduled', label: 'Scheduled', icon: <Clock size={15} /> },
];
