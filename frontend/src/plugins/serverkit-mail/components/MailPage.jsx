import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Mail, RefreshCw, Plus, Trash2, ShieldCheck, ShieldAlert,
    Globe, AtSign, Forward, KeyRound, Inbox, Copy, Power, Send,
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

// Route-driven tabs (manifest maps /mail and /mail/:tab to this component).
const TABS = [
    { slug: 'overview', to: '/mail', label: 'Overview', end: true },
    { slug: 'domains', to: '/mail/domains', label: 'Domains' },
    { slug: 'mailboxes', to: '/mail/mailboxes', label: 'Mailboxes' },
    { slug: 'forwarders', to: '/mail/forwarders', label: 'Forwarders' },
    { slug: 'dns', to: '/mail/dns', label: 'DNS & DKIM' },
    { slug: 'queue', to: '/mail/queue', label: 'Queue' },
];
const VALID_TABS = TABS.map((t) => t.slug);

// A preflight check either passed, failed, or was skipped (e.g. on a dev box).
function checkPill(ok, skipped) {
    if (skipped) return <Pill kind="gray">skipped</Pill>;
    return ok ? <Pill kind="green">pass</Pill> : <Pill kind="red">fail</Pill>;
}

const MailPage = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const { tab } = useParams();
    const activeTab = VALID_TABS.includes(tab) ? tab : 'overview';

    const [status, setStatus] = useState(null);
    const [preflight, setPreflight] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);

    // Overview / install
    const [installHostname, setInstallHostname] = useState('');

    // Domains
    const [domains, setDomains] = useState([]);
    const [showDomainForm, setShowDomainForm] = useState(false);
    const [newDomain, setNewDomain] = useState({ name: '', catch_all_target: '' });
    const [catchAllModal, setCatchAllModal] = useState(null); // { id, name, value }

    // Selected domain (shared by mailboxes / forwarders / dns)
    const [selectedDomainId, setSelectedDomainId] = useState('');

    // Mailboxes
    const [mailboxes, setMailboxes] = useState([]);
    const [showMailboxForm, setShowMailboxForm] = useState(false);
    const [newMailbox, setNewMailbox] = useState({ local_part: '', password: '', quota_mb: 0, display_name: '' });
    const [passwordModal, setPasswordModal] = useState(null); // { id, address }
    const [newPassword, setNewPassword] = useState('');
    const [autoModal, setAutoModal] = useState(null); // { id, address }
    const [autoResponder, setAutoResponder] = useState({ enabled: false, subject: '', body: '', start_at: '', end_at: '' });

    // Forwarders
    const [forwarders, setForwarders] = useState([]);
    const [showForwarderForm, setShowForwarderForm] = useState(false);
    const [newForwarder, setNewForwarder] = useState({ source_local_part: '', destination: '', keep_copy: true });

    // DNS & DKIM
    const [dnsInfo, setDnsInfo] = useState(null);

    // Queue
    const [queue, setQueue] = useState({ messages: [], note: null });

    // ── Loaders ──

    const loadStatus = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.request('/mail/status');
            setStatus(data);
            setPreflight(data?.preflight ?? null);
        } catch (error) {
            toast.error(`Failed to load mail server status: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    const loadDomains = useCallback(async () => {
        try {
            const data = await api.request('/mail/domains');
            setDomains(data.domains || []);
        } catch (error) {
            toast.error(`Failed to load domains: ${error.message}`);
        }
    }, [toast]);

    const loadMailboxes = useCallback(async (domainId) => {
        if (!domainId) { setMailboxes([]); return; }
        try {
            const data = await api.request(`/mail/domains/${domainId}/mailboxes`);
            setMailboxes(data.mailboxes || []);
        } catch (error) {
            toast.error(`Failed to load mailboxes: ${error.message}`);
        }
    }, [toast]);

    const loadForwarders = useCallback(async (domainId) => {
        if (!domainId) { setForwarders([]); return; }
        try {
            const data = await api.request(`/mail/domains/${domainId}/forwarders`);
            setForwarders(data.forwarders || []);
        } catch (error) {
            toast.error(`Failed to load forwarders: ${error.message}`);
        }
    }, [toast]);

    const loadDns = useCallback(async (domainId) => {
        if (!domainId) { setDnsInfo(null); return; }
        try {
            const data = await api.request(`/mail/domains/${domainId}/dns`);
            setDnsInfo(data);
        } catch (error) {
            toast.error(`Failed to load DNS records: ${error.message}`);
            setDnsInfo(null);
        }
    }, [toast]);

    const loadQueue = useCallback(async () => {
        try {
            const data = await api.request('/mail/queue');
            setQueue({ messages: data.messages || [], note: data.note || null });
        } catch (error) {
            // 503 before install, or the admin API is unreachable — degrade gracefully.
            setQueue({ messages: [], note: error.message });
        }
    }, []);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    // Domains feed the selector on the mailboxes/forwarders/dns tabs too.
    useEffect(() => {
        if (['domains', 'mailboxes', 'forwarders', 'dns'].includes(activeTab)) loadDomains();
    }, [activeTab, loadDomains]);

    useEffect(() => {
        if (activeTab === 'mailboxes') loadMailboxes(selectedDomainId);
    }, [activeTab, selectedDomainId, loadMailboxes]);

    useEffect(() => {
        if (activeTab === 'forwarders') loadForwarders(selectedDomainId);
    }, [activeTab, selectedDomainId, loadForwarders]);

    useEffect(() => {
        if (activeTab === 'dns') loadDns(selectedDomainId);
    }, [activeTab, selectedDomainId, loadDns]);

    useEffect(() => {
        if (activeTab === 'queue') loadQueue();
    }, [activeTab, loadQueue]);

    // ── Overview actions ──

    const handleInstall = async () => {
        if (!installHostname.trim()) return;
        setActionLoading(true);
        try {
            await api.request('/mail/install', {
                method: 'POST',
                body: { hostname: installHostname.trim() },
            });
            toast.success('Mail server installed');
            setInstallHostname('');
            await loadStatus();
        } catch (error) {
            toast.error(`Install failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleUninstall = (keepData) => {
        setConfirmDialog({
            title: 'Remove mail server',
            message: keepData
                ? 'Remove the Stalwart container? Mail data stays on disk and a reinstall picks it back up.'
                : 'Remove the Stalwart container AND delete all mail data? This cannot be undone.',
            confirmText: 'Remove',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.request(`/mail/install?keep_data=${keepData}`, { method: 'DELETE' });
                    toast.success('Mail server removed');
                    await loadStatus();
                } catch (error) {
                    toast.error(`Uninstall failed: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleService = async (action) => {
        setActionLoading(true);
        try {
            await api.request(`/mail/service/${action}`, { method: 'POST' });
            toast.success(`Mail server ${action} successful`);
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to ${action} mail server: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRunPreflight = async () => {
        const hostname = status?.hostname || installHostname.trim() || preflight?.hostname || '';
        if (!hostname) {
            toast.error('Install the mail server (or set a hostname) before running preflight.');
            return;
        }
        setActionLoading(true);
        try {
            const result = await api.request('/mail/preflight', {
                method: 'POST',
                body: { hostname },
            });
            setPreflight(result);
            if (result?.passed) toast.success('Deliverability preflight passed');
            else toast.error('Preflight found blocking issues — see the checks below');
        } catch (error) {
            toast.error(`Preflight failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    // ── Domain actions ──

    const handleAddDomain = async (e) => {
        e.preventDefault();
        if (!newDomain.name.trim()) return;
        setActionLoading(true);
        try {
            await api.request('/mail/domains', {
                method: 'POST',
                body: {
                    name: newDomain.name.trim(),
                    catch_all_target: newDomain.catch_all_target.trim() || undefined,
                },
            });
            toast.success(`Domain ${newDomain.name} added`);
            setShowDomainForm(false);
            setNewDomain({ name: '', catch_all_target: '' });
            await loadDomains();
        } catch (error) {
            toast.error(`Failed to add domain: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleToggleDomain = async (domain) => {
        try {
            await api.request(`/mail/domains/${domain.id}`, {
                method: 'PATCH',
                body: { is_active: !domain.is_active },
            });
            toast.success(`Domain ${domain.is_active ? 'deactivated' : 'activated'}`);
            await loadDomains();
        } catch (error) {
            // Preflight gate returns 409 — surface the guidance clearly.
            toast.error(`Could not change domain state: ${error.message}`);
        }
    };

    const handleSaveCatchAll = async () => {
        if (!catchAllModal) return;
        setActionLoading(true);
        try {
            await api.request(`/mail/domains/${catchAllModal.id}`, {
                method: 'PATCH',
                body: { catch_all_target: catchAllModal.value.trim() },
            });
            toast.success('Catch-all updated');
            setCatchAllModal(null);
            await loadDomains();
        } catch (error) {
            toast.error(`Failed to update catch-all: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteDomain = (domain) => {
        setConfirmDialog({
            title: 'Delete domain',
            message: `Delete ${domain.name} and all of its mailboxes and forwarders?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.request(`/mail/domains/${domain.id}`, { method: 'DELETE' });
                    toast.success(`Domain ${domain.name} deleted`);
                    await loadDomains();
                } catch (error) {
                    toast.error(`Failed to delete domain: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const openDnsForDomain = (domainId) => {
        setSelectedDomainId(String(domainId));
        navigate('/mail/dns');
    };

    // ── Mailbox actions ──

    const handleAddMailbox = async (e) => {
        e.preventDefault();
        if (!selectedDomainId || !newMailbox.local_part.trim() || !newMailbox.password) return;
        setActionLoading(true);
        try {
            await api.request(`/mail/domains/${selectedDomainId}/mailboxes`, {
                method: 'POST',
                body: {
                    local_part: newMailbox.local_part.trim(),
                    password: newMailbox.password,
                    quota_mb: Number(newMailbox.quota_mb) || 0,
                    display_name: newMailbox.display_name.trim() || undefined,
                },
            });
            toast.success('Mailbox created');
            setShowMailboxForm(false);
            setNewMailbox({ local_part: '', password: '', quota_mb: 0, display_name: '' });
            await loadMailboxes(selectedDomainId);
        } catch (error) {
            toast.error(`Failed to create mailbox: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleToggleMailbox = async (mailbox) => {
        try {
            await api.request(`/mail/mailboxes/${mailbox.id}`, {
                method: 'PATCH',
                body: { is_active: !mailbox.is_active },
            });
            await loadMailboxes(selectedDomainId);
        } catch (error) {
            toast.error(`Failed to update mailbox: ${error.message}`);
        }
    };

    const handleChangePassword = async () => {
        if (!passwordModal || !newPassword) return;
        setActionLoading(true);
        try {
            await api.request(`/mail/mailboxes/${passwordModal.id}/password`, {
                method: 'POST',
                body: { password: newPassword },
            });
            toast.success('Password changed');
            setPasswordModal(null);
            setNewPassword('');
        } catch (error) {
            toast.error(`Failed to change password: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteMailbox = (mailbox) => {
        setConfirmDialog({
            title: 'Delete mailbox',
            message: `Delete ${mailbox.address || mailbox.local_part}? The mailbox and its mail are removed.`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.request(`/mail/mailboxes/${mailbox.id}`, { method: 'DELETE' });
                    toast.success('Mailbox deleted');
                    await loadMailboxes(selectedDomainId);
                } catch (error) {
                    toast.error(`Failed to delete mailbox: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const openAutoResponder = async (mailbox) => {
        setAutoModal({ id: mailbox.id, address: mailbox.address || mailbox.local_part });
        setAutoResponder({ enabled: false, subject: '', body: '', start_at: '', end_at: '' });
        try {
            const data = await api.request(`/mail/mailboxes/${mailbox.id}/autoresponder`);
            const ar = data.autoresponder || {};
            setAutoResponder({
                enabled: !!ar.enabled,
                subject: ar.subject || '',
                body: ar.body || '',
                start_at: ar.start_at || '',
                end_at: ar.end_at || '',
            });
        } catch (error) {
            toast.error(`Failed to load autoresponder: ${error.message}`);
        }
    };

    const handleSaveAutoResponder = async () => {
        if (!autoModal) return;
        setActionLoading(true);
        try {
            await api.request(`/mail/mailboxes/${autoModal.id}/autoresponder`, {
                method: 'PUT',
                body: {
                    enabled: autoResponder.enabled,
                    subject: autoResponder.subject,
                    body: autoResponder.body,
                    start_at: autoResponder.start_at || null,
                    end_at: autoResponder.end_at || null,
                },
            });
            toast.success('Autoresponder saved');
            setAutoModal(null);
        } catch (error) {
            toast.error(`Failed to save autoresponder: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    // ── Forwarder actions ──

    const handleAddForwarder = async (e) => {
        e.preventDefault();
        if (!selectedDomainId || !newForwarder.source_local_part.trim() || !newForwarder.destination.trim()) return;
        setActionLoading(true);
        try {
            await api.request(`/mail/domains/${selectedDomainId}/forwarders`, {
                method: 'POST',
                body: {
                    source_local_part: newForwarder.source_local_part.trim(),
                    destination: newForwarder.destination.trim(),
                    keep_copy: newForwarder.keep_copy,
                },
            });
            toast.success('Forwarder created');
            setShowForwarderForm(false);
            setNewForwarder({ source_local_part: '', destination: '', keep_copy: true });
            await loadForwarders(selectedDomainId);
        } catch (error) {
            toast.error(`Failed to create forwarder: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteForwarder = (forwarder) => {
        setConfirmDialog({
            title: 'Delete forwarder',
            message: `Delete the forwarder for ${forwarder.source || forwarder.source_local_part}?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.request(`/mail/forwarders/${forwarder.id}`, { method: 'DELETE' });
                    toast.success('Forwarder deleted');
                    await loadForwarders(selectedDomainId);
                } catch (error) {
                    toast.error(`Failed to delete forwarder: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    // ── DNS & DKIM actions ──

    const handleGenerateDkim = async () => {
        if (!selectedDomainId) return;
        setActionLoading(true);
        try {
            await api.request(`/mail/domains/${selectedDomainId}/dkim`, { method: 'POST' });
            toast.success('DKIM key generated');
            await loadDns(selectedDomainId);
            await loadDomains();
        } catch (error) {
            toast.error(`DKIM generation failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeployDns = async () => {
        if (!selectedDomainId) return;
        setActionLoading(true);
        try {
            const result = await api.request(`/mail/domains/${selectedDomainId}/dns/deploy`, { method: 'POST' });
            if (result?.manual) toast.error('No DNS provider connected — publish the records manually');
            else toast.success('DNS records deployed');
            await loadDns(selectedDomainId);
        } catch (error) {
            toast.error(`DNS deploy failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRequestCert = async () => {
        if (!selectedDomainId) return;
        setActionLoading(true);
        try {
            const result = await api.request(`/mail/domains/${selectedDomainId}/cert`, { method: 'POST' });
            if (result?.skipped) toast.error(result.error || 'Certificate request skipped');
            else toast.success('Certificate requested');
        } catch (error) {
            toast.error(`Certificate request failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const copyValue = async (value) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success('Copied to clipboard');
        } catch {
            toast.error('Could not copy to clipboard');
        }
    };

    // ── Queue actions ──

    const handleFlushQueue = async () => {
        setActionLoading(true);
        try {
            await api.request('/mail/queue/flush', { method: 'POST' });
            toast.success('Queue flush requested');
            await loadQueue();
        } catch (error) {
            toast.error(`Failed to flush queue: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    // ── Render helpers ──

    const topbarTabs = TABS.map(({ to, label, end }) => ({ to, label, end }));
    const installed = !!status?.installed;
    const selectedDomain = domains.find((d) => String(d.id) === String(selectedDomainId));

    const DomainSelector = () => (
        <div className="mail-domain-picker">
            <Label>Domain</Label>
            <select
                value={selectedDomainId}
                onChange={(e) => setSelectedDomainId(e.target.value)}
                className="mail-select"
            >
                <option value="">— Select a domain —</option>
                {domains.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                ))}
            </select>
        </div>
    );

    const renderPreflightBanner = () => {
        const passed = !!preflight?.passed;
        return (
            <div className={`card mail-preflight mail-preflight--${passed ? 'ok' : 'warn'}`}>
                <div className="card-header">
                    <h3>
                        {passed
                            ? <><ShieldCheck size={16} /> Deliverability preflight passed</>
                            : <><ShieldAlert size={16} /> Sending is blocked until preflight passes</>}
                    </h3>
                    <div className="card-actions">
                        <Button variant="default" size="sm" onClick={handleRunPreflight} disabled={actionLoading}>
                            <RefreshCw size={14} /> Run preflight
                        </Button>
                    </div>
                </div>
                <div className="card-body">
                    {!preflight ? (
                        <p className="text-muted">
                            No preflight has run yet. Outbound mail stays disabled until PTR, port-25
                            egress and RBL checks pass — run a preflight to see where this host stands.
                        </p>
                    ) : (
                        <>
                            <div className="mail-preflight__checks">
                                <div className="mail-check">
                                    <div className="mail-check__head">
                                        <span className="k">PTR / reverse DNS</span>
                                        {checkPill(preflight.ptr_ok, preflight.ptr_ok === null)}
                                    </div>
                                    <p className="text-muted">
                                        {preflight.ptr_value
                                            ? `Resolves to ${preflight.ptr_value}.`
                                            : 'The public IP must resolve back to your mail hostname or receivers reject you.'}
                                    </p>
                                </div>
                                <div className="mail-check">
                                    <div className="mail-check__head">
                                        <span className="k">Port 25 egress</span>
                                        {checkPill(preflight.port25_ok, preflight.port25_ok === null)}
                                    </div>
                                    <p className="text-muted">
                                        Many providers block outbound port 25. Without it this host cannot deliver mail directly.
                                    </p>
                                </div>
                                <div className="mail-check">
                                    <div className="mail-check__head">
                                        <span className="k">RBL / blocklists</span>
                                        {checkPill(preflight.rbl_ok, preflight.rbl_ok === null)}
                                    </div>
                                    <p className="text-muted">
                                        {(preflight.rbl_hits && preflight.rbl_hits.length)
                                            ? `Listed on: ${preflight.rbl_hits.join(', ')}`
                                            : 'The IP is not on the blocklists we check.'}
                                    </p>
                                </div>
                                <div className="mail-check">
                                    <div className="mail-check__head">
                                        <span className="k">Listening ports</span>
                                        {checkPill(preflight.ports_ok, preflight.ports_ok === null)}
                                    </div>
                                    <p className="text-muted">
                                        SMTP/submission/IMAPS ports (25/465/587/993) should be reachable on this host.
                                    </p>
                                </div>
                            </div>
                            {preflight.checked_at && (
                                <p className="text-muted mail-preflight__ts">
                                    Last checked {new Date(preflight.checked_at).toLocaleString()}
                                    {' · '}
                                    {passed
                                        ? 'sending is allowed.'
                                        : 'fix the failing checks (or force-activate a domain knowingly) before relying on delivery.'}
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
        );
    };

    // ── Tab bodies ──

    const renderOverview = () => {
        if (!installed) {
            return (
                <>
                    {renderPreflightBanner()}
                    <div className="card">
                        <div className="card-header"><h3>Mail Server Not Installed</h3></div>
                        <div className="card-body">
                            <p className="text-muted">
                                Run Stalwart (SMTP + IMAP + admin API) in a managed Docker container so this
                                box hosts mail for your domains — mailboxes, forwarders, autoresponders, and
                                automatic DKIM/SPF/DMARC/MX records.
                            </p>
                            <div className="mail-install-form">
                                <div className="form-group">
                                    <Label>Mail hostname</Label>
                                    <Input
                                        type="text"
                                        value={installHostname}
                                        onChange={(e) => setInstallHostname(e.target.value)}
                                        placeholder="mail.example.com"
                                    />
                                    <p className="text-muted">
                                        The public hostname clients connect to. It should resolve to this box&apos;s
                                        public IP and have a matching PTR record.
                                    </p>
                                </div>
                                <div className="mail-install-actions">
                                    <Button
                                        variant="default"
                                        onClick={handleInstall}
                                        disabled={actionLoading || !installHostname.trim()}
                                    >
                                        {actionLoading ? 'Installing...' : 'Install Mail Server'}
                                    </Button>
                                    <Button variant="outline" onClick={loadStatus}>
                                        <RefreshCw size={14} /> Re-check
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            );
        }

        return (
            <>
                {renderPreflightBanner()}
                <div className="card">
                    <div className="card-header">
                        <h3>Server Status</h3>
                        <div className="card-actions">
                            <Button variant="secondary" size="sm" onClick={() => handleUninstall(true)}>
                                Remove (keep data)
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleUninstall(false)}>
                                <Trash2 size={14} /> Remove + data
                            </Button>
                        </div>
                    </div>
                    <div className="card-body">
                        <div className="sec-rows">
                            <div className="sk-info-row">
                                <span className="k">Container</span>
                                <Pill kind={status.running ? 'green' : 'red'}>
                                    {status.running ? 'Running' : 'Stopped'}
                                </Pill>
                            </div>
                            <div className="sk-info-row">
                                <span className="k">Engine</span>
                                <span className="v">
                                    {status.engine || 'Stalwart'} {status.version ? `v${status.version}` : ''}
                                </span>
                            </div>
                            {status.hostname && (
                                <div className="sk-info-row">
                                    <span className="k">Hostname</span>
                                    <span className="v sk-cell-mono">{status.hostname}</span>
                                </div>
                            )}
                            {status.ports && (
                                <div className="sk-info-row">
                                    <span className="k">Ports</span>
                                    <span className="v sk-cell-mono">
                                        {Array.isArray(status.ports) ? status.ports.join(', ') : String(status.ports)}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div className="mail-service-actions">
                            <Button variant="outline" size="sm" onClick={() => handleService('restart')} disabled={actionLoading}>
                                <RefreshCw size={14} /> Restart
                            </Button>
                            {status.running ? (
                                <Button variant="outline" size="sm" onClick={() => handleService('stop')} disabled={actionLoading}>
                                    <Power size={14} /> Stop
                                </Button>
                            ) : (
                                <Button variant="default" size="sm" onClick={() => handleService('start')} disabled={actionLoading}>
                                    <Power size={14} /> Start
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </>
        );
    };

    const renderDomains = () => (
        <div className="card sec-flush">
            <div className="card-header">
                <h3>Domains {domains.length > 0 && <span className="sec-count">· {domains.length}</span>}</h3>
                <div className="card-actions">
                    <Button variant="default" size="sm" onClick={() => setShowDomainForm((v) => !v)}>
                        <Plus size={14} /> {showDomainForm ? 'Cancel' : 'Add Domain'}
                    </Button>
                </div>
            </div>
            {showDomainForm && (
                <div className="card-body">
                    <form className="mail-form" onSubmit={handleAddDomain}>
                        <div className="form-group">
                            <Label>Domain name</Label>
                            <Input
                                type="text"
                                value={newDomain.name}
                                onChange={(e) => setNewDomain((f) => ({ ...f, name: e.target.value }))}
                                placeholder="example.com"
                            />
                        </div>
                        <div className="form-group">
                            <Label>Catch-all target (optional)</Label>
                            <Input
                                type="text"
                                value={newDomain.catch_all_target}
                                onChange={(e) => setNewDomain((f) => ({ ...f, catch_all_target: e.target.value }))}
                                placeholder="postmaster@example.com"
                            />
                        </div>
                        <div className="mail-install-actions">
                            <Button type="submit" variant="default" size="sm" disabled={actionLoading || !newDomain.name.trim()}>
                                Add Domain
                            </Button>
                        </div>
                    </form>
                </div>
            )}
            {domains.length === 0 ? (
                <div className="card-body">
                    <p className="text-muted">No mail domains yet. Add one, then generate DKIM and publish its DNS records.</p>
                </div>
            ) : (
                <table className="sk-dtable">
                    <thead>
                        <tr>
                            <th>Domain</th>
                            <th>Catch-all</th>
                            <th>Sync</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {domains.map((d) => (
                            <tr key={d.id}>
                                <td className="sk-cell-name">
                                    <span className="mail-fav"><Globe size={14} /></span>
                                    <span className="sk-cell-mono">{d.name}</span>
                                </td>
                                <td className="sk-cell-mono">{d.catch_all_target || '—'}</td>
                                <td>
                                    {d.sync_state === 'error'
                                        ? <Pill kind="amber" title={d.sync_error || 'Out of sync with the engine'}>drift</Pill>
                                        : <Pill kind={d.sync_state === 'synced' ? 'green' : 'gray'}>{d.sync_state || 'pending'}</Pill>}
                                </td>
                                <td>
                                    <Pill kind={d.is_active ? 'green' : 'gray'}>{d.is_active ? 'active' : 'inactive'}</Pill>
                                </td>
                                <td>
                                    <div className="mail-row-actions">
                                        <Button variant="secondary" size="sm" onClick={() => handleToggleDomain(d)}>
                                            {d.is_active ? 'Deactivate' : 'Activate'}
                                        </Button>
                                        <Button variant="secondary" size="sm" onClick={() => setCatchAllModal({ id: d.id, name: d.name, value: d.catch_all_target || '' })}>
                                            Catch-all
                                        </Button>
                                        <Button variant="secondary" size="sm" onClick={() => openDnsForDomain(d.id)}>
                                            <KeyRound size={14} /> DNS
                                        </Button>
                                        <Button variant="destructive" size="sm" onClick={() => handleDeleteDomain(d)}>
                                            Delete
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );

    const renderMailboxes = () => (
        <>
            <div className="card">
                <div className="card-body">
                    <DomainSelector />
                </div>
            </div>
            {selectedDomainId && (
                <div className="card sec-flush">
                    <div className="card-header">
                        <h3>Mailboxes {mailboxes.length > 0 && <span className="sec-count">· {mailboxes.length}</span>}</h3>
                        <div className="card-actions">
                            <Button variant="default" size="sm" onClick={() => setShowMailboxForm((v) => !v)}>
                                <Plus size={14} /> {showMailboxForm ? 'Cancel' : 'Add Mailbox'}
                            </Button>
                        </div>
                    </div>
                    {showMailboxForm && (
                        <div className="card-body">
                            <form className="mail-form" onSubmit={handleAddMailbox}>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <Label>Local part</Label>
                                        <Input
                                            type="text"
                                            value={newMailbox.local_part}
                                            onChange={(e) => setNewMailbox((f) => ({ ...f, local_part: e.target.value }))}
                                            placeholder="alice"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <Label>Display name (optional)</Label>
                                        <Input
                                            type="text"
                                            value={newMailbox.display_name}
                                            onChange={(e) => setNewMailbox((f) => ({ ...f, display_name: e.target.value }))}
                                            placeholder="Alice Doe"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <Label>Password</Label>
                                        <Input
                                            type="password"
                                            value={newMailbox.password}
                                            onChange={(e) => setNewMailbox((f) => ({ ...f, password: e.target.value }))}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <Label>Quota (MB, 0 = unlimited)</Label>
                                        <Input
                                            type="number"
                                            min="0"
                                            value={newMailbox.quota_mb}
                                            onChange={(e) => setNewMailbox((f) => ({ ...f, quota_mb: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <div className="mail-install-actions">
                                    <Button type="submit" variant="default" size="sm" disabled={actionLoading || !newMailbox.local_part.trim() || !newMailbox.password}>
                                        Create Mailbox
                                    </Button>
                                </div>
                            </form>
                        </div>
                    )}
                    {mailboxes.length === 0 ? (
                        <div className="card-body">
                            <p className="text-muted">No mailboxes for {selectedDomain?.name} yet.</p>
                        </div>
                    ) : (
                        <table className="sk-dtable">
                            <thead>
                                <tr>
                                    <th>Address</th>
                                    <th>Quota</th>
                                    <th>Sync</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {mailboxes.map((m) => (
                                    <tr key={m.id}>
                                        <td className="sk-cell-name">
                                            <span className="mail-fav mail-fav--cyan"><AtSign size={14} /></span>
                                            <span className="sk-cell-mono">{m.address || `${m.local_part}@${selectedDomain?.name || ''}`}</span>
                                        </td>
                                        <td className="sk-cell-mono">{m.quota_mb ? `${m.quota_mb} MB` : 'unlimited'}</td>
                                        <td>
                                            {m.sync_state === 'error'
                                                ? <Pill kind="amber" title={m.sync_error || 'Out of sync with the engine'}>drift</Pill>
                                                : <Pill kind={m.sync_state === 'synced' ? 'green' : 'gray'}>{m.sync_state || 'pending'}</Pill>}
                                        </td>
                                        <td>
                                            <Pill kind={m.is_active ? 'green' : 'gray'}>{m.is_active ? 'active' : 'disabled'}</Pill>
                                        </td>
                                        <td>
                                            <div className="mail-row-actions">
                                                <Button variant="secondary" size="sm" onClick={() => handleToggleMailbox(m)}>
                                                    {m.is_active ? 'Disable' : 'Enable'}
                                                </Button>
                                                <Button variant="secondary" size="sm" onClick={() => { setPasswordModal({ id: m.id, address: m.address || m.local_part }); setNewPassword(''); }}>
                                                    Password
                                                </Button>
                                                <Button variant="secondary" size="sm" onClick={() => openAutoResponder(m)}>
                                                    Autoreply
                                                </Button>
                                                <Button variant="destructive" size="sm" onClick={() => handleDeleteMailbox(m)}>
                                                    Delete
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </>
    );

    const renderForwarders = () => (
        <>
            <div className="card">
                <div className="card-body">
                    <DomainSelector />
                </div>
            </div>
            {selectedDomainId && (
                <div className="card sec-flush">
                    <div className="card-header">
                        <h3>Forwarders {forwarders.length > 0 && <span className="sec-count">· {forwarders.length}</span>}</h3>
                        <div className="card-actions">
                            <Button variant="default" size="sm" onClick={() => setShowForwarderForm((v) => !v)}>
                                <Plus size={14} /> {showForwarderForm ? 'Cancel' : 'Add Forwarder'}
                            </Button>
                        </div>
                    </div>
                    {showForwarderForm && (
                        <div className="card-body">
                            <form className="mail-form" onSubmit={handleAddForwarder}>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <Label>Source local part</Label>
                                        <Input
                                            type="text"
                                            value={newForwarder.source_local_part}
                                            onChange={(e) => setNewForwarder((f) => ({ ...f, source_local_part: e.target.value }))}
                                            placeholder="sales"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <Label>Destination</Label>
                                        <Input
                                            type="text"
                                            value={newForwarder.destination}
                                            onChange={(e) => setNewForwarder((f) => ({ ...f, destination: e.target.value }))}
                                            placeholder="team@external.com"
                                        />
                                    </div>
                                </div>
                                <label className="mail-check-label">
                                    <input
                                        type="checkbox"
                                        checked={newForwarder.keep_copy}
                                        onChange={(e) => setNewForwarder((f) => ({ ...f, keep_copy: e.target.checked }))}
                                    />
                                    {' '}Keep a copy in the local mailbox
                                </label>
                                <div className="mail-install-actions">
                                    <Button type="submit" variant="default" size="sm" disabled={actionLoading || !newForwarder.source_local_part.trim() || !newForwarder.destination.trim()}>
                                        Add Forwarder
                                    </Button>
                                </div>
                            </form>
                        </div>
                    )}
                    {forwarders.length === 0 ? (
                        <div className="card-body">
                            <p className="text-muted">No forwarders for {selectedDomain?.name} yet.</p>
                        </div>
                    ) : (
                        <table className="sk-dtable">
                            <thead>
                                <tr>
                                    <th>Source</th>
                                    <th />
                                    <th>Destination</th>
                                    <th>Copy</th>
                                    <th>Sync</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {forwarders.map((f) => (
                                    <tr key={f.id}>
                                        <td className="sk-cell-mono">{f.source || `${f.source_local_part}@${selectedDomain?.name || ''}`}</td>
                                        <td className="mail-arrow"><Forward size={14} /></td>
                                        <td className="sk-cell-mono">{f.destination}</td>
                                        <td><Pill kind={f.keep_copy ? 'cyan' : 'gray'}>{f.keep_copy ? 'keeps copy' : 'no copy'}</Pill></td>
                                        <td>
                                            {f.sync_state === 'error'
                                                ? <Pill kind="amber" title={f.sync_error || 'Out of sync with the engine'}>drift</Pill>
                                                : <Pill kind={f.sync_state === 'synced' ? 'green' : 'gray'}>{f.sync_state || 'pending'}</Pill>}
                                        </td>
                                        <td>
                                            <div className="mail-row-actions">
                                                <Button variant="destructive" size="sm" onClick={() => handleDeleteForwarder(f)}>
                                                    Delete
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </>
    );

    const renderDns = () => {
        const records = dnsInfo?.records || [];
        return (
            <>
                <div className="card">
                    <div className="card-body">
                        <DomainSelector />
                    </div>
                </div>
                {selectedDomainId && (
                    <div className="card sec-flush">
                        <div className="card-header">
                            <h3>DNS &amp; DKIM {selectedDomain ? `· ${selectedDomain.name}` : ''}</h3>
                            <div className="card-actions">
                                <Button variant="secondary" size="sm" onClick={handleGenerateDkim} disabled={actionLoading}>
                                    <KeyRound size={14} /> Generate DKIM
                                </Button>
                                <Button variant="default" size="sm" onClick={handleDeployDns} disabled={actionLoading}>
                                    Push to provider
                                </Button>
                                <Button variant="secondary" size="sm" onClick={handleRequestCert} disabled={actionLoading}>
                                    Request cert
                                </Button>
                            </div>
                        </div>
                        <div className="card-body">
                            <div className="sk-info-row">
                                <span className="k">Deploy status</span>
                                {dnsInfo?.deployed
                                    ? <Pill kind="green">deployed</Pill>
                                    : <Pill kind="amber">{dnsInfo?.manual ? 'manual publish needed' : 'not deployed'}</Pill>}
                            </div>
                            {dnsInfo?.provider && (
                                <div className="sk-info-row">
                                    <span className="k">Provider</span>
                                    <span className="v">{dnsInfo.provider}</span>
                                </div>
                            )}
                            <p className="text-muted mail-dns-hint">
                                Publish these records at your DNS provider (or push them automatically if a
                                provider is connected). MX + SPF + DKIM + DMARC are what receivers check to
                                trust your mail.
                            </p>
                        </div>
                        {records.length === 0 ? (
                            <div className="card-body">
                                <p className="text-muted">
                                    No records yet. Generate a DKIM key to produce the full record set for {selectedDomain?.name}.
                                </p>
                            </div>
                        ) : (
                            <table className="sk-dtable">
                                <thead>
                                    <tr>
                                        <th>Type</th>
                                        <th>Name</th>
                                        <th>Value</th>
                                        <th>State</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {records.map((r, i) => {
                                        const value = r.priority != null ? `${r.priority} ${r.value}` : r.value;
                                        return (
                                            <tr key={`${r.type}-${r.name}-${i}`}>
                                                <td><span className="sk-tag">{r.type}</span></td>
                                                <td className="sk-cell-mono">{r.name}</td>
                                                <td className="sk-cell-mono mail-dns-value">{value}</td>
                                                <td>
                                                    {(r.deployed ?? r.status === 'deployed')
                                                        ? <Pill kind="green">set</Pill>
                                                        : <Pill kind="gray">pending</Pill>}
                                                </td>
                                                <td>
                                                    <Button variant="secondary" size="sm" onClick={() => copyValue(value)}>
                                                        <Copy size={14} /> Copy
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </>
        );
    };

    const renderQueue = () => (
        <div className="card sec-flush">
            <div className="card-header">
                <h3>Outbound Queue {queue.messages.length > 0 && <span className="sec-count">· {queue.messages.length}</span>}</h3>
                <div className="card-actions">
                    <Button variant="secondary" size="sm" onClick={loadQueue} disabled={actionLoading}>
                        <RefreshCw size={14} /> Refresh
                    </Button>
                    <Button variant="default" size="sm" onClick={handleFlushQueue} disabled={actionLoading}>
                        <Send size={14} /> Flush queue
                    </Button>
                </div>
            </div>
            {queue.messages.length === 0 ? (
                <div className="card-body">
                    <EmptyState
                        icon={Inbox}
                        title="Queue is empty"
                        description={queue.note || 'No messages are waiting to be delivered.'}
                    />
                </div>
            ) : (
                <table className="sk-dtable">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>From</th>
                            <th>Recipients</th>
                            <th>Status</th>
                            <th>Queued</th>
                        </tr>
                    </thead>
                    <tbody>
                        {queue.messages.map((m, i) => (
                            <tr key={m.id ?? m.queue_id ?? i}>
                                <td className="sk-cell-mono">{m.id ?? m.queue_id ?? '—'}</td>
                                <td className="sk-cell-mono">{m.from || m.sender || '—'}</td>
                                <td className="sk-cell-mono">
                                    {Array.isArray(m.recipients) ? m.recipients.join(', ') : (m.to || m.recipients || '—')}
                                </td>
                                <td>{m.status || m.state || '—'}</td>
                                <td className="sk-cell-mono">{m.created || m.arrival_time || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );

    // ── Page shell ──

    if (loading) {
        return (
            <div className="page-container mail-page">
                <PageTopbar icon={<Mail size={18} />} title="Mail Server" />
                <EmptyState loading title="Loading mail server status..." />
            </div>
        );
    }

    return (
        <div className="page-container mail-page">
            <PageTopbar
                icon={<Mail size={18} />}
                title="Mail Server"
                meta={<>Stalwart · SMTP · IMAP · DKIM</>}
                tabs={topbarTabs}
                actions={
                    <Button variant="outline" size="sm" onClick={loadStatus}>
                        <RefreshCw size={14} /> Refresh
                    </Button>
                }
            />

            {activeTab === 'overview' && renderOverview()}
            {activeTab === 'domains' && renderDomains()}
            {activeTab === 'mailboxes' && renderMailboxes()}
            {activeTab === 'forwarders' && renderForwarders()}
            {activeTab === 'dns' && renderDns()}
            {activeTab === 'queue' && renderQueue()}

            {/* ── Catch-all modal ── */}
            <Modal open={!!catchAllModal} onClose={() => setCatchAllModal(null)} title={`Catch-all · ${catchAllModal?.name || ''}`}>
                <div className="form-group">
                    <Label>Catch-all target</Label>
                    <Input
                        type="text"
                        value={catchAllModal?.value || ''}
                        onChange={(e) => setCatchAllModal((m) => ({ ...m, value: e.target.value }))}
                        placeholder="postmaster@example.com"
                    />
                    <p className="text-muted">Leave empty to disable catch-all delivery for this domain.</p>
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setCatchAllModal(null)}>Cancel</Button>
                    <Button variant="default" onClick={handleSaveCatchAll} disabled={actionLoading}>Save</Button>
                </div>
            </Modal>

            {/* ── Password modal ── */}
            <Modal open={!!passwordModal} onClose={() => setPasswordModal(null)} title={`Change password · ${passwordModal?.address || ''}`}>
                <div className="form-group">
                    <Label>New password</Label>
                    <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setPasswordModal(null)}>Cancel</Button>
                    <Button variant="default" onClick={handleChangePassword} disabled={actionLoading || !newPassword}>Change</Button>
                </div>
            </Modal>

            {/* ── Autoresponder modal ── */}
            <Modal open={!!autoModal} onClose={() => setAutoModal(null)} title={`Autoresponder · ${autoModal?.address || ''}`}>
                <label className="mail-check-label">
                    <input
                        type="checkbox"
                        checked={autoResponder.enabled}
                        onChange={(e) => setAutoResponder((a) => ({ ...a, enabled: e.target.checked }))}
                    />
                    {' '}Enabled
                </label>
                <div className="form-group">
                    <Label>Subject</Label>
                    <Input
                        type="text"
                        value={autoResponder.subject}
                        onChange={(e) => setAutoResponder((a) => ({ ...a, subject: e.target.value }))}
                        placeholder="Out of office"
                    />
                </div>
                <div className="form-group">
                    <Label>Body</Label>
                    <textarea
                        className="mail-textarea"
                        rows={5}
                        value={autoResponder.body}
                        onChange={(e) => setAutoResponder((a) => ({ ...a, body: e.target.value }))}
                        placeholder="I'm away until..."
                    />
                </div>
                <div className="form-grid">
                    <div className="form-group">
                        <Label>Start (optional)</Label>
                        <Input
                            type="datetime-local"
                            value={autoResponder.start_at || ''}
                            onChange={(e) => setAutoResponder((a) => ({ ...a, start_at: e.target.value }))}
                        />
                    </div>
                    <div className="form-group">
                        <Label>End (optional)</Label>
                        <Input
                            type="datetime-local"
                            value={autoResponder.end_at || ''}
                            onChange={(e) => setAutoResponder((a) => ({ ...a, end_at: e.target.value }))}
                        />
                    </div>
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setAutoModal(null)}>Cancel</Button>
                    <Button variant="default" onClick={handleSaveAutoResponder} disabled={actionLoading}>Save</Button>
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

export default MailPage;
