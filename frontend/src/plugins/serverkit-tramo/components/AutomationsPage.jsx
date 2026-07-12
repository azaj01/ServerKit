import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Workflow, RefreshCw, Plus, Trash2, Rocket, Pencil, Play, LayoutTemplate,
    Server, Power, KeyRound, CheckCircle2, X,
} from 'lucide-react';
import api from '@/services/api';
import { PageTopbar, Pill } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import { useToast } from '@/contexts/ToastContext';

import '../styles/tramo-automations.scss';

// Route-driven tabs (manifest maps /automations and /automations/:tab here).
const TABS = [
    { slug: 'workflows', to: '/automations', label: 'Workflows', end: true },
    { slug: 'runs', to: '/automations/runs', label: 'Runs' },
    { slug: 'settings', to: '/automations/settings', label: 'Settings' },
];
const VALID_TABS = TABS.map((t) => t.slug);

// Run status → Pill colour.
const runPill = (status) => {
    const kind = status === 'succeeded' || status === 'success' ? 'green'
        : status === 'running' || status === 'pending' ? 'amber'
            : status === 'failed' || status === 'error' ? 'red'
                : status === 'awaiting_approval' ? 'cyan' : 'gray';
    return <Pill kind={kind}>{status || 'unknown'}</Pill>;
};

// Host lifecycle state → Pill colour.
const hostPill = (state) => {
    const kind = state === 'ready' ? 'green'
        : state === 'unhealthy' ? 'amber'
            : state === 'stopped' ? 'gray' : 'red';
    return <Pill kind={kind}>{state || 'not_installed'}</Pill>;
};

