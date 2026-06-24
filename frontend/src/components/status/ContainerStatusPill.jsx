import { Pill } from '@/components/ds';

// Aggregator enum (backend container_status_service) → Pill kind + label.
const STATUS_META = {
    'running:healthy':   { kind: 'green', label: 'Healthy' },
    'running:unhealthy': { kind: 'amber', label: 'Unhealthy' },
    degraded:            { kind: 'amber', label: 'Degraded' },
    restarting:          { kind: 'cyan',  label: 'Restarting' },
    starting:            { kind: 'cyan',  label: 'Starting' },
    exited:              { kind: 'gray',  label: 'Stopped' },
    unknown:             { kind: 'gray',  label: 'Unknown' },
};

const FALLBACK = { kind: 'gray', label: 'Unknown' };

/**
 * Standardized pill for an aggregated container status.
 *
 * @param {object}  status         aggregator dict ({status, total, healthy, reasons})
 * @param {string}  [fallbackLabel] label to show before the status resolves
 */
export default function ContainerStatusPill({ status, fallbackLabel = 'Unknown' }) {
    if (!status || !status.status) {
        return <Pill kind="gray">{fallbackLabel}</Pill>;
    }

    const meta = STATUS_META[status.status] || FALLBACK;
    const total = status.total ?? 0;
    const healthy = status.healthy ?? 0;
    const reasons = Array.isArray(status.reasons) ? status.reasons : [];

    const summary = total > 0 ? `${healthy}/${total} containers healthy` : 'no containers';
    const tooltipLines = [summary, ...reasons];
    // Native title for accessibility / keyboard; the custom tooltip is visual.
    const titleText = tooltipLines.join('\n');

    // Surface a degraded sub-state without requiring a hover: when an app has
    // more than one container and some are unhealthy (or there are reasons),
    // show a small always-visible amber badge. Prefer the issue count when we
    // have reasons, else the "healthy/total" ratio.
    const showBadge = total > 1 && (healthy < total || reasons.length > 0);
    const badgeLabel = reasons.length > 0
        ? `${reasons.length} ${reasons.length === 1 ? 'issue' : 'issues'}`
        : `${healthy}/${total}`;

    return (
        <span className="sk-cstatus" title={titleText}>
            <Pill kind={meta.kind}>{meta.label}</Pill>
            {showBadge && (
                <span
                    className="sk-cstatus__badge"
                    aria-label={
                        reasons.length > 0
                            ? `${reasons.length} container ${reasons.length === 1 ? 'issue' : 'issues'}`
                            : `${healthy} of ${total} containers healthy`
                    }
                >
                    {badgeLabel}
                </span>
            )}
            <span className="sk-cstatus__tip" role="tooltip">
                <span className="sk-cstatus__tip-summary">{summary}</span>
                {reasons.map((r, i) => (
                    <span key={i} className="sk-cstatus__tip-reason">{r}</span>
                ))}
            </span>
        </span>
    );
}
