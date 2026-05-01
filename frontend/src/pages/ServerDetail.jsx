import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import MetricsGraph from '../components/MetricsGraph';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DangerZone } from '../components/DangerZone';
import { InfoList, InfoItem } from '../components/InfoList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

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
    const toast = useToast();

    const validTabs = ['overview', 'docker', 'metrics', 'settings'];
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
            if (data.success) {
                setMetrics(data.data);
            }
        } catch (err) {
            console.error('Failed to load metrics:', err);
        }
    }, [id, server]);

    const loadSystemInfo = useCallback(async () => {
        if (!server || server.status !== 'online') return;
        try {
            const data = await api.getRemoteSystemInfo(id);
            if (data.success) {
                setSystemInfo(data.data);
            }
        } catch (err) {
            console.error('Failed to load system info:', err);
        }
    }, [id, server]);

    useEffect(() => {
        loadServer();
    }, [loadServer]);

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

    async function handleRegenerateToken() {
        const tokenConfirmed = await confirm({ title: 'Regenerate Token', message: 'Generate a new registration token? The old token will be invalidated.', variant: 'warning' });
        if (!tokenConfirmed) return;

        try {
            const result = await api.generateRegistrationToken(id);
            toast.success('New registration token generated');
            setServer(prev => ({
                ...prev,
                registration_token: result.registration_token,
                registration_expires: result.registration_expires
            }));
        } catch (err) {
            toast.error(err.message || 'Failed to generate token');
        }
    }

    async function handleGenerateToken() {
        try {
            const result = await api.generateRegistrationToken(id);
            setServer(prev => ({
                ...prev,
                registration_token: result.registration_token,
                registration_expires: result.registration_expires
            }));
            setShowTokenModal(true);
        } catch (err) {
            toast.error(err.message || 'Failed to generate token');
        }
    }

    if (loading) {
        return <div className="loading">Loading server details...</div>;
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

    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'docker', label: 'Docker' },
        { id: 'metrics', label: 'Metrics' },
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
                            <span className={`status-pill status-pill--${server.status || 'pending'}`}>
                                <span className="status-pill__dot" />
                                {server.status || 'pending'}
                            </span>
                        </div>
                        <div className="server-detail-header__meta">
                            <span className="mono">{server.hostname || server.ip_address || 'No endpoint configured'}</span>
                            {server.group_name && (
                                <span className="server-detail-header__chip"><FolderTinyIcon /> {server.group_name}</span>
                            )}
                            {server.os_type && <span className="server-detail-header__chip">{server.os_type}</span>}
                            {server.agent_version && <span className="server-detail-header__chip">agent {server.agent_version}</span>}
                            {server.last_seen && (
                                <span className="server-detail-header__chip">
                                    last seen {new Date(server.last_seen).toLocaleString()}
                                </span>
                            )}
                        </div>
                        {server.description && (
                            <p className="server-detail-header__description">{server.description}</p>
                        )}
                    </div>
                </div>
                {server.transport === 'poll' && (
                    <div className="server-detail-header__transport-banner">
                        <strong>Limited mode:</strong> this agent connected via the REST polling
                        fallback because the WebSocket link couldn't be established cleanly.
                        Heartbeats and one-shot commands work; live logs, real-time metrics, and
                        terminal sessions are unavailable until the WS link is restored.
                    </div>
                )}
                <div className="server-detail-header__actions">
                    <Button variant="outline" onClick={handlePingServer}>
                        <RefreshIcon /> Ping
                    </Button>
                    <Button variant="outline" asChild>
                        <Link to={`/servers/${id}/docker`}>Docker</Link>
                    </Button>
                    <Button onClick={handleGenerateToken}>
                        <KeyIcon /> Generate Token
                    </Button>
                </div>
            </header>

            <div className="server-detail-tabs">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
                        onClick={() => navigate(t.id === 'overview' ? `/servers/${id}` : `/servers/${id}/${t.id}`, { replace: true })}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="server-detail-content">
                {activeTab === 'overview' && (
                    <OverviewTab
                        server={server}
                        metrics={metrics}
                        systemInfo={systemInfo}
                    />
                )}
                {activeTab === 'docker' && (
                    <DockerTab serverId={id} serverStatus={server.status} />
                )}
                {activeTab === 'metrics' && (
                    <MetricsTab serverId={id} metrics={metrics} />
                )}
                {activeTab === 'settings' && (
                    <SettingsTab
                        server={server}
                        onUpdate={loadServer}
                        onRegenerateToken={handleRegenerateToken}
                        onDelete={handleDeleteServer}
                    />
                )}
            </div>

            {showTokenModal && server && (
                <TokenModal
                    server={server}
                    onClose={() => setShowTokenModal(false)}
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

const OverviewTab = ({ server, metrics, systemInfo }) => {
    const formatBytes = (bytes) => {
        if (!bytes) return 'N/A';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    };

    const formatUptime = (seconds) => {
        if (!seconds) return 'N/A';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        if (days > 0) return `${days}d ${hours}h`;
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    };

    return (
        <div className="overview-tab">
            <div className="overview-grid">
                <div className="info-card">
                    <h3>Server Information</h3>
                    <InfoList>
                        <InfoItem label="Status">
                            <span className={`status-badge ${server.status}`}>{server.status}</span>
                        </InfoItem>
                        <InfoItem label="Hostname" value={server.hostname || 'N/A'} />
                        <InfoItem label="IP Address" value={server.ip_address || 'N/A'} />
                        <InfoItem label="Group" value={server.group_name || 'Ungrouped'} />
                        <InfoItem
                            label="Last Seen"
                            value={server.last_seen ? new Date(server.last_seen).toLocaleString() : 'Never'}
                        />
                    </InfoList>
                </div>

                <div className="info-card">
                    <h3>System Information</h3>
                    <InfoList>
                        <InfoItem
                            label="Operating System"
                            value={`${systemInfo?.os || server.os_type || 'Unknown'}${systemInfo?.os_version ? ` ${systemInfo.os_version}` : ''}`}
                        />
                        <InfoItem label="Architecture" value={systemInfo?.architecture || server.architecture || 'N/A'} />
                        <InfoItem
                            label="CPU"
                            value={`${systemInfo?.cpu_model || 'N/A'}${systemInfo?.cpu_cores ? ` (${systemInfo.cpu_cores} cores)` : ''}`}
                        />
                        <InfoItem label="Total Memory" value={formatBytes(systemInfo?.total_memory)} />
                        <InfoItem label="Total Disk" value={formatBytes(systemInfo?.total_disk)} />
                    </InfoList>
                </div>

                <div className="info-card">
                    <h3>Agent Information</h3>
                    <InfoList>
                        <InfoItem label="Agent Version" value={server.agent_version || 'Not installed'} />
                        <InfoItem label="Agent ID" value={server.agent_id || 'N/A'} mono />
                        <InfoItem label="Docker Version" value={server.docker_version || systemInfo?.docker_version || 'N/A'} />
                        <InfoItem label="Uptime" value={formatUptime(metrics?.uptime)} />
                    </InfoList>
                </div>

                {server.status === 'online' && metrics && (
                    <div className="info-card metrics-card">
                        <h3>Current Resources</h3>
                        <div className="resource-meters">
                            <ResourceMeter label="CPU" value={metrics.cpu_percent} color="#6366F1" />
                            <ResourceMeter label="Memory" value={metrics.memory_percent} color="#10B981" />
                            <ResourceMeter label="Disk" value={metrics.disk_percent} color="#F59E0B" />
                        </div>
                    </div>
                )}

                {server.status !== 'online' && (
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
            </div>
        </div>
    );
};

const ResourceMeter = ({ label, value, color }) => {
    const safeValue = Math.min(Math.max(value || 0, 0), 100);
    return (
        <div className="resource-meter">
            <div className="resource-header">
                <span className="resource-label">{label}</span>
                <span className="resource-value">{safeValue.toFixed(1)}%</span>
            </div>
            <div className="resource-bar">
                <div
                    className="resource-fill"
                    style={{
                        width: `${safeValue}%`,
                        backgroundColor: safeValue > 80 ? '#EF4444' : color
                    }}
                />
            </div>
        </div>
    );
};

const DockerTab = ({ serverId, serverStatus }) => {
    const [containers, setContainers] = useState([]);
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
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
        try {
            const [containersRes, imagesRes] = await Promise.all([
                api.getRemoteContainers(serverId, true),
                api.getRemoteImages(serverId)
            ]);

            if (containersRes.success) setContainers(containersRes.data || []);
            if (imagesRes.success) setImages(imagesRes.data || []);
        } catch (err) {
            console.error('Failed to load Docker data:', err);
        } finally {
            setLoading(false);
        }
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
        return <div className="loading">Loading Docker data...</div>;
    }

    return (
        <div className="docker-tab">
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
                        <div className="empty-list">No containers found on this server.</div>
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
                                                <span className={`status-pill ${isRunning ? 'running' : 'stopped'}`}>
                                                    {container.state}
                                                </span>
                                            </td>
                                            <td>{container.ports || '-'}</td>
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
                        <div className="empty-list">No images found on this server.</div>
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

const MetricsTab = ({ serverId, metrics }) => {
    const formatBytes = (bytes) => {
        if (!bytes) return 'N/A';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    };

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
                                <span className="live-stat-value">{formatBytes(metrics.network_sent)}/s</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">Net RX</span>
                                <span className="live-stat-value">{formatBytes(metrics.network_recv)}/s</span>
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
    const [copied, setCopied] = useState(false);
    const toast = useToast();

    const token = server.registration_token;
    const expires = server.registration_expires;
    const isExpired = expires && new Date(expires) < new Date();

    const linuxScript = token ? `curl -fsSL ${window.location.origin}/api/v1/servers/install.sh | sudo bash -s -- \\
  --server "${window.location.origin}" \\
  --token "${token}"` : '';

    const windowsScript = token ? `irm ${window.location.origin}/api/v1/servers/install.ps1 | iex
Install-ServerKitAgent -Server "${window.location.origin}" -Token "${token}"` : '';

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="form-section">
            <h3>Agent Installation</h3>

            {token && !isExpired ? (
                <div className="install-active">
                    <div className="token-status">
                        <span className="token-status-dot active" />
                        <span>Token active — expires {new Date(expires).toLocaleString()}</span>
                    </div>

                    <div className="install-script-block">
                        <div className="install-script-header">
                            <TerminalIcon />
                            <span>Linux</span>
                            <Button variant="outline" size="sm" onClick={() => copyToClipboard(linuxScript)}>
                                <CopyIcon /> Copy
                            </Button>
                        </div>
                        <pre className="install-script-code">{linuxScript}</pre>
                    </div>

                    <div className="install-script-block">
                        <div className="install-script-header">
                            <WindowsIcon />
                            <span>Windows (PowerShell)</span>
                            <Button variant="outline" size="sm" onClick={() => copyToClipboard(windowsScript)}>
                                <CopyIcon /> Copy
                            </Button>
                        </div>
                        <pre className="install-script-code">{windowsScript}</pre>
                    </div>

                    <Button variant="outline" onClick={onRegenerateToken}>
                        <RefreshIcon /> Regenerate Token
                    </Button>
                </div>
            ) : (
                <div className="install-inactive">
                    <p className="section-description">
                        {isExpired
                            ? 'The registration token has expired. Generate a new one to install or reinstall the agent.'
                            : 'Generate a registration token to install the agent on your server.'}
                    </p>
                    <Button onClick={onRegenerateToken}>
                        <KeyIcon /> Generate Token
                    </Button>
                </div>
            )}
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
    const [securityAlerts, setSecurityAlerts] = useState([]);
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
            const [ipsData, connData, alertsData] = await Promise.all([
                api.getAllowedIPs(server.id),
                api.getConnectionInfo(server.id),
                api.getServerSecurityAlerts(server.id, { status: 'open', limit: 10 })
            ]);
            setAllowedIPs(ipsData.allowed_ips || []);
            setConnectionInfo(connData);
            setSecurityAlerts(alertsData || []);
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

    async function handleAcknowledgeAlert(alertId) {
        try {
            await api.acknowledgeAlert(alertId);
            setSecurityAlerts(prev => prev.map(a =>
                a.id === alertId ? { ...a, status: 'acknowledged' } : a
            ));
        } catch (err) {
            toast.error('Failed to acknowledge alert');
        }
    }

    async function handleResolveAlert(alertId) {
        try {
            await api.resolveAlert(alertId);
            setSecurityAlerts(prev => prev.filter(a => a.id !== alertId));
        } catch (err) {
            toast.error('Failed to resolve alert');
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
                    <div className="form-section">
                        <h3>Basic Information</h3>

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
                <div className="form-section">
                    <h3>Connection & IP Allowlist</h3>

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
                        <p className="section-description">
                            Restrict which IPs can connect. Supports single IPs, CIDR notation, and wildcards.
                        </p>

                        <div className="ip-list">
                            {allowedIPs.length === 0 ? (
                                <div className="ip-empty">No IP restrictions (all IPs allowed)</div>
                            ) : (
                                allowedIPs.map((ip, idx) => (
                                    <div key={idx} className="ip-item">
                                        <code>{ip}</code>
                                        {connectionInfo?.ip_address === ip && (
                                            <Badge variant="success">Current</Badge>
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

                <div className="form-section">
                    <h3>API Key Rotation</h3>
                    <p className="section-description">
                        Rotate the API credentials used by the agent. The agent must be online to receive new credentials.
                    </p>
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

            {securityAlerts.length > 0 && (
                <div className="form-section">
                    <h3>Security Alerts</h3>
                    <div className="alerts-list">
                        {securityAlerts.map(alert => (
                            <div key={alert.id} className={`alert-item severity-${alert.severity}`}>
                                <div className="alert-item-header">
                                    <span className={`severity-badge ${alert.severity}`}>{alert.severity}</span>
                                    <span className="alert-type">{alert.alert_type.replace('_', ' ')}</span>
                                    <span className="alert-time">{new Date(alert.created_at).toLocaleString()}</span>
                                </div>
                                <div className="alert-item-details">
                                    {alert.source_ip && <span>IP: {alert.source_ip}</span>}
                                    {alert.details?.message && <span>{alert.details.message}</span>}
                                    {alert.details?.attempts && <span>Attempts: {alert.details.attempts}</span>}
                                </div>
                                <div className="alert-item-actions">
                                    {alert.status === 'open' && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleAcknowledgeAlert(alert.id)}
                                        >
                                            Acknowledge
                                        </Button>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleResolveAlert(alert.id)}
                                    >
                                        Resolve
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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


const TokenModal = ({ server, onClose }) => {
    const toast = useToast();
    const token = server.registration_token;
    const expires = server.registration_expires;

    const linuxScript = token ? `curl -fsSL ${window.location.origin}/api/v1/servers/install.sh | sudo bash -s -- \\
  --server "${window.location.origin}" \\
  --token "${token}"` : '';

    const windowsScript = token ? `irm ${window.location.origin}/api/v1/servers/install.ps1 | iex
Install-ServerKitAgent -Server "${window.location.origin}" -Token "${token}"` : '';

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Agent Installation Token</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="install-instructions">
                    <div className="token-status">
                        <span className="token-status-dot active" />
                        <span>Token active — expires {new Date(expires).toLocaleString()}</span>
                    </div>

                    <div className="install-tabs">
                        <div className="install-tab">
                            <div className="install-tab-header">
                                <TerminalIcon />
                                <div className="install-tab-title">
                                    <span>Linux</span>
                                    <span className="install-tab-description">Linux server with curl, tar, sudo, and systemd</span>
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

                    <div className="install-info">
                        <h4>What happens next?</h4>
                        <ol>
                            <li>Copy and run the install script on your server</li>
                            <li>The agent downloads, installs, and registers automatically</li>
                            <li>Your server will appear as <strong>Pending</strong> until the agent connects, then switch to <strong>Online</strong></li>
                        </ol>
                        <p className="text-muted">
                            The registration token expires in 24 hours. You can regenerate it from the server settings page.
                        </p>
                    </div>

                    <div className="modal-actions">
                        <Button onClick={onClose}>Close</Button>
                    </div>
                </div>
            </div>
        </div>
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

export default ServerDetail;
