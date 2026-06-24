import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import MetricsGraph from '../components/MetricsGraph';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DangerZone } from '../components/DangerZone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Pill, Gauge } from '../components/ds';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import PackagesTab from '../components/serverdetail/PackagesTab';
import ServicesTab from '../components/serverdetail/ServicesTab';
import SystemStatusCard from '../components/serverdetail/SystemStatusCard';
import OnboardingWizard from '../components/server/OnboardingWizard';
import ProxyStackPanel from '../components/proxy/ProxyStackPanel';
import RemoteAccess from '../pages/RemoteAccess';
import TagsPanel from '../components/shared/TagsPanel';
import EmptyState from '../components/EmptyState';
import { formatBytes } from '@/utils/formatBytes';
import { BellRing, Boxes, Container, Clock3, Cloud } from 'lucide-react';

// Server status → ds Pill tone (shared by the header pill and the
// Overview "Status" row).
const STATUS_PILL_KIND = {
    online: 'green',
    offline: 'red',
    connecting: 'amber',
    pending: 'gray',
};

const ServerDetail = () => {
    const { id, tab } = useParams();
    const navigate = useNavigate();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const [server, setServer] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [systemInfo, setSystemInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showTokenModal, setShowTokenModal] = useState(false);
    const [securityAlerts, setSecurityAlerts] = useState([]);
    const toast = useToast();

    const validTabs = ['overview', 'docker', 'proxy', 'cron', 'cloudflared', 'packages', 'services', 'metrics', 'alerts', 'remote-access', 'settings'];
    const activeTab = validTabs.includes(tab) ? tab : 'overview';

    const loadServer = useCallback(async () => {
        try {
            const data = await api.getServer(id);
            setServer(data);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    const loadMetrics = useCallback(async () => {
        if (!server || server.status !== 'online') return;
        try {
            const data = await api.getRemoteSystemMetrics(id);
            // Endpoint returns the metrics payload directly, not a {success,data} envelope.
            if (data) setMetrics(data);
        } catch (err) {
            console.error('Failed to load metrics:', err);
        }
    }, [id, server]);

    const loadSystemInfo = useCallback(async () => {
        if (!server || server.status !== 'online') return;
        try {
            const data = await api.getRemoteSystemInfo(id);
            if (data) setSystemInfo(data);
        } catch (err) {
            console.error('Failed to load system info:', err);
        }
    }, [id, server]);

    useEffect(() => {
        loadServer();
    }, [loadServer]);

    const loadSecurityAlerts = useCallback(async () => {
        try {
            const data = await api.getServerSecurityAlerts(id, { status: 'open', limit: 25 });
            setSecurityAlerts(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load security alerts:', err);
        }
    }, [id]);

    useEffect(() => {
        loadSecurityAlerts();
    }, [loadSecurityAlerts]);

    async function handleAcknowledgeAlert(alertId) {
        try {
            await api.acknowledgeAlert(alertId);
            setSecurityAlerts(prev => prev.map(a =>
                a.id === alertId ? { ...a, status: 'acknowledged' } : a
            ));
        } catch {
            toast.error('Failed to acknowledge alert');
        }
    }

    async function handleResolveAlert(alertId) {
        try {
            await api.resolveAlert(alertId);
            setSecurityAlerts(prev => prev.filter(a => a.id !== alertId));
        } catch {
            toast.error('Failed to resolve alert');
        }
    }

    useEffect(() => {
        if (server?.status === 'online') {
            loadMetrics();
            loadSystemInfo();
            const interval = setInterval(loadMetrics, 10000);
            return () => clearInterval(interval);
        }
    }, [server, loadMetrics, loadSystemInfo]);

    async function handleDeleteServer() {
        const confirmed = await confirm({ title: 'Remove Server', message: 'Are you sure you want to remove this server? This action cannot be undone.' });
        if (!confirmed) return;

        try {
            await api.deleteServer(id);
            toast.success('Server removed successfully');
            navigate('/servers');
        } catch (err) {
            toast.error(err.message || 'Failed to remove server');
        }
    }

    async function handlePingServer() {
        try {
            const result = await api.pingServer(id);
            if (result.success) {
                toast.success(`Server responded in ${result.latency}ms`);
                loadServer();
            } else {
                toast.error('Server did not respond');
            }
        } catch (err) {
            toast.error('Failed to ping server');
        }
    }

    // Both the inline "Generate Token" header button and the SettingsTab
    // regenerate button funnel through the same modal — the modal owns the
    // expiry picker and the connection-string display, so the header path
    // doesn't need its own confirm dialog. Reaching the modal effectively
    // *is* the confirmation: the actual token mint happens when the user
    // clicks "Generate" inside it.
    async function handleOpenTokenModal() {
        setShowTokenModal(true);
    }

    function handleTokenGenerated(result) {
        // Mirror the new token onto the in-memory server so the existing
        // AgentRegistrationSection (rendered in SettingsTab) reflects it
        // without a full reload.
        setServer(prev => ({
            ...prev,
            registration_token: result.registration_token,
            registration_expires: result.registration_expires,
            connection_string: result.connection_string,
        }));
    }

    if (loading) {
        return <EmptyState loading title="Loading server details" />;
    }

    if (error) {
        return (
            <div className="error-page">
                <h2>Error Loading Server</h2>
                <p>{error}</p>
                <Button asChild><Link to="/servers">Back to Servers</Link></Button>
            </div>
        );
    }

    if (!server) {
        return (
            <div className="error-page">
                <h2>Server Not Found</h2>
                <p>The requested server could not be found.</p>
                <Button asChild><Link to="/servers">Back to Servers</Link></Button>
            </div>
        );
    }

    // Aggregate any "you should know about this" alerts into a single
    // Alerts tab. Today only the polling-transport fallback shows up as
    // a system notification, but this is the place to add future
    // advisories (stale agent, missing capabilities, expiring tokens,
    // etc.). Security alerts (raised by the security service) are
    // surfaced alongside them so there's only one place to look.
    const systemNotifications = [];
    if (server.transport === 'poll') {
        systemNotifications.push({
            id: 'limited-mode',
            severity: 'warning',
            title: 'Limited mode',
            message:
                'This agent connected via the REST polling fallback because the WebSocket link could not be established cleanly. Heartbeats and one-shot commands work; live logs, real-time metrics, and terminal sessions are unavailable until the WS link is restored.',
        });
    }
    const openSecurityAlerts = securityAlerts.filter(a => a.status === 'open');
    const totalAlertCount = systemNotifications.length + openSecurityAlerts.length;

    // Show the cron tab only when the agent reported the capability.
    // Older agents (pre-1.6.16) and Windows hosts won't have it set —
    // hiding the tab matches the rest of the panel's "don't expose what
    // the host can't do" behaviour.
    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'docker', label: 'Docker' },
        { id: 'proxy', label: 'Proxy' },
        ...(server.capabilities?.cron ? [{ id: 'cron', label: 'Cron' }] : []),
        ...(server.capabilities?.cloudflared ? [{ id: 'cloudflared', label: 'Tunnels' }] : []),
        ...(server.capabilities?.packages ? [{ id: 'packages', label: 'Packages' }] : []),
        ...(server.capabilities?.systemd ? [{ id: 'services', label: 'Services' }] : []),
        { id: 'metrics', label: 'Metrics' },
        ...(totalAlertCount > 0
            ? [{ id: 'alerts', label: 'Alerts', badge: totalAlertCount }]
            : [{ id: 'alerts', label: 'Alerts' }]),
        ...(server.capabilities?.wireguard ? [{ id: 'remote-access', label: 'Remote Access' }] : []),
        { id: 'settings', label: 'Settings' }
    ];

    return (
        <div className="page-container server-detail-page">
            <div className="page-breadcrumb">
                <Link to="/servers">Servers</Link>
                <span className="breadcrumb-separator">/</span>
                <span>{server.name}</span>
            </div>

            <header className="server-detail-header">
                <div className="server-detail-header__main">
                    <div className={`server-detail-header__avatar server-detail-header__avatar--${server.status || 'pending'}`}>
                        {(server.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="server-detail-header__identity">
                        <div className="server-detail-header__title-row">
                            <h1>{server.name}</h1>
                            <Pill kind={STATUS_PILL_KIND[server.status] || 'gray'}>
                                {server.status || 'pending'}
                            </Pill>
                            <CopyChip
                                label="id"
                                value={server.id}
                                title="Copy server ID"
                                mono
                            />
                        </div>
                        <div className="server-detail-header__meta">
                            <span className="server-detail-header__meta-item">
                                {server.hostname || server.ip_address || 'No endpoint configured'}
                            </span>
                            {server.group_name && (
                                <>
                                    <span className="dotsep">·</span>
                                    <span className="server-detail-header__meta-item"><FolderTinyIcon /> {server.group_name}</span>
                                </>
                            )}
                            {server.os_type && (
                                <>
                                    <span className="dotsep">·</span>
                                    <span className="server-detail-header__meta-item">{server.os_type}</span>
                                </>
                            )}
                            {server.agent_version && (
                                <>
                                    <span className="dotsep">·</span>
                                    <span className="server-detail-header__meta-item">agent {server.agent_version}</span>
                                </>
                            )}
                            {server.last_seen && (
                                <>
                                    <span className="dotsep">·</span>
                                    <span className="server-detail-header__meta-item">
                                        last seen {new Date(server.last_seen).toLocaleString()}
                                    </span>
                                </>
                            )}
                        </div>
                        {server.description && (
                            <p className="server-detail-header__description">{server.description}</p>
                        )}
                    </div>
                </div>
                <div className="server-detail-header__actions">
                    <Button variant="outline" size="sm" onClick={handlePingServer}>
                        <RefreshIcon /> Ping
                    </Button>
                </div>
            </header>

            <Tabs
                value={activeTab}
                onValueChange={(value) =>
                    navigate(value === 'overview' ? `/servers/${id}` : `/servers/${id}/${value}`, { replace: true })
                }
            >
                <TabsList>
                    {tabs.map(t => (
                        <TabsTrigger key={t.id} value={t.id}>
                            {t.label}
                            {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <div className="server-detail-content">
                    <TabsContent value="overview">
                        <OverviewTab
                            server={server}
                            metrics={metrics}
                            systemInfo={systemInfo}
                            onRefreshServer={loadServer}
                        />
                    </TabsContent>
                    <TabsContent value="docker">
                        <DockerTab serverId={id} serverStatus={server.status} server={server} />
                    </TabsContent>
                    <TabsContent value="proxy">
                        <ProxyStackPanel serverId={id} />
                    </TabsContent>
                    {server.capabilities?.cron && (
                        <TabsContent value="cron">
                            <CronTab serverId={id} serverStatus={server.status} />
                        </TabsContent>
                    )}
                    {server.capabilities?.cloudflared && (
                        <TabsContent value="cloudflared">
                            <CloudflaredTab serverId={id} serverStatus={server.status} />
                        </TabsContent>
                    )}
                    {server.capabilities?.packages && (
                        <TabsContent value="packages">
                            <PackagesTab serverId={id} serverStatus={server.status} />
                        </TabsContent>
                    )}
                    {server.capabilities?.systemd && (
                        <TabsContent value="services">
                            <ServicesTab serverId={id} serverStatus={server.status} />
                        </TabsContent>
                    )}
                    <TabsContent value="metrics">
                        <MetricsTab serverId={id} metrics={metrics} />
                    </TabsContent>
                    <TabsContent value="alerts">
                        <AlertsTab
                            notifications={systemNotifications}
                            securityAlerts={securityAlerts}
                            onAcknowledge={handleAcknowledgeAlert}
                            onResolve={handleResolveAlert}
                        />
                    </TabsContent>
                    <TabsContent value="remote-access">
                        <RemoteAccess serverId={id} />
                    </TabsContent>
                    <TabsContent value="settings">
                        <SettingsTab
                            server={server}
                            onUpdate={loadServer}
                            onRegenerateToken={handleOpenTokenModal}
                            onDelete={handleDeleteServer}
                        />
                    </TabsContent>
                </div>
            </Tabs>

            {showTokenModal && server && (
                <TokenModal
                    server={server}
                    onClose={() => setShowTokenModal(false)}
                    onGenerated={handleTokenGenerated}
                />
            )}
            <ConfirmDialog
                isOpen={confirmState.isOpen}
                title={confirmState.title}
                message={confirmState.message}
                confirmText={confirmState.confirmText}
                cancelText={confirmState.cancelText}
                variant={confirmState.variant}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </div>
    );
};

const OverviewTab = ({ server, metrics, systemInfo, onRefreshServer }) => {
    const formatUptime = (seconds) => {
        if (!seconds) return 'N/A';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        if (days > 0) return `${days}d ${hours}h`;
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    };

    const isOnline = server.status === 'online';
    const cpuCores = systemInfo?.cpu_cores || server.cpu_cores;
    const cpuModel = systemInfo?.cpu_model || server.cpu_model;
    const totalMemory = systemInfo?.total_memory || server.total_memory;
    const totalDisk = systemInfo?.total_disk || server.total_disk;
    const osLabel = `${systemInfo?.os || server.os_type || 'Unknown'}${systemInfo?.os_version || server.os_version ? ` ${systemInfo?.os_version || server.os_version}` : ''}`;

    // Surface the onboarding wizard while a server is still being
    // provisioned. Hidden once onboarding reaches 'ready' (or was never
    // started) so it doesn't clutter a healthy server's overview.
    const showOnboarding =
        server.onboarding_state &&
        !['ready', 'pending'].includes(server.onboarding_state);

    return (
        <div className="overview-tab">
            {showOnboarding && (
                <div className="overview-tab__onboarding">
                    <OnboardingWizard
                        serverId={server.id}
                        initialState={server.onboarding_state}
                        onStateChange={(newState) => {
                            // Refresh the parent server payload when onboarding
                            // reaches a terminal state so the card hides itself.
                            if (newState === 'ready' || newState === 'failed') {
                                onRefreshServer?.();
                            }
                        }}
                    />
                </div>
            )}
            <div className="server-stats-strip">
                <KpiTile
                    icon={<PulseIcon />}
                    label="Status"
                    value={server.status || 'pending'}
                    tone={isOnline ? 'success' : server.status === 'connecting' ? 'warning' : 'danger'}
                />
                <KpiTile
                    icon={<ClockIcon />}
                    label="Uptime"
                    value={isOnline ? formatUptime(metrics?.uptime) : '—'}
                    sub={isOnline && metrics?.uptime ? 'since last boot' : null}
                />
                <KpiGauge
                    icon={<CpuIcon />}
                    label="CPU"
                    percent={isOnline ? metrics?.cpu_percent : null}
                    color="var(--accent-bright)"
                    sub={cpuCores ? `${cpuCores} cores` : null}
                />
                <KpiGauge
                    icon={<MemoryIcon />}
                    label="Memory"
                    percent={isOnline ? metrics?.memory_percent : null}
                    color="var(--cyan)"
                    sub={totalMemory ? formatBytes(totalMemory) : null}
                />
                <KpiGauge
                    icon={<DiskIcon />}
                    label="Disk"
                    percent={isOnline ? metrics?.disk_percent : null}
                    color="var(--green)"
                    sub={totalDisk ? formatBytes(totalDisk) : null}
                />
            </div>

            {!isOnline && (
                <div className="info-card offline-card">
                    <div className="offline-message">
                        <OfflineIcon />
                        <h4>Server Offline</h4>
                        <p>
                            {server.status === 'pending'
                                ? 'Waiting for agent installation...'
                                : 'Unable to connect to the server agent.'}
                        </p>
                    </div>
                </div>
            )}

            <div className="overview-grid">
                <div className="info-card">
                    <h3><ServerIcon /> Server Information</h3>
                    <ul className="info-rows">
                        <InfoRow icon={<PulseIcon />} label="Status">
                            <Pill kind={STATUS_PILL_KIND[server.status] || 'gray'}>{server.status}</Pill>
                        </InfoRow>
                        <InfoRow icon={<HostIcon />} label="Hostname" value={server.hostname || 'N/A'} mono />
                        <InfoRow icon={<NetworkIcon />} label="IP Address" value={server.ip_address || 'N/A'} mono />
                        <InfoRow icon={<FolderTinyIcon />} label="Group" value={server.group_name || 'Ungrouped'} />
                        <InfoRow
                            icon={<ClockIcon />}
                            label="Last Seen"
                            value={server.last_seen ? new Date(server.last_seen).toLocaleString() : 'Never'}
                        />
                    </ul>
                </div>

                <div className="info-card">
                    <h3><ChipIcon /> System Information</h3>
                    <ul className="info-rows">
                        <InfoRow icon={<OsIcon />} label="Operating System" value={osLabel} />
                        <InfoRow icon={<ArchIcon />} label="Architecture" value={systemInfo?.architecture || server.architecture || 'N/A'} mono />
                        <InfoRow
                            icon={<CpuIcon />}
                            label="CPU"
                            value={
                                (cpuModel || 'N/A') + (cpuCores ? ` (${cpuCores} cores)` : '')
                            }
                        />
                        <InfoRow icon={<MemoryIcon />} label="Total Memory" value={formatBytes(totalMemory, { defaultValue: 'N/A' })} mono />
                        <InfoRow icon={<DiskIcon />} label="Total Disk" value={formatBytes(totalDisk, { defaultValue: 'N/A' })} mono />
                    </ul>
                </div>

                <div className="info-card overview-grid__full">
                    <h3><AgentIcon /> Agent Information</h3>
                    <ul className="info-rows info-rows--columns">
                        <InfoRow icon={<TagIcon />} label="Agent Version" value={server.agent_version || 'Not installed'} mono />
                        <InfoRow icon={<HashIcon />} label="Agent ID" value={server.agent_id || 'N/A'} mono />
                        <InfoRow icon={<DockerMiniIcon />} label="Docker Version" value={server.docker_version || systemInfo?.docker_version || 'N/A'} mono />
                        <InfoRow icon={<ClockIcon />} label="Uptime" value={formatUptime(metrics?.uptime)} mono />
                    </ul>
                </div>

                <div className="overview-grid__full">
                    <SystemStatusCard server={server} onRefresh={onRefreshServer} />
                </div>
            </div>
        </div>
    );
};

const AlertsTab = ({ notifications, securityAlerts, onAcknowledge, onResolve }) => {
    const sysItems = notifications || [];
    const secItems = securityAlerts || [];
    const openSec = secItems.filter(a => a.status === 'open');
    const ackSec = secItems.filter(a => a.status === 'acknowledged');

    if (sysItems.length === 0 && secItems.length === 0) {
        return (
            <div className="alerts-tab">
                <EmptyState
                    icon={BellRing}
                    title="All clear"
                    description="No active alerts for this server."
                />
            </div>
        );
    }

    return (
        <div className="alerts-tab">
            {sysItems.length > 0 && (
                <section className="alerts-section">
                    <header className="alerts-section__header">
                        <h3>System</h3>
                        <span className="alerts-section__count">{sysItems.length}</span>
                    </header>
                    <ul className="notifications-list">
                        {sysItems.map((n) => (
                            <li key={n.id} className={`notification notification--${n.severity || 'info'}`}>
                                <span className="notification__icon">
                                    {n.severity === 'warning' || n.severity === 'danger' ? <AlertIcon /> : <InfoCircleIcon />}
                                </span>
                                <div className="notification__body">
                                    <div className="notification__title">{n.title}</div>
                                    <p className="notification__message">{n.message}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {openSec.length > 0 && (
                <section className="alerts-section">
                    <header className="alerts-section__header">
                        <h3>Security</h3>
                        <span className="alerts-section__count">{openSec.length} open</span>
                    </header>
                    <ul className="notifications-list">
                        {openSec.map(a => (
                            <SecurityAlertItem
                                key={a.id}
                                alert={a}
                                onAcknowledge={onAcknowledge}
                                onResolve={onResolve}
                            />
                        ))}
                    </ul>
                </section>
            )}

            {ackSec.length > 0 && (
                <section className="alerts-section alerts-section--muted">
                    <header className="alerts-section__header">
                        <h3>Acknowledged</h3>
                        <span className="alerts-section__count">{ackSec.length}</span>
                    </header>
                    <ul className="notifications-list">
                        {ackSec.map(a => (
                            <SecurityAlertItem
                                key={a.id}
                                alert={a}
                                onAcknowledge={onAcknowledge}
                                onResolve={onResolve}
                            />
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
};

const SecurityAlertItem = ({ alert, onAcknowledge, onResolve }) => {
    const sev = (alert.severity || 'info').toLowerCase();
    const tone =
        sev === 'critical' || sev === 'high' ? 'danger' :
        sev === 'medium' || sev === 'warning' ? 'warning' : 'info';
    const title = (alert.alert_type || 'alert').replace(/_/g, ' ');
    return (
        <li className={`notification notification--${tone}`}>
            <span className="notification__icon">
                {tone === 'info' ? <InfoCircleIcon /> : <AlertIcon />}
            </span>
            <div className="notification__body">
                <div className="notification__head">
                    <span className="notification__title">{title}</span>
                    <span className={`severity-badge ${sev}`}>{sev}</span>
                    <span className="notification__time">
                        {alert.created_at ? new Date(alert.created_at).toLocaleString() : ''}
                    </span>
                </div>
                <p className="notification__message">
                    {alert.source_ip && <><strong>IP:</strong> {alert.source_ip}{'  '}</>}
                    {alert.details?.message || ''}
                    {alert.details?.attempts ? ` (${alert.details.attempts} attempts)` : ''}
                </p>
                <div className="notification__actions">
                    {alert.status === 'open' && (
                        <Button variant="outline" size="sm" onClick={() => onAcknowledge(alert.id)}>
                            Acknowledge
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => onResolve(alert.id)}>
                        Resolve
                    </Button>
                </div>
            </div>
        </li>
    );
};

const InfoRow = ({ icon, label, value, mono, children }) => (
    <li className="info-row">
        <span className="info-row__icon">{icon}</span>
        <span className="info-row__label">{label}</span>
        <span className={`info-row__value${mono ? ' mono' : ''}`}>
            {children ?? value}
        </span>
    </li>
);

const KpiTile = ({ icon, label, value, sub, tone }) => (
    <div className={`kpi-tile${tone ? ` kpi-tile--${tone}` : ''}`}>
        <div className="kpi-tile__head">
            <span className="kpi-tile__icon">{icon}</span>
            <span className="kpi-tile__label">{label}</span>
        </div>
        <div className="kpi-tile__value">{value}</div>
        {sub && <div className="kpi-tile__sub">{sub}</div>}
    </div>
);

const KpiGauge = ({ icon, label, percent, color, sub }) => {
    const has = percent !== null && percent !== undefined && Number.isFinite(percent);
    const safe = has ? Math.min(Math.max(percent, 0), 100) : 0;
    const danger = safe > 85;
    const warn = safe > 70 && !danger;
    const fillColor = danger ? 'var(--red)' : warn ? 'var(--amber)' : color;

    return (
        <div className={`kpi-tile kpi-tile--gauge${danger ? ' kpi-tile--danger' : warn ? ' kpi-tile--warn' : ''}`}>
            <div className="kpi-tile__head">
                <span className="kpi-tile__icon">{icon}</span>
                <span className="kpi-tile__label">{label}</span>
            </div>
            <div className="kpi-tile__value">{has ? `${safe.toFixed(1)}%` : '—'}</div>
            <Gauge className="kpi-tile__meter" value={safe} color={fillColor} />
            {sub && <div className="kpi-tile__sub">{sub}</div>}
        </div>
    );
};

// The /servers/<id>/docker/* endpoints return raw arrays from Flask
// (route extracts result.get('data') before jsonify). The agent envelope's
// {success, data} shape is gone by the time it reaches the client, so unwrap
// both forms defensively.
const unwrapList = (response) => {
    if (Array.isArray(response)) return response;
    if (response?.success && Array.isArray(response.data)) return response.data;
    return [];
};

// Docker exposes container ports as an array of {ip, private_port,
// public_port, type} objects. Render a compact "host:container/proto"
// string per binding, or fall back to "container/proto" when the port
// isn't mapped to the host. Older agents may already send a string.
const formatPorts = (ports) => {
    if (!ports) return '-';
    if (typeof ports === 'string') return ports || '-';
    if (!Array.isArray(ports) || ports.length === 0) return '-';
    const parts = ports.map((p) => {
        if (!p || typeof p !== 'object') return String(p);
        const proto = p.type || 'tcp';
        if (p.public_port) {
            const host = p.ip && p.ip !== '0.0.0.0' && p.ip !== '::' ? `${p.ip}:` : '';
            return `${host}${p.public_port}->${p.private_port}/${proto}`;
        }
        return `${p.private_port}/${proto}`;
    });
    return parts.join(', ');
};

const DockerTab = ({ serverId, serverStatus, server }) => {
    const [containers, setContainers] = useState([]);
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [subTab, setSubTab] = useState('containers');
    const toast = useToast();
    const { confirm: confirmDocker, confirmState: confirmDockerState, handleConfirm: handleDockerConfirm, handleCancel: handleDockerCancel } = useConfirm();

    useEffect(() => {
        if (serverStatus === 'online') {
            loadDockerData();
        } else {
            setLoading(false);
        }
    }, [serverId, serverStatus]);

    async function loadDockerData() {
        setLoading(true);
        setLoadError(null);
        try {
            const [containersRes, imagesRes] = await Promise.all([
                api.getRemoteContainers(serverId, true),
                api.getRemoteImages(serverId)
            ]);

            setContainers(unwrapList(containersRes));
            setImages(unwrapList(imagesRes));
        } catch (err) {
            console.error('Failed to load Docker data:', err);
            setLoadError(err.message || 'Failed to load Docker data');
        } finally {
            setLoading(false);
        }
    }

    // If the agent reports docker capability false (Docker daemon not
    // reachable from the agent process — common on Windows when the
    // service hasn't been started, or on hosts where the agent user
    // isn't in the docker group), explain that instead of pretending
    // there are no containers.
    const dockerCapability = server?.capabilities?.docker;
    if (serverStatus === 'online' && server && dockerCapability === false) {
        return (
            <div className="docker-empty-state">
                <EmptyState
                    icon={Container}
                    title="Docker not reachable from this agent"
                    description="The agent connected but could not talk to a Docker daemon. Make sure Docker is running on the host (and the agent user is in the docker group on Linux), then click Refresh on the Overview tab to re-probe capabilities."
                />
                <ul className="docker-empty-state__causes">
                    <li>Docker Desktop / dockerd is not running on the host</li>
                    <li>The agent user isn&apos;t in the <code>docker</code> group (Linux)</li>
                    <li>The npipe socket <code>{'//./pipe/docker_engine'}</code> isn&apos;t accessible (Windows)</li>
                </ul>
            </div>
        );
    }

    async function handleContainerAction(containerId, action) {
        try {
            let result;
            if (action === 'start') {
                result = await api.startRemoteContainer(serverId, containerId);
                toast.success('Container started');
            } else if (action === 'stop') {
                result = await api.stopRemoteContainer(serverId, containerId);
                toast.success('Container stopped');
            } else if (action === 'restart') {
                result = await api.restartRemoteContainer(serverId, containerId);
                toast.success('Container restarted');
            } else if (action === 'remove') {
                const removeConfirmed = await confirmDocker({ title: 'Remove Container', message: 'Remove this container?' });
                if (!removeConfirmed) return;
                result = await api.removeRemoteContainer(serverId, containerId, true);
                toast.success('Container removed');
            }
            loadDockerData();
        } catch (err) {
            toast.error(err.message || `Failed to ${action} container`);
        }
    }

    if (serverStatus !== 'online') {
        return (
            <div className="offline-notice">
                <OfflineIcon />
                <h4>Server Offline</h4>
                <p>Docker management requires the server to be online.</p>
            </div>
        );
    }

    if (loading) {
        return <EmptyState loading title="Loading Docker data" />;
    }

    return (
        <div className="docker-tab">
            {loadError && (
                <div className="docker-tab__error">
                    <strong>Couldn&apos;t load Docker data:</strong> {loadError}
                    <Button size="sm" variant="outline" onClick={loadDockerData}>Retry</Button>
                </div>
            )}
            <div className="docker-sub-tabs">
                <button
                    className={`sub-tab ${subTab === 'containers' ? 'active' : ''}`}
                    onClick={() => setSubTab('containers')}
                >
                    Containers ({containers.length})
                </button>
                <button
                    className={`sub-tab ${subTab === 'images' ? 'active' : ''}`}
                    onClick={() => setSubTab('images')}
                >
                    Images ({images.length})
                </button>
            </div>

            {subTab === 'containers' && (
                <div className="containers-list">
                    {containers.length === 0 ? (
                        <EmptyState icon={Container} title="No containers" description="No containers are running on this server." />
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Image</th>
                                    <th>Status</th>
                                    <th>Ports</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {containers.map(container => {
                                    const isRunning = container.state === 'running';
                                    return (
                                        <tr key={container.id}>
                                            <td>
                                                <span className="container-name">{container.name}</span>
                                                <span className="container-id">{container.id?.substring(0, 12)}</span>
                                            </td>
                                            <td>{container.image}</td>
                                            <td>
                                                <Pill kind={isRunning ? 'green' : container.state === 'paused' || container.state === 'restarting' ? 'amber' : 'gray'}>
                                                    {container.state}
                                                </Pill>
                                            </td>
                                            <td>{formatPorts(container.ports)}</td>
                                            <td className="actions-cell">
                                                {isRunning ? (
                                                    <>
                                                        <button
                                                            className="btn-icon"
                                                            onClick={() => handleContainerAction(container.id, 'restart')}
                                                            title="Restart"
                                                        >
                                                            <RefreshIcon />
                                                        </button>
                                                        <button
                                                            className="btn-icon danger"
                                                            onClick={() => handleContainerAction(container.id, 'stop')}
                                                            title="Stop"
                                                        >
                                                            <StopIcon />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            className="btn-icon success"
                                                            onClick={() => handleContainerAction(container.id, 'start')}
                                                            title="Start"
                                                        >
                                                            <PlayIcon />
                                                        </button>
                                                        <button
                                                            className="btn-icon danger"
                                                            onClick={() => handleContainerAction(container.id, 'remove')}
                                                            title="Remove"
                                                        >
                                                            <TrashIcon />
                                                        </button>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {subTab === 'images' && (
                <div className="images-list">
                    {images.length === 0 ? (
                        <EmptyState icon={Boxes} title="No images" description="No Docker images are present on this server." />
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Repository</th>
                                    <th>Tag</th>
                                    <th>Image ID</th>
                                    <th>Size</th>
                                    <th>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {images.map(image => (
                                    <tr key={image.id}>
                                        <td>{image.repository || '<none>'}</td>
                                        <td>{image.tag || '<none>'}</td>
                                        <td className="mono">{image.id?.substring(0, 12)}</td>
                                        <td>{image.size}</td>
                                        <td>{image.created}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
            <ConfirmDialog
                isOpen={confirmDockerState.isOpen}
                title={confirmDockerState.title}
                message={confirmDockerState.message}
                confirmText={confirmDockerState.confirmText}
                cancelText={confirmDockerState.cancelText}
                variant={confirmDockerState.variant}
                onConfirm={handleDockerConfirm}
                onCancel={handleDockerCancel}
            />
        </div>
    );
};

const PRESET_LABELS = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Hourly',
    '0 0 * * *': 'Daily at midnight',
    '0 12 * * *': 'Daily at noon',
    '0 0 * * 0': 'Weekly (Sunday)',
    '0 0 1 * *': 'Monthly (1st)',
};

const CronTab = ({ serverId, serverStatus }) => {
    const toast = useToast();
    const { confirm: confirmCron, confirmState: confirmCronState, handleConfirm: handleCronConfirm, handleCancel: handleCronCancel } = useConfirm();
    const [status, setStatus] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({
        name: '',
        schedule: '0 * * * *',
        command: '',
    });

    const loadJobs = useCallback(async () => {
        try {
            const data = await api.getRemoteCronJobs(serverId);
            setJobs(data?.jobs || []);
            setError(null);
        } catch (err) {
            setError(err.message || 'Failed to load cron jobs');
        }
    }, [serverId]);

    const loadStatus = useCallback(async () => {
        try {
            const s = await api.getRemoteCronStatus(serverId);
            setStatus(s);
        } catch (err) {
            // Non-critical — log but don't block the table.
            console.error('Failed to load cron status:', err);
        }
    }, [serverId]);

    useEffect(() => {
        if (serverStatus !== 'online') {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            await Promise.all([loadJobs(), loadStatus()]);
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [serverStatus, loadJobs, loadStatus]);

    async function handleToggle(job) {
        try {
            await api.toggleRemoteCronJob(serverId, job.id, !job.enabled);
            toast.success(`Job ${!job.enabled ? 'enabled' : 'disabled'}`);
            loadJobs();
        } catch (err) {
            toast.error(err.message || 'Failed to toggle job');
        }
    }

    async function handleRemove(job) {
        const ok = await confirmCron({
            title: 'Remove Cron Job',
            message: `Remove this entry from the host crontab?\n\n${job.schedule} ${job.command}`,
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.removeRemoteCronJob(serverId, job.id);
            toast.success('Cron job removed');
            loadJobs();
        } catch (err) {
            toast.error(err.message || 'Failed to remove job');
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!form.command.trim()) {
            toast.error('Command is required');
            return;
        }
        if (!form.schedule.trim()) {
            toast.error('Schedule is required');
            return;
        }
        setSubmitting(true);
        try {
            await api.addRemoteCronJob(serverId, {
                name: form.name.trim(),
                schedule: form.schedule.trim(),
                command: form.command.trim(),
            });
            toast.success('Cron job added');
            setShowAddModal(false);
            setForm({ name: '', schedule: '0 * * * *', command: '' });
            loadJobs();
        } catch (err) {
            toast.error(err.message || 'Failed to add cron job');
        } finally {
            setSubmitting(false);
        }
    }

    if (serverStatus !== 'online') {
        return (
            <div className="offline-notice">
                <OfflineIcon />
                <h4>Server Offline</h4>
                <p>Cron management requires the server to be online.</p>
            </div>
        );
    }

    if (loading) {
        return <EmptyState loading title="Loading cron jobs" />;
    }

    return (
        <div className="cron-tab">
            <div className="cron-tab__header">
                <div className="cron-tab__status">
                    {status?.available === false ? (
                        <Pill kind="amber">cron not available: {status.reason || 'unknown'}</Pill>
                    ) : status?.running === false ? (
                        <Pill kind="amber">cron daemon not running</Pill>
                    ) : (
                        <Pill kind="green">cron daemon active{status?.daemon ? ` (${status.daemon})` : ''}</Pill>
                    )}
                    <span className="cron-tab__count">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
                </div>
                <div className="cron-tab__actions">
                    <Button variant="outline" onClick={loadJobs}>Refresh</Button>
                    <Button onClick={() => setShowAddModal(true)} disabled={status?.available === false}>
                        Add Job
                    </Button>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger">{error}</div>
            )}

            {jobs.length === 0 ? (
                <EmptyState
                    icon={Clock3}
                    title="No cron jobs"
                    description="No scheduled jobs on this server. Use Add Job to schedule one."
                />
            ) : (
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Schedule</th>
                            <th>Command</th>
                            <th>Status</th>
                            <th className="actions-cell">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {jobs.map(job => (
                            <tr key={job.id} className={!job.enabled ? 'row-disabled' : ''}>
                                <td>
                                    <span className="mono" title={job.schedule}>{job.schedule}</span>
                                    {job.description && job.description !== job.schedule && (
                                        <div className="cron-tab__description">{job.description}</div>
                                    )}
                                </td>
                                <td>
                                    {job.name && <div className="cron-tab__name">{job.name}</div>}
                                    <code className="cron-tab__command">{job.command}</code>
                                </td>
                                <td>
                                    <Pill kind={job.enabled ? 'green' : 'gray'}>
                                        {job.enabled ? 'enabled' : 'disabled'}
                                    </Pill>
                                </td>
                                <td className="actions-cell">
                                    <button
                                        className="btn-icon"
                                        onClick={() => handleToggle(job)}
                                        title={job.enabled ? 'Disable' : 'Enable'}
                                    >
                                        {job.enabled ? <StopIcon /> : <PlayIcon />}
                                    </button>
                                    <button
                                        className="btn-icon danger"
                                        onClick={() => handleRemove(job)}
                                        title="Remove"
                                    >
                                        <TrashIcon />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <Dialog
                open={showAddModal}
                onOpenChange={(open) => { if (!open && !submitting) setShowAddModal(false); }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Cron Job</DialogTitle>
                        <DialogDescription>
                            Schedule a command on the host crontab. Runs as the agent user.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="cron-name">Name (optional)</Label>
                            <Input
                                id="cron-name"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="Backup database"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cron-schedule">Schedule</Label>
                            <Select
                                value={Object.keys(PRESET_LABELS).includes(form.schedule) ? form.schedule : 'custom'}
                                onValueChange={(value) => {
                                    if (value === 'custom') return;
                                    setForm({ ...form, schedule: value });
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(PRESET_LABELS).map(([cron, label]) => (
                                        <SelectItem key={cron} value={cron}>{label} — {cron}</SelectItem>
                                    ))}
                                    <SelectItem value="custom">Custom…</SelectItem>
                                </SelectContent>
                            </Select>
                            <Input
                                id="cron-schedule"
                                value={form.schedule}
                                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                                placeholder="* * * * *"
                                className="font-mono"
                            />
                            <p className="text-xs text-muted-foreground">5 fields: minute, hour, day, month, weekday.</p>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cron-command">Command</Label>
                            <Textarea
                                id="cron-command"
                                rows={3}
                                value={form.command}
                                onChange={(e) => setForm({ ...form, command: e.target.value })}
                                placeholder="/usr/local/bin/my-script.sh"
                                required
                            />
                            <p className="text-xs text-muted-foreground">Absolute path. Shell operators (;, &amp;&amp;, |, $(), &gt;, &lt;) are not allowed.</p>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} disabled={submitting}>Cancel</Button>
                            <Button type="submit" disabled={submitting}>{submitting ? 'Adding…' : 'Add Job'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                isOpen={confirmCronState.isOpen}
                title={confirmCronState.title}
                message={confirmCronState.message}
                confirmText={confirmCronState.confirmText}
                cancelText={confirmCronState.cancelText}
                variant={confirmCronState.variant}
                onConfirm={handleCronConfirm}
                onCancel={handleCronCancel}
            />
        </div>
    );
};

// CloudflaredTab — manage Cloudflare named tunnels via the agent.
//
// Auth model: the user runs `cloudflared tunnel login` once on the
// server. That writes ~/.cloudflared/cert.pem (or
// /etc/cloudflared/cert.pem when run as root). The panel never sees
// a Cloudflare API token — every action shells out to cloudflared
// using that cert. /status surfaces both "binary present" and
// "cert present" so we can show "log in first" before users hit
// CRUD actions and get confusing errors back.
const CloudflaredTab = ({ serverId, serverStatus }) => {
    const toast = useToast();
    const { confirm: confirmCf, confirmState: confirmCfState, handleConfirm: handleCfConfirm, handleCancel: handleCfCancel } = useConfirm();
    const [status, setStatus] = useState(null);
    const [tunnels, setTunnels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createName, setCreateName] = useState('');
    const [creating, setCreating] = useState(false);

    const [showRouteModal, setShowRouteModal] = useState(false);
    const [routeTunnel, setRouteTunnel] = useState(null);
    const [routeHostname, setRouteHostname] = useState('');
    const [routing, setRouting] = useState(false);

    // Login flow: { channel, authUrl, status: 'starting'|'awaiting'|'done'|'error', error, certPath }
    const [login, setLogin] = useState(null);

    const loadStatus = useCallback(async () => {
        try {
            const s = await api.getRemoteCloudflaredStatus(serverId);
            setStatus(s);
        } catch (err) {
            console.error('Failed to load cloudflared status:', err);
        }
    }, [serverId]);

    const loadTunnels = useCallback(async () => {
        try {
            const data = await api.getRemoteCloudflaredTunnels(serverId);
            setTunnels(data?.tunnels || []);
            setError(null);
        } catch (err) {
            // Auth errors here are common when the user hasn't logged
            // in yet — the status banner already explains; don't show
            // a redundant scary alert.
            setError(err.message || 'Failed to load tunnels');
        }
    }, [serverId]);

    useEffect(() => {
        if (serverStatus !== 'online') {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            await loadStatus();
            await loadTunnels();
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [serverStatus, loadStatus, loadTunnels]);

    async function handleCreate(e) {
        e.preventDefault();
        const name = createName.trim();
        if (!name) {
            toast.error('Name is required');
            return;
        }
        setCreating(true);
        try {
            await api.createRemoteCloudflaredTunnel(serverId, name);
            toast.success(`Tunnel "${name}" created`);
            setShowCreateModal(false);
            setCreateName('');
            loadTunnels();
        } catch (err) {
            toast.error(err.message || 'Failed to create tunnel');
        } finally {
            setCreating(false);
        }
    }

    async function handleRoute(e) {
        e.preventDefault();
        const hostname = routeHostname.trim();
        if (!hostname || !routeTunnel) return;
        setRouting(true);
        try {
            await api.routeRemoteCloudflaredTunnel(serverId, routeTunnel.id || routeTunnel.name, hostname);
            toast.success(`${hostname} → ${routeTunnel.name}`);
            setShowRouteModal(false);
            setRouteHostname('');
            setRouteTunnel(null);
        } catch (err) {
            toast.error(err.message || 'Failed to add route');
        } finally {
            setRouting(false);
        }
    }

    async function handleDelete(tunnel) {
        const ok = await confirmCf({
            title: 'Delete Tunnel',
            message: `Delete tunnel "${tunnel.name}"? Active connections will be force-closed.`,
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.deleteRemoteCloudflaredTunnel(serverId, tunnel.id || tunnel.name);
            toast.success('Tunnel deleted');
            loadTunnels();
        } catch (err) {
            toast.error(err.message || 'Failed to delete tunnel');
        }
    }

    // Triggers `cloudflared tunnel login` on the agent and subscribes
    // to the streaming auth flow. The first event carries the auth URL
    // we surface as a clickable button; the final event flips us back
    // to ready state once cert.pem appears.
    async function handleStartLogin() {
        try {
            const res = await api.startRemoteCloudflaredLogin(serverId);
            const channel = res?.channel || `job:${res?.job_id}`;
            setLogin({ channel, status: 'starting', authUrl: null, error: null, certPath: null });

            // Reuse the live socket service to subscribe to the
            // server_stream room. We don't open the JobProgressModal
            // because the login flow needs a different shape (a single
            // big "Open URL" CTA, not a log tail).
            const { default: socketService } = await import('../services/socket');
            if (!socketService.socket) socketService.connect();
            const sock = socketService.socket;
            if (!sock) {
                setLogin(null);
                toast.error('Socket not available');
                return;
            }
            const room = `server_${serverId}_${channel}`;
            const onStream = (msg) => {
                if (msg?.channel !== channel) return;
                const ev = msg.data || {};
                const url = ev?.extra?.auth_url;
                if (url) {
                    setLogin((cur) => cur ? { ...cur, status: 'awaiting', authUrl: url } : cur);
                }
                if (ev.phase === 'done') {
                    if (ev.error) {
                        setLogin((cur) => cur ? { ...cur, status: 'error', error: ev.error } : cur);
                        toast.error(`Login failed: ${ev.error}`);
                    } else {
                        setLogin((cur) => cur ? { ...cur, status: 'done', certPath: ev?.extra?.cert_path } : cur);
                        toast.success('Cloudflare login complete');
                        // Refresh capabilities + status so the tab unlocks
                        // without a manual reload.
                        api.refreshRemoteCapabilities(serverId).catch(() => {});
                        loadStatus();
                        loadTunnels();
                    }
                    sock.off('server_stream', onStream);
                    sock.emit('leave_room', { room });
                }
            };
            sock.emit('join_room', { room });
            sock.on('server_stream', onStream);
        } catch (err) {
            toast.error(err.message || 'Failed to start login');
            setLogin(null);
        }
    }

    function handleCancelLogin() {
        setLogin(null);
    }

    if (serverStatus !== 'online') {
        return (
            <div className="offline-notice">
                <OfflineIcon />
                <h4>Server Offline</h4>
                <p>Tunnel management requires the server to be online.</p>
            </div>
        );
    }

    if (loading) {
        return <EmptyState loading title="Loading tunnels" />;
    }

    // Status banner — three distinct states the UI cares about:
    //   1. binary missing      → "install cloudflared"
    //   2. binary, no cert     → "log in once"
    //   3. binary + cert       → ready to manage tunnels
    const notInstalled = status?.available === false;
    const notAuthed = status?.available && status?.authenticated === false;

    return (
        <div className="cloudflared-tab">
            <div className="cron-tab__header">
                <div className="cron-tab__status">
                    {notInstalled ? (
                        <Pill kind="amber">cloudflared not installed</Pill>
                    ) : notAuthed ? (
                        <Pill kind="amber">not authenticated — run cloudflared tunnel login</Pill>
                    ) : (
                        <Pill kind="green">cloudflared ready{status?.version ? ` (${status.version})` : ''}</Pill>
                    )}
                    <span className="cron-tab__count">{tunnels.length} tunnel{tunnels.length === 1 ? '' : 's'}</span>
                </div>
                <div className="cron-tab__actions">
                    <Button variant="outline" onClick={loadTunnels} disabled={notInstalled}>Refresh</Button>
                    <Button onClick={() => setShowCreateModal(true)} disabled={notInstalled || notAuthed}>
                        Create Tunnel
                    </Button>
                </div>
            </div>

            {(notInstalled || notAuthed) && (
                <div className="cloudflared-tab__hint">
                    {notInstalled ? (
                        <>
                            Install cloudflared on the server, then return here. See the{' '}
                            <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/" target="_blank" rel="noreferrer">
                                Cloudflare docs
                            </a>.
                        </>
                    ) : login ? (
                        <CloudflaredLoginCard login={login} onCancel={handleCancelLogin} />
                    ) : (
                        <div className="cloudflared-login-prompt">
                            <p>
                                Cloudflare needs you to authorise this agent once. Click{' '}
                                <strong>Login</strong> below — we&apos;ll start the OAuth flow on the
                                server and surface the URL for you to open in your browser. Once you
                                authorise, the agent picks up the cert.pem automatically and the
                                rest of this tab unlocks.
                            </p>
                            <Button onClick={handleStartLogin}>Login to Cloudflare</Button>
                        </div>
                    )}
                </div>
            )}

            {error && !notAuthed && !notInstalled && (
                <div className="alert alert-danger">{error}</div>
            )}

            {!notInstalled && !notAuthed && (
                tunnels.length === 0 ? (
                    <EmptyState
                        icon={Cloud}
                        title="No tunnels"
                        description="No tunnels on this server. Use Create Tunnel to make one."
                    />
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>ID</th>
                                <th>Connections</th>
                                <th className="actions-cell">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tunnels.map(t => (
                                <tr key={t.id || t.name}>
                                    <td><span className="cron-tab__name">{t.name}</span></td>
                                    <td className="mono">{(t.id || '').substring(0, 8)}…</td>
                                    <td>{t.connections?.length || 0}</td>
                                    <td className="actions-cell">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => { setRouteTunnel(t); setShowRouteModal(true); }}
                                        >
                                            Route subdomain
                                        </Button>
                                        <button
                                            className="btn-icon danger"
                                            onClick={() => handleDelete(t)}
                                            title="Delete"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )
            )}

            <Dialog
                open={showCreateModal}
                onOpenChange={(open) => { if (!open && !creating) setShowCreateModal(false); }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Tunnel</DialogTitle>
                        <DialogDescription>
                            Provisions a new Cloudflare Tunnel on this server.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="cf-name">Tunnel Name</Label>
                            <Input
                                id="cf-name"
                                value={createName}
                                onChange={(e) => setCreateName(e.target.value)}
                                placeholder="my-app"
                                required
                                autoFocus
                            />
                            <p className="text-xs text-muted-foreground">Letters, numbers, dashes, underscores. Up to 32 chars.</p>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)} disabled={creating}>Cancel</Button>
                            <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog
                open={showRouteModal && !!routeTunnel}
                onOpenChange={(open) => { if (!open && !routing) setShowRouteModal(false); }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Route Subdomain{routeTunnel ? ` → ${routeTunnel.name}` : ''}</DialogTitle>
                        <DialogDescription>
                            A CNAME for this hostname will be created in Cloudflare DNS, pointing at the tunnel.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleRoute} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="cf-host">Hostname</Label>
                            <Input
                                id="cf-host"
                                value={routeHostname}
                                onChange={(e) => setRouteHostname(e.target.value)}
                                placeholder="app.example.com"
                                required
                                autoFocus
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowRouteModal(false)} disabled={routing}>Cancel</Button>
                            <Button type="submit" disabled={routing}>{routing ? 'Adding…' : 'Add Route'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                isOpen={confirmCfState.isOpen}
                title={confirmCfState.title}
                message={confirmCfState.message}
                confirmText={confirmCfState.confirmText}
                cancelText={confirmCfState.cancelText}
                variant={confirmCfState.variant}
                onConfirm={handleCfConfirm}
                onCancel={handleCfCancel}
            />
        </div>
    );
};

// CloudflaredLoginCard renders the in-flight OAuth login state. The
// agent has spawned `cloudflared tunnel login` on the server and is
// streaming progress on a job channel; we render either a spinner
// (while we wait for the URL), the Open-in-Browser CTA (once the URL
// arrives), or a final success/error message.
const CloudflaredLoginCard = ({ login, onCancel }) => {
    if (!login) return null;
    if (login.status === 'starting') {
        return (
            <div className="cloudflared-login-card">
                <p>Asking the agent to start the Cloudflare login flow…</p>
                <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            </div>
        );
    }
    if (login.status === 'awaiting' && login.authUrl) {
        return (
            <div className="cloudflared-login-card">
                <p>
                    <strong>Step 1 / 2:</strong> open the following URL in your browser, sign in
                    to Cloudflare, and pick the zone you want to associate with this agent.
                </p>
                <div className="cloudflared-login-card__actions">
                    <a
                        href={login.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary"
                    >
                        Open Cloudflare login
                    </a>
                    <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => navigator.clipboard?.writeText(login.authUrl)}
                    >
                        Copy URL
                    </button>
                </div>
                <p className="cloudflared-login-card__hint">
                    <strong>Step 2 / 2:</strong> waiting for the agent to receive cert.pem from
                    Cloudflare. This page will refresh automatically once authorisation completes.
                </p>
                <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            </div>
        );
    }
    if (login.status === 'done') {
        return (
            <div className="cloudflared-login-card cloudflared-login-card--success">
                Authenticated. Refreshing…
            </div>
        );
    }
    if (login.status === 'error') {
        return (
            <div className="cloudflared-login-card cloudflared-login-card--error">
                <strong>Login failed:</strong> {login.error || 'unknown error'}
                <Button variant="outline" size="sm" onClick={onCancel}>Dismiss</Button>
            </div>
        );
    }
    return null;
};

const MetricsTab = ({ serverId, metrics }) => {
    return (
        <div className="metrics-tab">
            <MetricsGraph serverId={serverId} />

            {metrics && (
                <div className="metrics-live-stats">
                    <div className="live-stat-card">
                        <h4>Current Snapshot</h4>
                        <div className="live-stats-grid">
                            <div className="live-stat">
                                <span className="live-stat-label">CPU</span>
                                <span className="live-stat-value">{(metrics.cpu_percent || 0).toFixed(1)}%</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">Memory</span>
                                <span className="live-stat-value">{(metrics.memory_percent || 0).toFixed(1)}%</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">Disk</span>
                                <span className="live-stat-value">{(metrics.disk_percent || 0).toFixed(1)}%</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">Net TX</span>
                                <span className="live-stat-value">{formatBytes(metrics.network_sent, { defaultValue: 'N/A' })}/s</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">Net RX</span>
                                <span className="live-stat-value">{formatBytes(metrics.network_recv, { defaultValue: 'N/A' })}/s</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">Containers</span>
                                <span className="live-stat-value">{metrics.container_running || 0} / {metrics.container_count || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


const AgentRegistrationSection = ({ server, onRegenerateToken }) => {
    const expires = server.registration_expires;
    const isExpired = expires && new Date(expires) < new Date();
    const isOnline = server.status === 'online';

    return (
        <div className="form-section form-section--accent">
            <div className="form-section__header">
                <span className="form-section__icon"><KeyIcon /></span>
                <div>
                    <h3>Connection String</h3>
                    <p className="section-description">
                        Generate a fresh connection string to pair (or re-pair) this server.
                        Useful after reinstalling the agent — old credentials are gone, but a
                        new string brings the agent right back to this row.
                        {isOnline && ' This server is currently online; regenerating only affects re-pairing.'}
                        {isExpired && ' The previous token has expired.'}
                    </p>
                </div>
            </div>
            <Button onClick={onRegenerateToken}>
                <KeyIcon /> Generate Connection String
            </Button>
        </div>
    );
};

const SettingsTab = ({ server, onUpdate, onRegenerateToken, onDelete }) => {
    const { confirm: confirmSettings, confirmState: confirmSettingsState, handleConfirm: handleSettingsConfirm, handleCancel: handleSettingsCancel } = useConfirm();
    const [formData, setFormData] = useState({
        name: server.name || '',
        description: server.description || '',
        hostname: server.hostname || '',
        ip_address: server.ip_address || '',
        group_id: server.group_id || ''
    });
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(false);
    const [allowedIPs, setAllowedIPs] = useState([]);
    const [newIP, setNewIP] = useState('');
    const [connectionInfo, setConnectionInfo] = useState(null);
    const [rotatingKey, setRotatingKey] = useState(false);
    const toast = useToast();

    useEffect(() => {
        loadGroups();
        loadSecurityData();
    }, []);

    async function loadGroups() {
        try {
            const data = await api.getServerGroups();
            setGroups(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load groups:', err);
        }
    }

    async function loadSecurityData() {
        try {
            const [ipsData, connData] = await Promise.all([
                api.getAllowedIPs(server.id),
                api.getConnectionInfo(server.id),
            ]);
            setAllowedIPs(ipsData.allowed_ips || []);
            setConnectionInfo(connData);
        } catch (err) {
            console.error('Failed to load security data:', err);
        }
    }

    async function handleAddIP() {
        if (!newIP.trim()) return;
        const updated = [...allowedIPs, newIP.trim()];
        try {
            await api.updateAllowedIPs(server.id, updated);
            setAllowedIPs(updated);
            setNewIP('');
            toast.success('IP allowlist updated');
        } catch (err) {
            toast.error(err.details?.[0] || err.message || 'Invalid IP pattern');
        }
    }

    async function handleRemoveIP(ip) {
        const updated = allowedIPs.filter(i => i !== ip);
        try {
            await api.updateAllowedIPs(server.id, updated);
            setAllowedIPs(updated);
            toast.success('IP removed from allowlist');
        } catch (err) {
            toast.error(err.message || 'Failed to update allowlist');
        }
    }

    async function handleRotateKey() {
        const confirmed = await confirmSettings({ title: 'Rotate Credentials', message: 'Rotate API credentials? The agent must be online to receive new credentials.', variant: 'warning' });
        if (!confirmed) return;
        setRotatingKey(true);
        try {
            const result = await api.rotateAPIKey(server.id);
            if (result.success) {
                toast.success('Credential rotation initiated. Agent will update shortly.');
            } else {
                toast.error(result.error || 'Failed to rotate credentials');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to rotate credentials');
        } finally {
            setRotatingKey(false);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);

        try {
            await api.updateServer(server.id, formData);
            toast.success('Server updated successfully');
            onUpdate();
        } catch (err) {
            toast.error(err.message || 'Failed to update server');
        } finally {
            setLoading(false);
        }
    }

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    return (
        <div className="settings-tab">
            <div className="settings-grid">
                <form onSubmit={handleSubmit} className="settings-form">
                    <div className="form-section form-section--accent">
                        <div className="form-section__header">
                            <span className="form-section__icon"><ServerIcon /></span>
                            <div>
                                <h3>Basic Information</h3>
                                <p className="section-description">Identity and grouping for this server.</p>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Server Name</label>
                            <Input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>Description</label>
                            <Textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                rows={3}
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Hostname</label>
                                <Input
                                    type="text"
                                    name="hostname"
                                    value={formData.hostname}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>IP Address</label>
                                <Input
                                    type="text"
                                    name="ip_address"
                                    value={formData.ip_address}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Group</label>
                            <select name="group_id" value={formData.group_id} onChange={handleChange}>
                                <option value="">No Group</option>
                                {groups.map(group => (
                                    <option key={group.id} value={group.id}>{group.name}</option>
                                ))}
                            </select>
                        </div>

                        <Button type="submit" disabled={loading}>
                            {loading ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </form>

                <AgentRegistrationSection
                    server={server}
                    onRegenerateToken={onRegenerateToken}
                />
            </div>

            <div className="security-grid">
                <div className="form-section form-section--accent">
                    <div className="form-section__header">
                        <span className="form-section__icon"><NetworkIcon /></span>
                        <div>
                            <h3>Connection & IP Allowlist</h3>
                            <p className="section-description">
                                Restrict which IPs can connect. Supports single IPs, CIDR notation, and wildcards.
                            </p>
                        </div>
                    </div>

                    {connectionInfo && (
                        <div className="security-info-bar">
                            <div className="security-info-item">
                                <span className="security-info-label">Connection IP</span>
                                <span className="security-info-value">
                                    <code>{connectionInfo.ip_address || 'Not connected'}</code>
                                </span>
                            </div>
                            {connectionInfo.connected_since && (
                                <div className="security-info-item">
                                    <span className="security-info-label">Connected Since</span>
                                    <span className="security-info-value">{new Date(connectionInfo.connected_since).toLocaleString()}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="subsection">
                        <div className="ip-list">
                            {allowedIPs.length === 0 ? (
                                <div className="ip-empty">No IP restrictions (all IPs allowed)</div>
                            ) : (
                                allowedIPs.map((ip, idx) => (
                                    <div key={idx} className="ip-item">
                                        <code>{ip}</code>
                                        {connectionInfo?.ip_address === ip && (
                                            <Pill kind="green" dot={false}>Current</Pill>
                                        )}
                                        <button
                                            className="btn-icon danger"
                                            onClick={() => handleRemoveIP(ip)}
                                            title="Remove"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="ip-add-form">
                            <Input
                                type="text"
                                placeholder="IP address or CIDR (e.g., 192.168.1.0/24)"
                                value={newIP}
                                onChange={(e) => setNewIP(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIP())}
                            />
                            <Button variant="outline" onClick={handleAddIP}>
                                Add
                            </Button>
                        </div>

                        {connectionInfo?.ip_address && allowedIPs.length > 0 && !allowedIPs.some(ip => {
                            return ip === connectionInfo.ip_address || ip.includes('*') || ip.includes('/');
                        }) && (
                            <div className="security-warning">
                                Current connection IP ({connectionInfo.ip_address}) may be blocked by these rules.
                            </div>
                        )}
                    </div>
                </div>

                <div className="form-section form-section--accent">
                    <div className="form-section__header">
                        <span className="form-section__icon"><KeyIcon /></span>
                        <div>
                            <h3>API Key Rotation</h3>
                            <p className="section-description">
                                Rotate the API credentials used by the agent. The agent must be online to receive new credentials.
                            </p>
                        </div>
                    </div>
                    <div className="key-rotation-actions">
                        <Button
                            variant="outline"
                            onClick={handleRotateKey}
                            disabled={rotatingKey || server.status !== 'online'}
                        >
                            <KeyIcon /> {rotatingKey ? 'Rotating...' : 'Rotate API Key'}
                        </Button>
                        {server.api_key_last_rotated && (
                            <span className="key-rotation-hint">Last rotated: {new Date(server.api_key_last_rotated).toLocaleString()}</span>
                        )}
                    </div>

                    {server.status !== 'online' && (
                        <div className="security-notice">
                            Server must be online to rotate credentials.
                        </div>
                    )}
                </div>
            </div>

            <div className="form-section form-section--accent shared-resources-section">
                <div className="form-section__header">
                    <span className="form-section__icon"><TagIcon /></span>
                    <div>
                        <h3>Tags</h3>
                        <p className="section-description">
                            Free-form labels for grouping and filtering this server across the panel.
                        </p>
                    </div>
                </div>
                <TagsPanel resourceType="server" resourceId={server.id} />
            </div>

            <DangerZone
                title="Danger Zone"
                description="Removing this server will disconnect the agent and delete all associated data."
                action={
                    <Button variant="destructive" onClick={onDelete}>
                        <TrashIcon /> Remove Server
                    </Button>
                }
            />
            <ConfirmDialog
                isOpen={confirmSettingsState.isOpen}
                title={confirmSettingsState.title}
                message={confirmSettingsState.message}
                confirmText={confirmSettingsState.confirmText}
                cancelText={confirmSettingsState.cancelText}
                variant={confirmSettingsState.variant}
                onConfirm={handleSettingsConfirm}
                onCancel={handleSettingsCancel}
            />
        </div>
    );
};


// Token-lifetime presets shown in the regenerate modal. Mirrors the values
// the Add Server modal uses (frontend/src/pages/Servers.jsx). Keep them in
// sync if you tweak either list.
const TOKEN_EXPIRY_OPTIONS = [
    { label: '1 hour',   value: 60 * 60 },
    { label: '24 hours', value: 24 * 60 * 60 },
    { label: '7 days',   value: 7 * 24 * 60 * 60 },
    { label: '30 days',  value: 30 * 24 * 60 * 60 },
    { label: 'Never',    value: -1 },
];

const TokenModal = ({ server, onClose, onGenerated }) => {
    const toast = useToast();
    const [expiresIn, setExpiresIn] = useState(7 * 24 * 60 * 60);
    const [generating, setGenerating] = useState(false);
    // Result of the most recent generation in *this* modal session. We
    // don't fall back to server.connection_string because the panel only
    // ever returns the connection string at create/regenerate time — once
    // the modal closes, the value is gone, so showing a stale one would
    // be misleading.
    const [result, setResult] = useState(null);

    async function handleGenerate() {
        setGenerating(true);
        try {
            const data = await api.generateRegistrationToken(server.id, { expires_in: expiresIn });
            setResult(data);
            onGenerated?.(data);
            toast.success('Connection string generated');
        } catch (err) {
            toast.error(err.message || 'Failed to generate connection string');
        } finally {
            setGenerating(false);
        }
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    }

    const linuxScript = result ? `curl -fsSL ${window.location.origin}/api/v1/servers/install.sh | sudo bash -s -- \\
  --server "${window.location.origin}" \\
  --token "${result.registration_token}"` : '';
    const windowsScript = result ? `irm ${window.location.origin}/api/v1/servers/install.ps1 | iex
Install-ServerKitAgent -Server "${window.location.origin}" -Token "${result.registration_token}"` : '';

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Connection String</DialogTitle>
                    {!result && (
                        <DialogDescription>
                            Generate a single pasteable string the agent can consume.
                            The token inside is single-use — burned the moment any
                            agent registers with it.
                        </DialogDescription>
                    )}
                </DialogHeader>

                {!result ? (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="token-expires">Token expires</Label>
                            <Select value={String(expiresIn)} onValueChange={(v) => setExpiresIn(Number(v))}>
                                <SelectTrigger id="token-expires">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TOKEN_EXPIRY_OPTIONS.map(opt => (
                                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={onClose}>Cancel</Button>
                            <Button onClick={handleGenerate} disabled={generating}>
                                {generating ? 'Generating…' : 'Generate'}
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <div className="token-status">
                            <span className="token-status-dot active" />
                            <span>
                                Active — expires {new Date(result.registration_expires).toLocaleString()}
                            </span>
                        </div>

                        <div className="connection-string-field">
                            <div className="connection-string-field__header">
                                <KeyIcon />
                                <span>Connection string</span>
                                <Button variant="outline" size="sm" onClick={() => copyToClipboard(result.connection_string)}>
                                    <CopyIcon /> Copy
                                </Button>
                            </div>
                            <pre className="connection-string-field__value">{result.connection_string}</pre>
                        </div>

                        <details className="install-fallback">
                            <summary>Need to install the agent first? Use the one-liner installer.</summary>
                            <div className="install-tabs" style={{ marginTop: '0.75rem' }}>
                                <div className="install-tab">
                                    <div className="install-tab-header">
                                        <TerminalIcon />
                                        <div className="install-tab-title">
                                            <span>Linux</span>
                                            <span className="install-tab-description">curl, tar, sudo, and systemd</span>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(linuxScript)}>
                                            <CopyIcon /> Copy
                                        </Button>
                                    </div>
                                    <pre className="install-script">{linuxScript}</pre>
                                </div>
                                <div className="install-tab">
                                    <div className="install-tab-header">
                                        <WindowsIcon />
                                        <div className="install-tab-title">
                                            <span>Windows (PowerShell)</span>
                                            <span className="install-tab-description">Run as Administrator</span>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(windowsScript)}>
                                            <CopyIcon /> Copy
                                        </Button>
                                    </div>
                                    <pre className="install-script">{windowsScript}</pre>
                                </div>
                            </div>
                        </details>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setResult(null)}>
                                Generate another
                            </Button>
                            <Button onClick={onClose}>Done</Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

const CopyChip = ({ label, value, title, mono }) => {
    const toast = useToast();
    const handleCopy = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!value) return;
        navigator.clipboard.writeText(value);
        toast.success(`${label[0].toUpperCase()}${label.slice(1)} copied`);
    };
    return (
        <button
            type="button"
            className={`copy-chip${mono ? ' copy-chip--mono' : ''}`}
            onClick={handleCopy}
            title={title || `Copy ${label}`}
        >
            <span className="copy-chip__label">{label}</span>
            <code className="copy-chip__value">{value}</code>
            <CopyIcon />
        </button>
    );
};

// Icons
const FolderTinyIcon = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
);

const RefreshIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
);

const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
);

const KeyIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
);

const OfflineIcon = () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
);

const StopIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12"/>
    </svg>
);

const PlayIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
);

const TerminalIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
);

const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
);

const WindowsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
);

const CpuIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2"/>
        <rect x="9" y="9" width="6" height="6"/>
        <line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/>
        <line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/>
        <line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/>
        <line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/>
    </svg>
);

const MemoryIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="20" height="10" rx="2"/>
        <line x1="6" y1="7" x2="6" y2="17"/>
        <line x1="10" y1="7" x2="10" y2="17"/>
        <line x1="14" y1="7" x2="14" y2="17"/>
        <line x1="18" y1="7" x2="18" y2="17"/>
    </svg>
);

const DiskIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="5" rx="9" ry="3"/>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>
    </svg>
);

const ClockIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
    </svg>
);

const NetworkIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
);

const ServerIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="7" rx="1"/>
        <rect x="2" y="14" width="20" height="7" rx="1"/>
        <line x1="6" y1="6.5" x2="6.01" y2="6.5"/>
        <line x1="6" y1="17.5" x2="6.01" y2="17.5"/>
    </svg>
);

const HostIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
);

const OsIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
);

const ArchIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
    </svg>
);

const ChipIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="5" width="14" height="14" rx="1"/>
        <rect x="9" y="9" width="6" height="6"/>
        <path d="M3 9h2M3 15h2M19 9h2M19 15h2M9 3v2M15 3v2M9 19v2M15 19v2"/>
    </svg>
);

const AgentIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/>
        <circle cx="9" cy="14" r="1"/>
        <circle cx="15" cy="14" r="1"/>
    </svg>
);

const TagIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
        <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
);

const HashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="9" x2="20" y2="9"/>
        <line x1="4" y1="15" x2="20" y2="15"/>
        <line x1="10" y1="3" x2="8" y2="21"/>
        <line x1="16" y1="3" x2="14" y2="21"/>
    </svg>
);

const DockerMiniIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="10" width="3" height="3"/>
        <rect x="7" y="10" width="3" height="3"/>
        <rect x="11" y="10" width="3" height="3"/>
        <rect x="7" y="6" width="3" height="3"/>
        <rect x="11" y="6" width="3" height="3"/>
        <path d="M2 14c0 4 4 6 10 6s10-2 10-6"/>
    </svg>
);

const PulseIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
);

const AlertIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
);

const InfoCircleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
);

export default ServerDetail;
