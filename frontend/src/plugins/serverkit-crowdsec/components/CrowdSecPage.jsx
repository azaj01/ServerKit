import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, Ban, ListChecks, Activity, Plus } from 'lucide-react';
import api from '@/services/api';
import { PageTopbar, Pill, MetricCard } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import { useToast } from '@/contexts/ToastContext';

const DURATIONS = ['1h', '4h', '12h', '24h', '7d'];

const formatDate = (d) => (d ? new Date(d).toLocaleString() : '—');

// Best-effort: pull a headline number out of `cscli metrics -o json`, whose
// shape varies across CrowdSec versions. Null when nothing recognizable.
function parsedEventsTotal(metrics) {
    try {
        const acq = metrics?.acquisition;
        if (!acq || typeof acq !== 'object') return null;
        let total = 0;
        for (const source of Object.values(acq)) {
            const n = source?.parsed ?? source?.lines_parsed;
            if (typeof n === 'number') total += n;
        }
        return total > 0 ? total : null;
    } catch {
        return null;
    }
}

const CrowdSecPage = () => {
    const toast = useToast();

    const [status, setStatus] = useState(null);
    const [decisions, setDecisions] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [allowlists, setAllowlists] = useState({ supported: false, allowlists: [], message: null });
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);

    // Ban modal
    const [showBanModal, setShowBanModal] = useState(false);
    const [banForm, setBanForm] = useState({ ip: '', duration: '4h', reason: '' });

    // Allowlist manager
    const [showListModal, setShowListModal] = useState(false);
    const [listForm, setListForm] = useState({ name: '', description: '' });
    const [selectedList, setSelectedList] = useState(null);
    const [listItems, setListItems] = useState([]);
    const [entryForm, setEntryForm] = useState({ value: '', comment: '' });

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const statusData = await api.request('/crowdsec/status');
            setStatus(statusData);
            if (statusData?.installed) {
                const [d, a, al, m] = await Promise.all([
                    api.request('/crowdsec/decisions').catch(() => ({ decisions: [] })),
                    api.request('/crowdsec/alerts').catch(() => ({ alerts: [] })),
                    api.request('/crowdsec/allowlists').catch(() => ({ supported: false, allowlists: [] })),
                    api.request('/crowdsec/metrics').catch(() => null),
                ]);
                setDecisions(d.decisions || []);
                setAlerts(a.alerts || []);
                setAllowlists(al || { supported: false, allowlists: [] });
                setMetrics(m?.metrics ?? null);
            }
        } catch (error) {
            toast.error(`Failed to load CrowdSec data: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleBan = async () => {
        if (!banForm.ip.trim()) return;
        setActionLoading(true);
        try {
            await api.request('/crowdsec/decisions', {
                method: 'POST',
                body: {
                    ip: banForm.ip.trim(),
                    duration: banForm.duration,
                    reason: banForm.reason.trim() || undefined,
                },
            });
            toast.success(`Decision added for ${banForm.ip}`);
            setShowBanModal(false);
            setBanForm({ ip: '', duration: '4h', reason: '' });
            await loadData();
        } catch (error) {
            toast.error(`Failed to ban IP: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteDecision = (value) => {
        setConfirmDialog({
            title: 'Remove decision',
            message: `Remove all active decisions for ${value}?`,
            confirmText: 'Remove',
            variant: 'warning',
            onConfirm: async () => {
                try {
                    await api.request(`/crowdsec/decisions/${encodeURIComponent(value)}`, { method: 'DELETE' });
                    toast.success(`Decisions removed for ${value}`);
                    await loadData();
                } catch (error) {
                    toast.error(`Failed to remove decision: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleCreateList = async () => {
        if (!listForm.name.trim()) return;
        setActionLoading(true);
        try {
            await api.request('/crowdsec/allowlists', {
                method: 'POST',
                body: { name: listForm.name.trim(), description: listForm.description.trim() },
            });
            toast.success(`Allowlist ${listForm.name} created`);
            setShowListModal(false);
            setListForm({ name: '', description: '' });
            await loadData();
        } catch (error) {
            toast.error(`Failed to create allowlist: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const openList = async (name) => {
        setSelectedList(name);
        setListItems([]);
        try {
            const res = await api.request(`/crowdsec/allowlists/${encodeURIComponent(name)}`);
            setListItems(res?.allowlist?.items || []);
        } catch (error) {
            toast.error(`Failed to load allowlist: ${error.message}`);
        }
    };

    const handleAddEntry = async () => {
        if (!selectedList || !entryForm.value.trim()) return;
        setActionLoading(true);
        try {
            await api.request(`/crowdsec/allowlists/${encodeURIComponent(selectedList)}/items`, {
                method: 'POST',
                body: { value: entryForm.value.trim(), comment: entryForm.comment.trim() || undefined },
            });
            toast.success(`Added ${entryForm.value} to ${selectedList}`);
            setEntryForm({ value: '', comment: '' });
            await openList(selectedList);
        } catch (error) {
            toast.error(`Failed to add entry: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemoveEntry = async (value) => {
        try {
            await api.request(
                `/crowdsec/allowlists/${encodeURIComponent(selectedList)}/items?value=${encodeURIComponent(value)}`,
                { method: 'DELETE' }
            );
            toast.success(`Removed ${value} from ${selectedList}`);
            await openList(selectedList);
        } catch (error) {
            toast.error(`Failed to remove entry: ${error.message}`);
        }
    };

    if (loading) {
        return (
            <div className="page-container crowdsec-page">
                <PageTopbar icon={<ShieldCheck size={18} />} title="CrowdSec" />
                <EmptyState loading title="Loading CrowdSec status..." />
            </div>
        );
    }

    // ── Not installed: guidance, never auto-install ──
    if (!status?.installed) {
        return (
            <div className="page-container crowdsec-page">
                <PageTopbar icon={<ShieldCheck size={18} />} title="CrowdSec" />
                <div className="empty-state">
                    <ShieldCheck size={48} strokeWidth={1} />
                    <h3>CrowdSec Is Not Installed</h3>
                    <p>
                        CrowdSec is a collaborative security engine that detects attacks in your
                        logs and shares blocklists across its community. Install it on this host
                        and this page will surface its decisions, alerts, and allowlists.
                    </p>
                    <p>
                        ServerKit does not install it for you — follow the official guide, then
                        refresh this page.
                    </p>
                    <div className="cs-empty-actions">
                        <Button asChild variant="default">
                            <a href={status?.docs_url || 'https://docs.crowdsec.net/'} target="_blank" rel="noreferrer">
                                Installation Guide
                            </a>
                        </Button>
                        <Button variant="outline" onClick={loadData}>
                            <RefreshCw size={14} /> Re-check
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const parsedEvents = parsedEventsTotal(metrics);

    return (
        <div className="page-container crowdsec-page">
            <PageTopbar
                icon={<ShieldCheck size={18} />}
                title="CrowdSec"
                actions={
                    <>
                        <Button variant="default" size="sm" onClick={() => setShowBanModal(true)}>
                            <Ban size={14} /> Ban an IP
                        </Button>
                        <Button variant="outline" size="sm" onClick={loadData}>
                            <RefreshCw size={14} /> Refresh
                        </Button>
                    </>
                }
            />

            {/* ── Status ── */}
            <div className="card">
                <div className="card-header">
                    <h3>Engine Status</h3>
                </div>
                <div className="card-body">
                    <div className="sec-rows">
                        <div className="sk-info-row">
                            <span className="k">Service</span>
                            <Pill kind={status.running ? 'green' : 'red'}>
                                {status.running ? 'Running' : 'Stopped'}
                            </Pill>
                        </div>
                        <div className="sk-info-row">
                            <span className="k">Local API</span>
                            <Pill kind={status.lapi_ok ? 'green' : 'amber'}>
                                {status.lapi_ok ? 'Reachable' : 'Unreachable'}
                            </Pill>
                        </div>
                        <div className="sk-info-row">
                            <span className="k">Version</span>
                            <span className="v">{status.version || 'Unknown'}</span>
                        </div>
                        <div className="sk-info-row">
                            <span className="k">Allowlists</span>
                            <span className="v">
                                {status.allowlists_supported
                                    ? 'Supported'
                                    : 'Not supported by this CrowdSec version'}
                            </span>
                        </div>
                        <div className="sk-info-row">
                            <span className="k">AppSec / WAF</span>
                            <span className="v">
                                In-line request filtering needs the CrowdSec AppSec component and a
                                bouncer on your reverse proxy — configured outside the panel.
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Metric cards (best-effort) ── */}
            <div className="cs-kpis">
                <MetricCard icon={<Ban size={15} />} tone="red" value={decisions.length} label="Active decisions" />
                <MetricCard icon={<Activity size={15} />} tone="amber" value={alerts.length} label="Recent alerts" />
                <MetricCard
                    icon={<ListChecks size={15} />}
                    tone="green"
                    value={allowlists.supported ? (allowlists.allowlists || []).length : '—'}
                    label="Allowlists"
                />
                {parsedEvents != null && (
                    <MetricCard icon={<Activity size={15} />} tone="cyan" value={parsedEvents} label="Parsed log lines" />
                )}
            </div>

            {/* ── Decisions ── */}
            <div className="card sec-flush">
                <div className="card-header">
                    <h3>Decisions {decisions.length > 0 && <span className="sec-count">· {decisions.length}</span>}</h3>
                </div>
                {decisions.length === 0 ? (
                    <div className="card-body">
                        <p className="text-muted">No active decisions — nothing is currently banned.</p>
                    </div>
                ) : (
                    <table className="sk-dtable">
                        <thead>
                            <tr>
                                <th>Value</th>
                                <th>Scope</th>
                                <th>Type</th>
                                <th>Origin</th>
                                <th>Reason</th>
                                <th>Expires</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {decisions.map((d, i) => (
                                <tr key={d.id ?? i}>
                                    <td className="sk-cell-mono">{d.value}</td>
                                    <td><span className="sk-tag">{d.scope || '—'}</span></td>
                                    <td>{d.type || '—'}</td>
                                    <td>{d.origin || '—'}</td>
                                    <td>{d.reason || '—'}</td>
                                    <td>{d.until ? formatDate(d.until) : (d.duration || '—')}</td>
                                    <td>
                                        <Button variant="secondary" size="sm" onClick={() => handleDeleteDecision(d.value)}>
                                            Delete
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── Alerts ── */}
            <div className="card sec-flush">
                <div className="card-header">
                    <h3>Alerts {alerts.length > 0 && <span className="sec-count">· {alerts.length}</span>}</h3>
                </div>
                {alerts.length === 0 ? (
                    <div className="card-body">
                        <p className="text-muted">No recent alerts.</p>
                    </div>
                ) : (
                    <table className="sk-dtable">
                        <thead>
                            <tr>
                                <th>Scenario</th>
                                <th>Source</th>
                                <th>Country</th>
                                <th>Events</th>
                                <th>Decisions</th>
                                <th>Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {alerts.map((a, i) => (
                                <tr key={a.id ?? i}>
                                    <td>{a.scenario || '—'}</td>
                                    <td className="sk-cell-mono">{a.source || '—'}</td>
                                    <td>{a.country || '—'}</td>
                                    <td>{a.events_count ?? '—'}</td>
                                    <td>{a.decisions ?? '—'}</td>
                                    <td>{formatDate(a.created_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── Allowlists ── */}
            <div className="card">
                <div className="card-header">
                    <h3>Allowlists</h3>
                    {allowlists.supported && (
                        <div className="card-actions">
                            <Button variant="default" size="sm" onClick={() => setShowListModal(true)}>
                                <Plus size={14} /> New Allowlist
                            </Button>
                        </div>
                    )}
                </div>
                <div className="card-body">
                    {!allowlists.supported ? (
                        <p className="text-muted">
                            {allowlists.message
                                || 'The installed CrowdSec version does not support centralized allowlists. Upgrade CrowdSec to manage allowlists from the panel.'}
                        </p>
                    ) : (allowlists.allowlists || []).length === 0 ? (
                        <p className="text-muted">No allowlists yet. Create one to exempt trusted IPs from remediation.</p>
                    ) : (
                        <div className="cs-allowlists">
                            <div className="cs-allowlists__names">
                                {(allowlists.allowlists || []).map((l, i) => (
                                    <button
                                        key={l.name ?? i}
                                        type="button"
                                        className={`cs-allowlists__name${selectedList === l.name ? ' is-active' : ''}`}
                                        onClick={() => openList(l.name)}
                                    >
                                        <span className="sk-tag">{l.name}</span>
                                        {l.description && <span className="text-muted"> {l.description}</span>}
                                    </button>
                                ))}
                            </div>
                            {selectedList && (
                                <div className="cs-allowlists__detail">
                                    <h4>{selectedList}</h4>
                                    {listItems.length === 0 ? (
                                        <p className="text-muted">No entries in this allowlist.</p>
                                    ) : (
                                        <table className="sk-dtable">
                                            <thead>
                                                <tr>
                                                    <th>Value</th>
                                                    <th>Comment</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {listItems.map((it, i) => {
                                                    const value = typeof it === 'string' ? it : it.value;
                                                    return (
                                                        <tr key={value ?? i}>
                                                            <td className="sk-cell-mono">{value}</td>
                                                            <td>{(typeof it === 'object' && (it.description || it.comment)) || '—'}</td>
                                                            <td>
                                                                <Button variant="secondary" size="sm" onClick={() => handleRemoveEntry(value)}>
                                                                    Remove
                                                                </Button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                    <div className="cs-entry-form">
                                        <Input
                                            type="text"
                                            value={entryForm.value}
                                            onChange={(e) => setEntryForm((f) => ({ ...f, value: e.target.value }))}
                                            placeholder="IP or CIDR, e.g. 203.0.113.7 or 10.0.0.0/8"
                                        />
                                        <Input
                                            type="text"
                                            value={entryForm.comment}
                                            onChange={(e) => setEntryForm((f) => ({ ...f, comment: e.target.value }))}
                                            placeholder="Comment (optional)"
                                        />
                                        <Button
                                            variant="default"
                                            size="sm"
                                            onClick={handleAddEntry}
                                            disabled={actionLoading || !entryForm.value.trim()}
                                        >
                                            Add Entry
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Ban modal ── */}
            <Modal open={showBanModal} onClose={() => setShowBanModal(false)} title="Ban an IP">
                <div className="form-group">
                    <Label>IP address or CIDR range</Label>
                    <Input
                        type="text"
                        value={banForm.ip}
                        onChange={(e) => setBanForm((f) => ({ ...f, ip: e.target.value }))}
                        placeholder="203.0.113.7 or 203.0.113.0/24"
                    />
                </div>
                <div className="form-group">
                    <Label>Duration</Label>
                    <Select value={banForm.duration} onValueChange={(v) => setBanForm((f) => ({ ...f, duration: v }))}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {DURATIONS.map((d) => (
                                <SelectItem key={d} value={d}>{d}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="form-group">
                    <Label>Reason</Label>
                    <Input
                        type="text"
                        value={banForm.reason}
                        onChange={(e) => setBanForm((f) => ({ ...f, reason: e.target.value }))}
                        placeholder="Manual ban from ServerKit"
                    />
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowBanModal(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={handleBan} disabled={actionLoading || !banForm.ip.trim()}>
                        {actionLoading ? 'Banning...' : 'Ban IP'}
                    </Button>
                </div>
            </Modal>

            {/* ── New allowlist modal ── */}
            <Modal open={showListModal} onClose={() => setShowListModal(false)} title="New Allowlist">
                <div className="form-group">
                    <Label>Name</Label>
                    <Input
                        type="text"
                        value={listForm.name}
                        onChange={(e) => setListForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="trusted-ips"
                    />
                </div>
                <div className="form-group">
                    <Label>Description</Label>
                    <Input
                        type="text"
                        value={listForm.description}
                        onChange={(e) => setListForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder="Office and monitoring IPs"
                    />
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowListModal(false)}>Cancel</Button>
                    <Button variant="default" onClick={handleCreateList} disabled={actionLoading || !listForm.name.trim()}>
                        {actionLoading ? 'Creating...' : 'Create'}
                    </Button>
                </div>
            </Modal>

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
};

export default CrowdSecPage;
