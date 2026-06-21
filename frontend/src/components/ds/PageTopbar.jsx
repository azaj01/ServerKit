import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// The demo's page top bar (see docs/REDESIGN_MAP.md §6 decision 3): infra pages
// carry their own top bar — an icon + title, an optional routed sub-nav that
// replaces sidebar sub-menus, a spacer, and right-aligned actions.
//
//   <PageTopbar icon={<Globe/>} title="Domains"
//       tabs={[{ to:'/domains', label:'Domains', end:true }, { to:'/dns', label:'DNS Zones' }]}
//       actions={<Button>Add domain</Button>} />
export function PageTopbar({ icon, title, meta, tabs, actions, className }) {
    const hasTabs = tabs && tabs.length > 0;
    return (
        <header className={cn('sk-topbar', className)}>
            {icon && <span className="sk-topbar__ico">{icon}</span>}
            <div className="sk-topbar__titles">
                <h1 className="sk-topbar__title">{title}</h1>
                {meta && <span className="sk-topbar__meta">{meta}</span>}
            </div>

            {/* The tab nav grows to fill the bar; when there are more tabs than
                fit, the overflow collapses into a "More" menu (so groups with
                many sections — e.g. Security — stay on one row). Pages without
                tabs keep the plain spacer that pushes actions to the right. */}
            {hasTabs ? <TopbarTabs tabs={tabs} label={title} /> : <div className="sk-topbar__spacer" />}

            {actions && <div className="sk-topbar__actions">{actions}</div>}
        </header>
    );
}

function matchTab(tab, path) {
    if (tab.end) return path === tab.to;
    // Segment-aware so "/fleet" doesn't swallow "/fleet-monitor".
    return path === tab.to || path.startsWith(tab.to + '/');
}

// Routed sub-nav with overflow handling. Tabs that don't fit the available width
// are hidden and surfaced through a trailing "More" popover — the same greedy
// fit + active-stays-visible logic the shadcn TabsList uses (components/ui/tabs).
function TopbarTabs({ tabs, label }) {
    const location = useLocation();
    const containerRef = useRef(null);
    const linkRefs = useRef([]);
    const moreBtnRef = useRef(null);
    const [hiddenIndices, setHiddenIndices] = useState([]);
    const [popoverOpen, setPopoverOpen] = useState(false);

    linkRefs.current.length = tabs.length;

    const activeIndex = useMemo(
        () => tabs.findIndex((t) => matchTab(t, location.pathname)),
        [tabs, location.pathname]
    );

    const recompute = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const containerWidth = container.clientWidth;
        if (containerWidth === 0) return;

        // Measure each link's natural width (briefly un-hiding collapsed ones).
        const widths = linkRefs.current.map((el) => {
            if (!el) return 0;
            const wasHidden = el.style.display === 'none';
            if (wasHidden) el.style.display = '';
            const w = el.offsetWidth;
            if (wasHidden) el.style.display = 'none';
            return w;
        });

        const moreWidth = moreBtnRef.current?.offsetWidth || 56;
        const gap = 2; // matches .sk-topbar__tabs gap

        // All fit?
        const total = widths.reduce((s, w, i) => s + w + (i > 0 ? gap : 0), 0);
        if (total <= containerWidth) {
            setHiddenIndices((prev) => (prev.length === 0 ? prev : []));
            return;
        }

        // Reserve space for the More button, then greedily fit left-to-right.
        const budget = Math.max(0, containerWidth - moreWidth - gap);
        const visible = [];
        let used = 0;
        for (let i = 0; i < widths.length; i++) {
            const cost = widths[i] + (visible.length > 0 ? gap : 0);
            if (used + cost <= budget) {
                visible.push(i);
                used += cost;
            } else {
                break;
            }
        }

        // The active tab must stay visible — rebuild the visible set around it.
        let visibleSet = visible;
        if (activeIndex !== -1 && !visible.includes(activeIndex)) {
            const others = [];
            let othersUsed = widths[activeIndex];
            for (let i = 0; i < widths.length; i++) {
                if (i === activeIndex) continue;
                const cost = widths[i] + gap;
                if (othersUsed + cost <= budget) {
                    others.push(i);
                    othersUsed += cost;
                }
            }
            visibleSet = [...others, activeIndex].sort((a, b) => a - b);
        }

        const visibleSetObj = new Set(visibleSet);
        const hidden = [];
        for (let i = 0; i < widths.length; i++) {
            if (!visibleSetObj.has(i)) hidden.push(i);
        }
        setHiddenIndices((prev) => (arraysEqual(prev, hidden) ? prev : hidden));
    }, [activeIndex]);

    // Initial measurement + re-run when the tab set or active tab changes.
    useEffect(() => {
        recompute();
    }, [recompute, tabs.length]);

    // Re-fit on container resize.
    useEffect(() => {
        const container = containerRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(() => recompute());
        ro.observe(container);
        return () => ro.disconnect();
    }, [recompute]);

    const hiddenSet = new Set(hiddenIndices);

    return (
        <nav ref={containerRef} className="sk-topbar__tabs" aria-label={`${label} sections`}>
            {tabs.map((t, i) => {
                const isHidden = hiddenSet.has(i);
                return (
                    <NavLink
                        key={t.to}
                        to={t.to}
                        end={t.end}
                        ref={(el) => { linkRefs.current[i] = el; }}
                        className={({ isActive }) => cn('sk-topbar__tab', isActive && 'is-active')}
                        style={{ display: isHidden ? 'none' : undefined }}
                        data-overflow={isHidden ? 'hidden' : undefined}
                    >
                        {t.icon}
                        {t.label}
                    </NavLink>
                );
            })}
            {hiddenIndices.length > 0 && (
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                    <PopoverTrigger asChild>
                        <button
                            ref={moreBtnRef}
                            type="button"
                            className="sk-topbar__tab sk-topbar__more"
                            aria-label="More sections"
                        >
                            <MoreHorizontal size={16} />
                            More
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" sideOffset={6} className="ui-popover-content">
                        <div className="tabs-overflow-list">
                            {hiddenIndices.map((idx) => {
                                const t = tabs[idx];
                                return (
                                    <NavLink
                                        key={t.to}
                                        to={t.to}
                                        end={t.end}
                                        className="tabs-overflow-item"
                                        data-state={idx === activeIndex ? 'active' : 'inactive'}
                                        onClick={() => setPopoverOpen(false)}
                                    >
                                        {t.icon}
                                        {t.label}
                                    </NavLink>
                                );
                            })}
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </nav>
    );
}

function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export default PageTopbar;
