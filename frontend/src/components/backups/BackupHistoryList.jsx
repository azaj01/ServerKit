import { useState } from 'react';
import { Pill } from '@/components/ds';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/EmptyState';
import {
    Archive, RotateCcw, ShieldCheck, Trash2, HardDrive, Cloud, Layers,
    FlaskConical, ChevronRight, ChevronDown,
} from 'lucide-react';
import { humanSize, formatMoney, formatWhen, statusKind, storageLabel } from './format';

// Card 3 of the backup "Protection" panel: a data-table of backup runs.
// Pairs with the .sk-dtable styles plus a .backup-history-list-scoped layer.
function storageIcon(run) {
    const label = storageLabel(run);
    if (label === 'both') {
        return (
            <span className="backup-history-list__storage" title="Local + remote">
                <Layers size={13} /> both
            </span>
        );
    }
    if (label === 'remote') {
        return (
            <span className="backup-history-list__storage" title="Remote">
                <Cloud size={13} /> remote
            </span>
        );
    }
    return (
        <span className="backup-history-list__storage" title="Local">
            <HardDrive size={13} /> local
        </span>
    );
}

// Pill kind for a restore-drill outcome. skipped_no_space is a soft warning
// (no disk headroom to drill), never a hard failure.
function drillStatusKind(status) {
    switch (status) {
        case 'success': return 'green';
        case 'failed': return 'red';
        case 'skipped_no_space': return 'amber';
        default: return 'gray';
    }
}

function drillStatusLabel(status) {
    if (status === 'skipped_no_space') return 'skipped (no space)';
    return status || 'unknown';
}

// Render whatever shape `probes` arrives in (array of checks, keyed object, or
// a plain string) as compact key/value rows without assuming a schema.
function renderProbes(probes) {
    if (!probes) return <span className="backup-drills__probe-empty">No probe details recorded.</span>;
    const entries = Array.isArray(probes)
        ? probes.map((p, i) => [p?.name || `Probe ${i + 1}`, p?.detail ?? p?.result ?? p?.ok ?? p])
        : (typeof probes === 'object' ? Object.entries(probes) : [['result', probes]]);
    return (
        <dl className="backup-drills__probes">
            {entries.map(([key, value]) => (
                <div key={key} className="backup-drills__probe">
                    <dt>{key}</dt>
                    <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                </div>
            ))}
        </dl>
    );
}

function RestoreDrills({ drills }) {
    const [expanded, setExpanded] = useState(null);
    if (!drills || drills.length === 0) return null;

    return (
        <div className="backup-drills">
            <div className="backup-drills__head">
                <FlaskConical size={14} />
                <span>Restore drills</span>
                <span className="backup-drills__sub">Proof that these backups can actually be recovered.</span>
            </div>
            <ul className="backup-drills__list">
                {drills.map((drill) => {
                    const isOpen = expanded === drill.id;
                    return (
                        <li key={drill.id} className="backup-drills__item">
                            <button
                                type="button"
                                className="backup-drills__row"
                                onClick={() => setExpanded(isOpen ? null : drill.id)}
                                aria-expanded={isOpen}
                            >
                                <span className="backup-drills__chev">
                                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </span>
                                <Pill kind={drillStatusKind(drill.status)}>{drillStatusLabel(drill.status)}</Pill>
                                <span className="backup-drills__trigger">{drill.trigger || 'manual'}</span>
                                <span className="backup-drills__when">{formatWhen(drill.started_at)}</span>
                                {drill.duration_seconds != null && (
                                    <span className="backup-drills__meta">{drill.duration_seconds}s</span>
                                )}
                                {drill.bytes_restored != null && (
                                    <span className="backup-drills__meta">{humanSize(drill.bytes_restored)}</span>
                                )}
                            </button>
                            {isOpen && (
                                <div className="backup-drills__detail">
                                    {drill.error && <p className="backup-drills__error">{drill.error}</p>}
                                    {renderProbes(drill.probes)}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export default function BackupHistoryList({
    runs,
    drills,
    loading,
    onRestore,
    onVerify,
    onDelete,
    onRowClick,
}) {
    const hasDrills = drills && drills.length > 0;

    if (loading && (!runs || runs.length === 0)) {
        return <EmptyState icon={Archive} title="Loading backups…" loading />;
    }

    if (!loading && (!runs || runs.length === 0)) {
        return (
            <>
                <RestoreDrills drills={drills} />
                {!hasDrills && (
                    <EmptyState
                        icon={Archive}
                        title="No backups yet"
                        description="Turn on protection or click Back up now."
                    />
                )}
            </>
        );
    }

    return (
        <>
            <RestoreDrills drills={drills} />
            <table className="sk-dtable backup-history-list">
                <thead>
                    <tr>
                        <th>Backup</th>
                        <th>Date</th>
                        <th>Size</th>
                        <th>Cost</th>
                        <th>Status</th>
                        <th>Storage</th>
                        <th aria-label="Actions" />
                    </tr>
                </thead>
                <tbody>
                    {runs.map((run) => (
                        <tr
                            key={run.id}
                            className={`backup-history-list__row ${onRowClick ? 'is-clickable' : ''}`}
                            onClick={onRowClick ? () => onRowClick(run) : undefined}
                        >
                            <td>
                                <div className="sk-cell-name">
                                    <span className="backup-history-list__ico"><Archive size={14} /></span>
                                    <span>{run.metadata?.backup_name || `Backup #${run.id}`}</span>
                                    <Pill kind={run.kind === 'full' ? 'violet' : 'gray'} dot={false}>{run.kind}</Pill>
                                </div>
                            </td>
                            <td className="backup-history-list__when">{formatWhen(run.started_at)}</td>
                            <td className="sk-cell-mono">{humanSize(run.size_total)}</td>
                            <td className="sk-cell-mono">{formatMoney(run.cost_total)}</td>
                            <td><Pill kind={statusKind(run.status)}>{run.status}</Pill></td>
                            <td>{storageIcon(run)}</td>
                            <td>
                                <div className="backup-history-list__actions" onClick={(e) => e.stopPropagation()}>
                                    <Button size="icon" variant="outline" title="Restore" disabled={run.status !== 'success'} onClick={() => onRestore(run)}><RotateCcw size={14} /></Button>
                                    {run.remote_key && (
                                        <Button size="icon" variant="outline" title="Verify remote copy" onClick={() => onVerify(run)}><ShieldCheck size={14} /></Button>
                                    )}
                                    <Button size="icon" variant="destructive" title="Delete" onClick={() => onDelete(run)}><Trash2 size={14} /></Button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
}