const formatDuration = (start, finish) => {
    if (!start || !finish) return '—';
    const ms = new Date(finish).getTime() - new Date(start).getTime();
    if (Number.isNaN(ms) || ms < 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
};

const AutomationsPage = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const { tab } = useParams();
    const activeTab = VALID_TABS.includes(tab) ? tab : 'workflows';

    const [busy, setBusy] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);

    // Workflows tab
    const [workflows, setWorkflows] = useState([]);
    const [wfLoading, setWfLoading] = useState(false);
    const [newModal, setNewModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [templateModal, setTemplateModal] = useState(false);
    const [templates, setTemplates] = useState([]);

    // Runs tab
    const [runs, setRuns] = useState([]);
    const [approvals, setApprovals] = useState([]);
    const [runsLoading, setRunsLoading] = useState(false);

    // Settings tab
    const [host, setHost] = useState(null);
    const [settings, setSettings] = useState(null);
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [installPort, setInstallPort] = useState('');
    const [newSecret, setNewSecret] = useState({ name: '', value: '' });
    const [hostPortDraft, setHostPortDraft] = useState('');

    // ── Loaders ──
    const loadWorkflows = useCallback(async () => {
        setWfLoading(true);
        try {
            const data = await api.request('/tramo/workflows');
            setWorkflows(data.workflows || []);
        } catch (error) {
            toast.error(`Could not load workflows: ${error.message}`);
        } finally {
            setWfLoading(false);
        }
    }, [toast]);

    const loadRuns = useCallback(async () => {
        setRunsLoading(true);
        try {
            const [runData, apprData] = await Promise.all([
                api.request('/tramo/runs?limit=100'),
                api.request('/tramo/approvals'),
            ]);
            setRuns(runData.runs || []);
            setApprovals(apprData.approvals || []);
        } catch (error) {
            toast.error(`Could not load runs: ${error.message}`);
        } finally {
            setRunsLoading(false);
        }
    }, [toast]);

    const loadSettings = useCallback(async () => {
        setSettingsLoading(true);
        try {
            const [statusData, settingsData] = await Promise.all([
                api.request('/tramo/host/status'),
                api.request('/tramo/settings'),
            ]);
            setHost(statusData);
            setSettings(settingsData);
            setHostPortDraft(String(settingsData.host_port ?? statusData.host_port ?? ''));
        } catch (error) {
            toast.error(`Could not load settings: ${error.message}`);
        } finally {
            setSettingsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (activeTab === 'workflows') loadWorkflows();
        else if (activeTab === 'runs') loadRuns();
        else if (activeTab === 'settings') loadSettings();
    }, [activeTab, loadWorkflows, loadRuns, loadSettings]);

    // ── Workflow actions ──
    const handleCreate = async () => {
        if (!newName.trim()) { toast.error('Name is required.'); return; }
        setBusy(true);
        try {
            const wf = await api.request('/tramo/workflows', { method: 'POST', body: { name: newName.trim() } });
            setNewModal(false);
            setNewName('');
            toast.success(`Workflow "${wf.name}" created`);
            navigate(`/automations/edit/${wf.slug}`);
        } catch (error) {
            toast.error(`Could not create workflow: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    const openTemplateModal = async () => {
        setTemplateModal(true);
        try {
            const data = await api.request('/tramo/templates');
            setTemplates(data.templates || []);
        } catch (error) {
            toast.error(`Could not load templates: ${error.message}`);
        }
    };

    const handleFromTemplate = async (template) => {
        setBusy(true);
        try {
            const wf = await api.request(`/tramo/workflows/from-template/${template.id}`, { method: 'POST', body: {} });
            setTemplateModal(false);
            toast.success(`Created "${wf.name}" from ${template.name}`);
            navigate(`/automations/edit/${wf.slug}`);
        } catch (error) {
            toast.error(`Could not create from template: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleToggleEnabled = async (wf) => {
        try {
            await api.request(`/tramo/workflows/${wf.slug}`, { method: 'PUT', body: { enabled: !wf.enabled } });
            await loadWorkflows();
        } catch (error) {
            toast.error(`Could not update workflow: ${error.message}`);
        }
    };

    const handleDeleteWorkflow = (wf) => {
        setConfirmDialog({
            title: `Delete ${wf.name}?`,
            message: 'This removes the workflow and its stored document. Deployed runs already recorded are kept.',
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                try {
                    await api.request(`/tramo/workflows/${wf.slug}`, { method: 'DELETE' });
                    toast.success('Workflow deleted');
                    await loadWorkflows();
                } catch (error) {
                    toast.error(error.message);
                }
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleDeploy = async () => {
        setBusy(true);
        try {
            const res = await api.request('/tramo/deploy', { method: 'POST' });
            toast.success(res?.message || 'Deployed to the tramo engine');
            await loadWorkflows();
        } catch (error) {
            toast.error(`Deploy failed: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleRunWorkflow = async (wf) => {
        setBusy(true);
        try {
            const res = await api.request(`/tramo/workflows/${wf.slug}/run`, { method: 'POST', body: {} });
            const status = res?.run?.status || res?.result?.status || 'started';
            toast.success(`Run ${status} — see the Runs tab`);
        } catch (error) {
            toast.error(`Run failed: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    // ── Run actions ──
    const handleApprove = async (runId) => {
        setBusy(true);
        try {
            await api.request(`/tramo/runs/${runId}/approve`, { method: 'POST', body: {} });
            toast.success('Approved');
            await loadRuns();
        } catch (error) {
            toast.error(`Approve failed: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleReplay = async (runId) => {
        setBusy(true);
        try {
            await api.request(`/tramo/runs/${runId}/replay`, { method: 'POST' });
            toast.success('Replay queued');
            await loadRuns();
        } catch (error) {
            toast.error(`Replay failed: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    // ── Host / settings actions ──
    const handleInstall = async () => {
        setBusy(true);
        try {
            const body = installPort ? { host_port: Number(installPort) } : {};
            await api.request('/tramo/host/install', { method: 'POST', body });
            toast.success('tramo engine installed');
            setInstallPort('');
            await loadSettings();
        } catch (error) {
            toast.error(`Install failed: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleUninstall = (keepData) => {
        setConfirmDialog({
            title: 'Remove tramo engine',
            message: keepData
                ? 'Remove the tramo container? Workflow data stays on disk and a reinstall picks it back up.'
                : 'Remove the tramo container AND delete all engine data? This cannot be undone.',
            confirmText: 'Remove',
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                try {
                    await api.request(`/tramo/host/install?keep_data=${keepData}`, { method: 'DELETE' });
                    toast.success('tramo engine removed');
                    await loadSettings();
                } catch (error) {
                    toast.error(`Uninstall failed: ${error.message}`);
                }
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleControl = async (action) => {
        setBusy(true);
        try {
            await api.request(`/tramo/host/control/${action}`, { method: 'POST' });
            toast.success(`Engine ${action} requested`);
            await loadSettings();
        } catch (error) {
            toast.error(`Could not ${action} engine: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleAddSecret = async () => {
        if (!newSecret.name.trim() || !newSecret.value) { toast.error('Name and value are required.'); return; }
        setBusy(true);
        try {
            await api.request('/tramo/settings', {
                method: 'PUT',
                body: { pack_secrets: { [newSecret.name.trim()]: newSecret.value } },
            });
            toast.success(`Secret ${newSecret.name.trim()} saved`);
            setNewSecret({ name: '', value: '' });
            await loadSettings();
        } catch (error) {
            toast.error(`Could not save secret: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleToggleBridge = async () => {
        setBusy(true);
        try {
            await api.request('/tramo/settings', {
                method: 'PUT',
                body: { events_bridge_enabled: !settings?.events_bridge_enabled },
            });
            await loadSettings();
        } catch (error) {
            toast.error(`Could not update events bridge: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleSaveHostPort = async () => {
        const port = Number(hostPortDraft);
        if (!port) { toast.error('Enter a valid port.'); return; }
        setBusy(true);
        try {
            await api.request('/tramo/settings', { method: 'PUT', body: { host_port: port } });
            toast.success('Host port updated');
            await loadSettings();
        } catch (error) {
            toast.error(`Could not update host port: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    // ── Renderers ──
    const renderWorkflows = () => (
        <div className="card">
            <div className="card-body">
                {wfLoading ? <EmptyState loading title="Loading workflows..." />
                    : workflows.length === 0 ? (
                        <EmptyState
                            icon={Workflow}
                            title="No automations yet"
                            description="Create a workflow on the visual canvas, or start from a template. Enable it and deploy to run it headless on the tramo engine."
                        />
                    ) : (
                        <table className="sk-dtable">
                            <thead>
                                <tr>
                                    <th>Name</th><th>Enabled</th><th>State</th><th>Version</th><th>Updated</th><th /></tr>
                            </thead>
                            <tbody>
                                {workflows.map((wf) => (
                                    <tr key={wf.id ?? wf.slug}>
                                        <td className="sk-cell-mono">{wf.name}</td>
                                        <td>
                                            <button
                                                type="button"
                                                className={`tramo-toggle${wf.enabled ? ' tramo-toggle--on' : ''}`}
                                                onClick={() => handleToggleEnabled(wf)}
                                                aria-pressed={wf.enabled}
                                                title={wf.enabled ? 'Disable' : 'Enable'}
                                            >
                                                <span className="tramo-toggle__knob" />
                                            </button>
                                        </td>
                                        <td>
                                            {wf.dirty
                                                ? <Pill kind="amber" title="Edited since last deploy">undeployed</Pill>
                                                : <Pill kind="green">deployed</Pill>}
                                        </td>
                                        <td className="sk-cell-mono">{wf.doc_version ?? '—'}</td>
                                        <td className="sk-cell-mono">{wf.updated_at ? new Date(wf.updated_at).toLocaleString() : '—'}</td>
                                        <td className="tramo-row-actions">
                                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleRunWorkflow(wf)} title="Run now">
                                                <Play size={14} />
                                            </Button>
                                            <Button variant="secondary" size="sm" onClick={() => navigate(`/automations/edit/${wf.slug}`)} title="Edit">
                                                <Pencil size={14} />
                                            </Button>
                                            <Button variant="destructive" size="sm" onClick={() => handleDeleteWorkflow(wf)} title="Delete">
                                                <Trash2 size={14} />
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
            </div>
        </div>
    );

    const renderRuns = () => (
        <>
            {approvals.length > 0 && (
                <div className="card tramo-approvals">
                    <div className="card-header">
                        <h3>Pending approvals <span className="sec-count">· {approvals.length}</span></h3>
                    </div>
                    <div className="card-body">
                        {approvals.map((a) => (
                            <div className="tramo-approval" key={a.run_id}>
                                <div className="tramo-approval__info">
                                    <span className="sk-cell-mono">{a.workflow_slug || a.workflow || '—'}</span>
                                    <span className="text-muted">{a.node || a.message || 'Awaiting approval'}</span>
                                </div>
                                <Button variant="default" size="sm" disabled={busy} onClick={() => handleApprove(a.run_id)}>
                                    <CheckCircle2 size={14} /> Approve
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div className="card">
                <div className="card-body">
                    {runsLoading ? <EmptyState loading title="Loading runs..." />
                        : runs.length === 0 ? (
                            <EmptyState icon={Play} title="No runs yet" description="Deploy an enabled workflow, then trigger it or wait for a matching event." />
                        ) : (
                            <table className="sk-dtable">
                                <thead>
                                    <tr>
                                        <th>Status</th><th>Workflow</th><th>Source</th><th>Duration</th><th>Tokens</th><th>Error</th><th /></tr>
                                </thead>
                                <tbody>
                                    {runs.map((r) => (
                                        <tr key={r.run_id}>
                                            <td>{runPill(r.status)}</td>
                                            <td className="sk-cell-mono">{r.workflow_slug || '—'}</td>
                                            <td><Pill kind="gray">{r.source || 'manual'}</Pill></td>
                                            <td className="sk-cell-mono">{formatDuration(r.started_at, r.finished_at)}</td>
                                            <td className="sk-cell-mono">{r.usage?.total_tokens ?? r.usage?.tokens ?? '—'}</td>
                                            <td className="sk-cell-mono tramo-truncate" title={r.error || ''}>{r.error || '—'}</td>
                                            <td className="tramo-row-actions">
                                                <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleReplay(r.run_id)} title="Replay">
                                                    <RefreshCw size={14} />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                </div>
            </div>
        </>
    );

    const renderSettings = () => {
        const state = host?.state || 'not_installed';
        const installed = !!host?.installed;
        const notSupported = !installed && !!host?.error;
        return (
            <>
                <div className="card">
                    <div className="card-header">
                        <h3><Server size={16} /> Automation engine</h3>
                        <div className="card-actions">
                            <Button variant="outline" size="sm" onClick={loadSettings} disabled={settingsLoading}>
                                <RefreshCw size={14} /> Refresh
                            </Button>
                        </div>
                    </div>
                    <div className="card-body">
                        {settingsLoading && !host ? <EmptyState loading title="Loading engine status..." /> : (
                            <>
                                <div className="sec-rows">
                                    <div className="sk-info-row">
                                        <span className="k">Status</span>
                                        {hostPill(state)}
                                    </div>
                                    <div className="sk-info-row">
                                        <span className="k">Container</span>
                                        <span className="v sk-cell-mono">{host?.container || '—'}</span>
                                    </div>
                                    <div className="sk-info-row">
                                        <span className="k">Image</span>
                                        <span className="v sk-cell-mono">{host?.image || '—'}</span>
                                    </div>
                                    <div className="sk-info-row">
                                        <span className="k">Host port</span>
                                        <span className="v sk-cell-mono">{host?.host_port ?? '—'}</span>
                                    </div>
                                    {host?.version && (
                                        <div className="sk-info-row">
                                            <span className="k">Version</span>
                                            <span className="v sk-cell-mono">{host.version}</span>
                                        </div>
                                    )}
                                </div>

                                {notSupported && (
                                    <div className="tramo-note">
                                        Docker is required to run the tramo engine, and it is not available on this
                                        host (the engine does not run on Windows dev boxes). You can still design
                                        workflows; deploying and running them needs a Linux host with Docker.
                                        <div className="tramo-note__detail">{host.error}</div>
                                    </div>
                                )}

                                <div className="tramo-host-actions">
                                    {!installed ? (
                                        <div className="tramo-install">
                                            <div className="form-group">
                                                <Label>Host port (optional)</Label>
                                                <Input
                                                    type="number"
                                                    value={installPort}
                                                    placeholder={String(host?.host_port ?? 3737)}
                                                    onChange={(e) => setInstallPort(e.target.value)}
                                                />
                                            </div>
                                            <Button variant="default" size="sm" onClick={handleInstall} disabled={busy}>
                                                <Power size={14} /> Install engine
                                            </Button>
                                        </div>
                                    ) : (
                                        <>
                                            <Button variant="outline" size="sm" onClick={() => handleControl('restart')} disabled={busy}>
                                                <RefreshCw size={14} /> Restart
                                            </Button>
                                            {host?.running ? (
                                                <Button variant="outline" size="sm" onClick={() => handleControl('stop')} disabled={busy}>
                                                    <Power size={14} /> Stop
                                                </Button>
                                            ) : (
                                                <Button variant="default" size="sm" onClick={() => handleControl('start')} disabled={busy}>
                                                    <Power size={14} /> Start
                                                </Button>
                                            )}
                                            <Button variant="secondary" size="sm" onClick={() => handleUninstall(true)} disabled={busy}>
                                                Remove (keep data)
                                            </Button>
                                            <Button variant="destructive" size="sm" onClick={() => handleUninstall(false)} disabled={busy}>
                                                <Trash2 size={14} /> Remove + data
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><h3>Engine settings</h3></div>
                    <div className="card-body tramo-settings">
                        <div className="tramo-field">
                            <div className="tramo-field__label">
                                <Label>Events bridge</Label>
                                <p className="text-muted">Forward panel events to tramo so workflows can react to them.</p>
                            </div>
                            <button
                                type="button"
                                className={`tramo-toggle${settings?.events_bridge_enabled ? ' tramo-toggle--on' : ''}`}
                                onClick={handleToggleBridge}
                                disabled={busy}
                                aria-pressed={!!settings?.events_bridge_enabled}
                            >
                                <span className="tramo-toggle__knob" />
                            </button>
                        </div>
                        <div className="tramo-field tramo-field--inline">
                            <div className="tramo-field__label">
                                <Label>Host port</Label>
                                <p className="text-muted">Port the tramo container is published on.</p>
                            </div>
                            <div className="tramo-field__control">
                                <Input type="number" value={hostPortDraft} onChange={(e) => setHostPortDraft(e.target.value)} />
                                <Button variant="secondary" size="sm" onClick={handleSaveHostPort} disabled={busy}>Save</Button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card sec-flush">
                    <div className="card-header">
                        <h3><KeyRound size={16} /> Pack secrets</h3>
                    </div>
                    <div className="card-body">
                        <p className="text-muted">
                            Credentials integration packs need (API keys, tokens). Values are write-only — they are
                            stored encrypted and never shown again after saving.
                        </p>
                        {(settings?.pack_secret_names?.length ?? 0) === 0 ? (
                            <p className="text-muted">No pack secrets set yet.</p>
                        ) : (
                            <div className="tramo-secret-list">
                                {settings.pack_secret_names.map((name) => (
                                    <div className="tramo-secret" key={name}>
                                        <span className="sk-cell-mono">{name}</span>
                                        <Pill kind="green">set</Pill>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="tramo-secret-add">
                            <div className="form-group">
                                <Label>Name</Label>
                                <Input
                                    type="text"
                                    value={newSecret.name}
                                    placeholder="TELEGRAM_BOT_TOKEN"
                                    onChange={(e) => setNewSecret((s) => ({ ...s, name: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <Label>Value</Label>
                                <Input
                                    type="password"
                                    value={newSecret.value}
                                    onChange={(e) => setNewSecret((s) => ({ ...s, value: e.target.value }))}
                                />
                            </div>
                            <Button variant="default" size="sm" onClick={handleAddSecret} disabled={busy}>
                                <Plus size={14} /> Add secret
                            </Button>
                        </div>
                    </div>
                </div>
            </>
        );
    };

    const topbarTabs = TABS.map(({ to, label, end }) => ({ to, label, end }));

    // Actions live in the topbar (like Domains / WordPress) and are contextual
    // to the active tab, so the content area carries no second header row.
    let topbarActions = null;
    if (activeTab === 'workflows') {
        topbarActions = (
            <>
                <Button variant="outline" size="sm" onClick={handleDeploy} disabled={busy}>
                    <Rocket size={14} /> Deploy
                </Button>
                <Button variant="secondary" size="sm" onClick={openTemplateModal}>
                    <LayoutTemplate size={14} /> New from template
                </Button>
                <Button variant="default" size="sm" onClick={() => { setNewName(''); setNewModal(true); }}>
                    <Plus size={14} /> New workflow
                </Button>
            </>
        );
    } else if (activeTab === 'runs') {
        topbarActions = (
            <Button variant="outline" size="sm" onClick={loadRuns} disabled={runsLoading}>
                <RefreshCw size={14} /> Refresh
            </Button>
        );
    } else if (activeTab === 'settings') {
        topbarActions = (
            <Button variant="outline" size="sm" onClick={loadSettings} disabled={settingsLoading}>
                <RefreshCw size={14} /> Refresh
            </Button>
        );
    }

    return (
        <div className="page-container page-container--full-bleed sk-tabgroup tramo-page">
            <PageTopbar
                icon={<Workflow size={18} />}
                title="Automations"
                tabs={topbarTabs}
                actions={topbarActions}
            />

            <div className="sk-tabgroup__content">
                {activeTab === 'workflows' && renderWorkflows()}
                {activeTab === 'runs' && renderRuns()}
                {activeTab === 'settings' && renderSettings()}
            </div>

            {/* New workflow modal */}
            <Modal open={newModal} onClose={() => setNewModal(false)} title="New workflow">
                <div className="form-group">
                    <Label>Name</Label>
                    <Input
                        type="text"
                        value={newName}
                        placeholder="Notify on deploy"
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                    />
                    <p className="text-muted">You will land on the visual editor to design the flow.</p>
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setNewModal(false)}>Cancel</Button>
                    <Button variant="default" onClick={handleCreate} disabled={busy || !newName.trim()}>Create</Button>
                </div>
            </Modal>

            {/* New from template modal */}
            <Modal open={templateModal} onClose={() => setTemplateModal(false)} title="New from template">
                {templates.length === 0 ? (
                    <EmptyState icon={LayoutTemplate} title="No templates available" />
                ) : (
                    <div className="tramo-template-list">
                        {templates.map((t) => (
                            <button
                                type="button"
                                className="tramo-template"
                                key={t.id}
                                onClick={() => handleFromTemplate(t)}
                                disabled={busy}
                            >
                                <span className="tramo-template__name">{t.name}</span>
                                {t.description && <span className="tramo-template__desc">{t.description}</span>}
                            </button>
                        ))}
                    </div>
                )}
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setTemplateModal(false)}><X size={14} /> Close</Button>
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

export { AutomationsPage };
export default AutomationsPage;
