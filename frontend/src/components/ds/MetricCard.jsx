import { cn } from '@/lib/utils';

// KPI / stat tile: icon chip + big value (+ optional unit) + label, with an
// optional trend delta in the top-right.
// tone: 'accent' | 'green' | 'cyan' | 'amber' | 'red' | 'violet'
// trendDir: 'up' | 'down' | 'flat'
//
// When `onClick` is provided the tile renders as a semantic <button> (keyboard
// accessible, design-system focus ring) so KPIs can drive a filter/navigation.
// `kind` is accepted as a deprecated alias for `tone` (dev-only console.warn) —
// this heals silent API misuse where a page passed a prop the tile dropped.
// `secondary` is read by KpiBand to force-fold a tile into the compact strip;
// it is not a visual prop on the tile itself.
export function MetricCard({
    icon,
    tone,
    kind,
    value,
    unit,
    label,
    trend,
    trendDir = 'flat',
    onClick,
    className,
    children,
    secondary: _secondary,   // consumed by KpiBand, kept out of DOM props
    ...props
}) {
    if (import.meta.env.DEV && kind && !tone) {
        console.warn(
            `[MetricCard] \`kind="${kind}"\` is deprecated — use \`tone\` instead ` +
            '(accent|green|cyan|amber|red|violet).'
        );
    }
    const resolvedTone = tone || kind || 'accent';

    const inner = (
        <>
            <div className="sk-kpi__top">
                {icon && <span className={cn('sk-kpi__icon', `sk-kpi__icon--${resolvedTone}`)}>{icon}</span>}
                {trend != null && (
                    <span className={cn('sk-kpi__trend', `sk-kpi__trend--${trendDir}`)}>{trend}</span>
                )}
            </div>
            <div className="sk-kpi__val">
                {value}
                {unit && <small> {unit}</small>}
            </div>
            {label && <div className="sk-kpi__label">{label}</div>}
            {children}
        </>
    );

    if (onClick) {
        return (
            <button
                type="button"
                className={cn('sk-kpi', 'sk-kpi--clickable', className)}
                onClick={onClick}
                {...props}
            >
                {inner}
            </button>
        );
    }

    return (
        <div className={cn('sk-kpi', className)} {...props}>
            {inner}
        </div>
    );
}

export default MetricCard;
