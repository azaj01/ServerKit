import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import LogToolbar from '../components/log-viewer/LogToolbar';
import LogContent from '../components/log-viewer/LogContent';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MetricCard } from '@/components/ds';
import {
    Box, Layers, HardDrive, Network as NetworkIcon, Search, X, RefreshCw,
    Trash2, Play, Square, RotateCw, Terminal as TerminalLucide, FileText,
    Activity, Clock3, Copy, Database, Gauge, Package, Server as ServerIcon, ArrowUpDown,
} from 'lucide-react';

// Server context for Docker operations
const ServerContext = createContext({ serverId: 'local', serverName: 'Local' });
const useServer = () => useContext(ServerContext);

const VALID_TABS = ['containers', 'compose', 'images', 'volumes', 'networks'];
const LOCAL_DOCKER_TARGET = { id: 'local', name: 'Local (this server)', status: 'online', is_local: true };

const unwrapRemoteData = (response) => {
    if (response?.success && response.data !== undefined) {
        return response.data;
    }
    return response;
};

// formatPorts normalises Docker port data from the two shapes the agent
// returns: a comma-separated string (legacy `docker ps`-style output)
// or an array of `{ip, private_port, public_port, type}` objects from
// `docker inspect`. Always returns an array of human-readable strings,
// or `['-']` when there are no ports — both call sites (the container
// list grid and the inspector drawer) want array semantics. Rendering
// the raw inspect array directly triggered React error #31.
function formatPorts(ports) {
    if (!ports) return ['-'];
    if (Array.isArray(ports)) {
        const formatted = ports
            .map((p) => {
                if (!p || typeof p !== 'object') return null;
                const proto = p.type || p.protocol || 'tcp';
                const priv = p.private_port ?? p.PrivatePort;
                const pub = p.public_port ?? p.PublicPort;
                const ip = p.ip || p.IP;
                if (pub) {
                    return `${ip ? `${ip}:` : ''}${pub}->${priv}/${proto}`;
                }
                return priv ? `${priv}/${proto}` : null;
            })
            .filter(Boolean);
        return formatted.length > 0 ? formatted : ['-'];
    }
    if (typeof ports !== 'string') return ['-'];
    const parts = ports.split(',').map((p) => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : ['-'];
}

const normalizeListResponse = (response, key) => {
    const data = unwrapRemoteData(response);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[key])) return data[key];
    return [];
};

const shortId = (value) => value ? value.substring(0, 12) : '-';

const getContainerId = (container) => (
    container?.id || container?.ID || container?.Id || ''
);

const getContainerName = (container) => (
    container?.name || container?.Names || container?.Name || 'unnamed'
);

const getContainerImage = (container) => (
    container?.image || container?.Image || container?.Config?.Image || '-'
);

const getContainerStatus = (container) => (
    container?.status || container?.Status || container?.State?.Status || '-'
);

const getContainerState = (container) => {
    const state = container?.state || container?.State?.Status || container?.State || '';
    return typeof state === 'string' ? state.toLowerCase() : '';
};

const isContainerRunning = (container) => getContainerState(container) === 'running';

const getContainerStatusLabel = (container) => {
    if (isContainerRunning(container)) return 'Running';
    const state = getContainerState(container);
    if (state === 'exited') return 'Exited';
    if (state === 'created') return 'Created';
    return state || 'Unknown';
};

// Deterministic hue from a container name (demo's per-container accent color).
const containerHue = (name = '') => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
};

const getContainerProjectName = (container, details) => {
    const labels = details?.Config?.Labels || container?.Labels || {};
    return labels['com.docker.compose.project'] || labels['com.docker.compose.service'] || '-';
};

const Docker = () => {
    const [activeTab, setActiveTab] = useTabParam('/docker', VALID_TABS);
    const [dockerStatus, setDockerStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedServer, setSelectedServer] = useState(LOCAL_DOCKER_TARGET);
    const [availableServers, setAvailableServers] = useState([LOCAL_DOCKER_TARGET]);
    const [stats, setStats] = useState({
        containers: { total: 0, running: 0, stopped: 0 },
        images: { total: 0, size: '0 B' },
        volumes: { total: 0 },
        networks: { total: 0 }
    });

    useEffect(() => {
        checkDockerStatus();
    }, [selectedServer]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let cancelled = false;

        async function loadAvailableServers() {
            try {
                const data = await api.getAvailableServers();
                const servers = Array.isArray(data) && data.length > 0 ? data : [LOCAL_DOCKER_TARGET];
                if (cancelled) return;
                setAvailableServers(servers);
                setSelectedServer(prev => (
                    servers.some(server => server.id === prev.id)
                        ? prev
                        : (servers[0] || LOCAL_DOCKER_TARGET)
                ));
            } catch {
                if (cancelled) return;
                setAvailableServers([LOCAL_DOCKER_TARGET]);
                setSelectedServer(LOCAL_DOCKER_TARGET);
            }
        }

        loadAvailableServers();
        return () => { cancelled = true; };
    }, []);

    async function checkDockerStatus() {
        setLoading(true);
        try {
            if (selectedServer.id === 'local') {
                const status = await api.getDockerStatus();
                setDockerStatus(status);
                if (status.installed) {
                    loadStats();
                } else {
                    setLoading(false);
                }
            } else {
                // For remote servers, check if the agent is online
                const serverData = await api.getServer(selectedServer.id);
                if (serverData.status === 'online' || serverData.server?.status === 'online') {
                    setDockerStatus({ installed: true, running: true });
                    loadStats();
                } else {
                    setDockerStatus({ installed: false, error: 'Server agent is offline' });
                    setLoading(false);
                }
            }
        } catch (err) {
            setDockerStatus({ installed: false, error: err.message });
            setLoading(false);
        }
    }

    async function loadStats() {
        try {
            let containersData, imagesData, volumesData, networksData;

            if (selectedServer.id === 'local') {
                [containersData, imagesData, volumesData, networksData] = await Promise.all([
                    api.getContainers(true),
                    api.getImages(),
                    api.getVolumes(),
                    api.getNetworks()
                ]);
            } else {
                [containersData, imagesData, volumesData, networksData] = await Promise.all([
                    api.getRemoteContainers(selectedServer.id, true),
                    api.getRemoteImages(selectedServer.id),
                    api.getRemoteVolumes(selectedServer.id),
                    api.getRemoteNetworks(selectedServer.id)
                ]);

            }

            const containers = selectedServer.id === 'local'
                ? containersData.containers || []
                : normalizeListResponse(containersData, 'containers');
            const images = selectedServer.id === 'local'
                ? imagesData.images || []
                : normalizeListResponse(imagesData, 'images');
            const volumes = selectedServer.id === 'local'
                ? volumesData.volumes || []
                : normalizeListResponse(volumesData, 'volumes');
            const networks = selectedServer.id === 'local'
                ? networksData.networks || []
                : normalizeListResponse(networksData, 'networks');

            const running = containers.filter(c => c.state === 'running').length;

            setStats({
                containers: {
                    total: containers.length,
                    running,
                    stopped: containers.length - running
                },
                images: {
                    total: images.length,
                    size: formatTotalImageSize(images)
                },
                volumes: { total: volumes.length },
                networks: { total: networks.length }
            });
        } catch (err) {
            console.error('Failed to load stats:', err);
        } finally {
            setLoading(false);
        }
    }

    function formatTotalImageSize(images) {
        const sizes = images.map(img => {
            const size = img.size || '0 B';
            const match = size.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
            if (!match) return 0;
            const [, num, unit = 'B'] = match;
            const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
            return parseFloat(num) * (multipliers[unit.toUpperCase()] || 1);
        });
        const total = sizes.reduce((a, b) => a + b, 0);
        if (total >= 1024**3) return `${(total / 1024**3).toFixed(1)} GB`;
        if (total >= 1024**2) return `${(total / 1024**2).toFixed(1)} MB`;
        if (total >= 1024) return `${(total / 1024).toFixed(1)} KB`;
        return `${total} B`;
    }

    if (loading) {
        return <div className="loading">Checking Docker status...</div>;
    }

    if (!dockerStatus?.installed) {
        return (
            <div className="page-container docker-page">
                <div className="page-header">
                    <div className="page-header-content">
                        <h1>Docker</h1>
                        <p className="page-description">Container management</p>
                    </div>
                </div>
                <div className="docker-unavailable">
                    <div className="docker-unavailable-icon">
                        <svg viewBox="0 0 24 24" width="64" height="64" stroke="currentColor" fill="none" strokeWidth="1">
                            <rect x="2" y="7" width="5" height="5" rx="1"/>
                            <rect x="9" y="7" width="5" height="5" rx="1"/>
                            <rect x="16" y="7" width="5" height="5" rx="1"/>
                            <rect x="2" y="14" width="5" height="5" rx="1"/>
                            <rect x="9" y="14" width="5" height="5" rx="1"/>
                            <path d="M21 12c0 4-3 7-8 7s-8-3-8-7" strokeDasharray="2 2"/>
                        </svg>
                    </div>
                    <h2>Docker Not Available</h2>
                    <p className="docker-unavailable-message">
                        Docker is not installed or not running on this system.
                    </p>
                    <div className="docker-unavailable-details">
                        <code>{dockerStatus?.error || 'Unable to connect to Docker daemon'}</code>
                    </div>
                    <div className="docker-unavailable-help">
                        <h4>To use Docker management:</h4>
                        <ul>
                            <li>Ensure Docker Desktop is installed and running</li>
                            <li>On Linux, make sure the Docker daemon is started</li>
                            <li>Verify the user has permissions to access Docker</li>
                        </ul>
                    </div>
                    <Button onClick={checkDockerStatus}>
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M23 4v6h-6M1 20v-6h6"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                        Retry Connection
                    </Button>
                </div>
            </div>
        );
    }

    const tabs = [
        { id: 'containers', label: 'Containers', icon: Box, count: stats.containers.total },
        { id: 'compose', label: 'Compose', icon: Package, count: null },
        { id: 'images', label: 'Images', icon: Layers, count: stats.images.total },
        { id: 'volumes', label: 'Volumes', icon: HardDrive, count: stats.volumes.total },
        { id: 'networks', label: 'Networks', icon: NetworkIcon, count: stats.networks.total }
    ];

    const activeTabMeta = tabs.find(tab => tab.id === activeTab) || tabs[0];
    const hasMultipleTargets = availableServers.length > 1;

    const serverContextValue = {
        serverId: selectedServer.id,
        serverName: selectedServer.name,
        isRemote: selectedServer.id !== 'local'
    };

    return (
        <ServerContext.Provider value={serverContextValue}>
        <div className="page-container page-container--full-bleed docker-page-new dx-page">
            <div className="dx-workspace">
                <aside className="dx-docker-sidebar">
                    {hasMultipleTargets && (
                        <section className="dx-sidebar-section">
                            <div className="dx-sidebar-section-header">
                                <ServerIcon size={14} />
                                <span>Targets</span>
                            </div>
                            <div className="dx-resource-nav">
                                {availableServers.map(server => (
                                    <button
                                        key={server.id}
                                        className={`dx-resource-nav-item ${selectedServer.id === server.id ? 'active' : ''}`}
                                        onClick={() => setSelectedServer(server)}
                                    >
                                        <ServerIcon size={15} />
                                        <span>{server.name || server.hostname || server.id}</span>
                                        <strong>{server.status || 'online'}</strong>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}

                    <section className="dx-sidebar-section">
                        <div className="dx-sidebar-section-header">
                            <Box size={14} />
                            <span>Resources</span>
                        </div>
                        <div className="dx-resource-nav">
                            {tabs.map(tab => {
                                const Icon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        className={`dx-resource-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                                        onClick={() => setActiveTab(tab.id)}
                                    >
                                        <Icon size={15} />
                                        <span>{tab.label}</span>
                                        {tab.count !== null && <strong>{tab.count}</strong>}
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className="dx-sidebar-section">
                        <div className="dx-sidebar-section-header">
                            <Activity size={14} />
                            <span>Inventory</span>
                        </div>
                        <div className="dx-inventory-list">
                            <div className="dx-inventory-item">
                                <span>Running</span>
                                <strong>{stats.containers.running}</strong>
                            </div>
                            <div className="dx-inventory-item">
                                <span>Stopped</span>
                                <strong>{stats.containers.stopped}</strong>
                            </div>
                            <div className="dx-inventory-item">
                                <span>Images</span>
                                <strong>{stats.images.size}</strong>
                            </div>
                            <div className="dx-inventory-item">
                                <span>Volumes</span>
                                <strong>{stats.volumes.total}</strong>
                            </div>
                        </div>
                    </section>

                    <section className="dx-sidebar-section">
                        <div className="dx-sidebar-section-header">
                            <Trash2 size={14} />
                            <span>Maintenance</span>
                        </div>
                        <div className="dx-sidebar-section-content">
                            <PruneButton onPruned={loadStats} />
                        </div>
                    </section>
                </aside>

                <main className="dx-main">
                    <div className="dx-kpi-strip">
                        <MetricCard tone="accent" icon={<Box size={16} />} value={stats.containers.total} label="Containers">
                            <div className="sk-kpi__sub"><span>{stats.containers.running} running</span></div>
                        </MetricCard>
                        <MetricCard tone="cyan" icon={<Layers size={16} />} value={stats.images.total} label="Images">
                            <div className="sk-kpi__sub"><span>{stats.images.size}</span></div>
                        </MetricCard>
                        <MetricCard tone="violet" icon={<HardDrive size={16} />} value={stats.volumes.total} label="Volumes" />
                        <MetricCard tone="green" icon={<NetworkIcon size={16} />} value={stats.networks.total} label="Networks" />
                    </div>
                    <div className="dx-workbar">
                        <div className="dx-workbar-title">
                            <span>Docker</span>
                            <strong>{activeTabMeta.label}</strong>
                            {hasMultipleTargets && <em>{selectedServer.name || selectedServer.id}</em>}
                        </div>
                        <div className="dx-workbar-actions">
                            {activeTab === 'containers' && <RunContainerButton />}
                            {activeTab === 'images' && <PullImageButton />}
                            {activeTab === 'networks' && <CreateNetworkButton />}
                            {activeTab === 'volumes' && <CreateVolumeButton />}
                        </div>
                    </div>

                    <div className="dx-panel">
                        {activeTab === 'containers' && <ContainersTab onStatsChange={loadStats} />}
                        {activeTab === 'compose' && <ComposeTab onStatsChange={loadStats} />}
                        {activeTab === 'images' && <ImagesTab onStatsChange={loadStats} />}
                        {activeTab === 'networks' && <NetworksTab onStatsChange={loadStats} />}
                        {activeTab === 'volumes' && <VolumesTab onStatsChange={loadStats} />}
                    </div>
                </main>
            </div>
        </div>
        </ServerContext.Provider>
    );
};

// Action Buttons
const RunContainerButton = () => {
    const [showModal, setShowModal] = useState(false);
    const { isRemote } = useServer();
    return (
        <>
            <Button
                onClick={() => setShowModal(true)}
                disabled={isRemote}
                title={isRemote ? 'Running new containers is only available on the local Docker target right now' : 'Run container'}
            >
                <span>+</span> Run Container
            </Button>
            {showModal && <RunContainerModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const PullImageButton = () => {
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <Button onClick={() => setShowModal(true)}>
                <span>+</span> Pull Image
            </Button>
            {showModal && <PullImageModal onClose={() => setShowModal(false)} onPulled={() => window.location.reload()} />}
        </>
    );
};

const CreateNetworkButton = () => {
    const [showModal, setShowModal] = useState(false);
    const { isRemote } = useServer();
    return (
        <>
            <Button
                onClick={() => setShowModal(true)}
                disabled={isRemote}
                title={isRemote ? 'Creating networks is only available on the local Docker target right now' : 'Create network'}
            >
                <span>+</span> Create Network
            </Button>
            {showModal && <CreateNetworkModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const CreateVolumeButton = () => {
    const [showModal, setShowModal] = useState(false);
    const { isRemote } = useServer();
    return (
        <>
            <Button
                onClick={() => setShowModal(true)}
                disabled={isRemote}
                title={isRemote ? 'Creating volumes is only available on the local Docker target right now' : 'Create volume'}
            >
                <span>+</span> Create Volume
            </Button>
            {showModal && <CreateVolumeModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const PruneButton = ({ onPruned }) => {
    const toast = useToast();
    const { isRemote } = useServer();
    const [loading, setLoading] = useState(false);
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();

    async function handlePrune() {
        if (isRemote) {
            toast.error('Prune is only available on the local Docker target right now');
            return;
        }
        const confirmed = await confirm({ title: 'Docker Cleanup', message: 'Remove unused Docker resources? This will remove stopped containers, unused images, and unused networks.' });
        if (!confirmed) return;

        setLoading(true);
        try {
            await api.request('/docker/cleanup', { method: 'POST', body: {} });
            toast.success('Docker cleanup completed');
            onPruned?.();
        } catch {
            toast.error('Failed to cleanup Docker resources');
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={handlePrune}
                disabled={loading || isRemote}
                title={isRemote ? 'Prune is only available on the local Docker target right now' : 'Prune unused Docker resources'}
            >
                {loading ? 'Cleaning...' : 'Prune Unused'}
            </Button>
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
        </>
    );
};

// Icon Action button used by remaining (legacy) tabs (Images, Networks, Volumes).
// Containers tab now renders cards with full action buttons inline.
const IconAction = ({ title, onClick, color, children, disabled }) => (
    <button
        className="docker-icon-action"
        title={title}
        onClick={onClick}
        disabled={disabled}
        style={color ? { color } : {}}
    >
        {children}
    </button>
);

const TrashIcon = () => <Trash2 size={14} />;

// Containers Tab
const ContainersTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmContainer, confirmState: confirmContainerState, handleConfirm: handleContainerConfirm, handleCancel: handleContainerCancel } = useConfirm();
    const [containers, setContainers] = useState([]);
    const [containerStats, setContainerStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(true);
    const [selectedContainer, setSelectedContainer] = useState(null);
    const [logsContainer, setLogsContainer] = useState(null);
    const [execContainer, setExecContainer] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortKey, setSortKey] = useState('status');
    const [sortDirection, setSortDirection] = useState('asc');
    const statsRequestSeq = useRef(0);

    useEffect(() => {
        loadContainers();
    }, [showAll, serverId]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchContainerStats = useCallback(async (container) => {
        const containerId = getContainerId(container);
        if (!containerId) return null;

        if (isRemote) {
            const result = await api.getRemoteContainerStats(serverId, containerId);
            const payload = unwrapRemoteData(result);
            return payload?.stats || payload;
        }

        const statsData = await api.getContainerStats(containerId);
        return statsData.stats;
    }, [isRemote, serverId]);

    const refreshContainerStats = useCallback(async (containerList, requestSeq = statsRequestSeq.current) => {
        const runningContainers = containerList.filter(isContainerRunning);
        if (runningContainers.length === 0) return;

        if (!isRemote) {
            const containerIds = runningContainers.map(getContainerId).filter(Boolean);
            if (containerIds.length === 0) return;

            const resolveStats = (statsMap, container) => {
                const containerId = getContainerId(container);
                const containerName = getContainerName(container);
                return statsMap[containerId] ||
                    statsMap[containerName] ||
                    statsMap[`/${containerName}`] ||
                    null;
            };

            try {
                const statsData = await api.getContainersStats(containerIds);
                if (requestSeq !== statsRequestSeq.current) return;
                const statsMap = statsData?.stats || {};
                setContainerStats(prev => {
                    const next = { ...prev };
                    runningContainers.forEach(container => {
                        next[getContainerId(container)] = resolveStats(statsMap, container);
                    });
                    return next;
                });
            } catch {
                if (requestSeq !== statsRequestSeq.current) return;
                setContainerStats(prev => {
                    const next = { ...prev };
                    runningContainers.forEach(container => {
                        next[getContainerId(container)] = null;
                    });
                    return next;
                });
            }
            return;
        }

        await Promise.all(runningContainers.map(async (container) => {
            const containerId = getContainerId(container);
            try {
                const stats = await fetchContainerStats(container);
                if (requestSeq !== statsRequestSeq.current || !stats) return;
                setContainerStats(prev => ({ ...prev, [containerId]: stats }));
            } catch {
                if (requestSeq !== statsRequestSeq.current) return;
                setContainerStats(prev => ({ ...prev, [containerId]: null }));
            }
        }));
    }, [fetchContainerStats, isRemote]);

    useEffect(() => {
        if (loading || containers.length === 0) return undefined;

        const timer = window.setInterval(() => {
            refreshContainerStats(containers, statsRequestSeq.current);
        }, 10000);

        return () => window.clearInterval(timer);
    }, [containers, loading, refreshContainerStats]);

    async function loadContainers() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteContainers(serverId, showAll);
                data = { containers: normalizeListResponse(result, 'containers') };
            } else {
                data = await api.getContainers(showAll);
            }
            const containerList = data.containers || [];
            const requestSeq = ++statsRequestSeq.current;
            setContainers(containerList);
            setContainerStats({});
            setSelectedContainer(prev => {
                if (!containerList.length || !prev) return null;
                return containerList.find(c => getContainerId(c) === getContainerId(prev)) || null;
            });
            setLoading(false);
            refreshContainerStats(containerList, requestSeq);
        } catch (err) {
            console.error('Failed to load containers:', err);
            setLoading(false);
        }
    }

    async function handleAction(containerId, action) {
        try {
            if (action === 'start') {
                if (isRemote) {
                    await api.startRemoteContainer(serverId, containerId);
                } else {
                    await api.startContainer(containerId);
                }
                toast.success('Container started');
            } else if (action === 'stop') {
                if (isRemote) {
                    await api.stopRemoteContainer(serverId, containerId);
                } else {
                    await api.stopContainer(containerId);
                }
                toast.success('Container stopped');
            } else if (action === 'restart') {
                if (isRemote) {
                    await api.restartRemoteContainer(serverId, containerId);
                } else {
                    await api.restartContainer(containerId);
                }
                toast.success('Container restarted');
            } else if (action === 'remove') {
                const removeConfirmed = await confirmContainer({ title: 'Remove Container', message: 'Remove this container?' });
                if (!removeConfirmed) return;
                if (isRemote) {
                    await api.removeRemoteContainer(serverId, containerId, true);
                } else {
                    await api.removeContainer(containerId, true);
                }
                toast.success('Container removed');
            }
            loadContainers();
            onStatsChange?.();
        } catch (err) {
            console.error(`Failed to ${action} container:`, err);
            toast.error(err.message || `Failed to ${action} container`);
        }
    }

    function parseStats(stats) {
        if (!stats) return { cpu: 0, memory: 0, available: false };
        const source = stats.stats || stats;
        const parsePercent = (value) => {
            if (typeof value === 'number') return value;
            if (value === null || value === undefined) return 0;
            return parseFloat(String(value).replace('%', '')) || 0;
        };

        const cpu = parsePercent(source.CPUPerc ?? source.cpu_percent ?? source.cpu?.percent);
        const memory = parsePercent(source.MemPerc ?? source.memory_percent ?? source.memory?.percent);

        return { cpu, memory, available: true };
    }

    const counts = useMemo(() => {
        const c = { all: containers.length, running: 0, stopped: 0 };
        containers.forEach(x => { if (isContainerRunning(x)) c.running++; else c.stopped++; });
        return c;
    }, [containers]);

    const filteredContainers = useMemo(() => {
        const search = searchTerm.toLowerCase();
        const filtered = containers.filter(c => {
            if (statusFilter === 'running' && !isContainerRunning(c)) return false;
            if (statusFilter === 'stopped' && isContainerRunning(c)) return false;
            if (!search) return true;
            return getContainerName(c).toLowerCase().includes(search) ||
                   getContainerId(c).toLowerCase().includes(search) ||
                   getContainerImage(c).toLowerCase().includes(search);
        });

        const direction = sortDirection === 'asc' ? 1 : -1;
        const statusRank = (container) => isContainerRunning(container) ? 0 : 1;
        const createdTime = (container) => {
            const raw = container.created || container.CreatedAt || '';
            const parsed = Date.parse(raw);
            return Number.isNaN(parsed) ? 0 : parsed;
        };

        return [...filtered].sort((a, b) => {
            const statsA = parseStats(containerStats[getContainerId(a)]);
            const statsB = parseStats(containerStats[getContainerId(b)]);
            let result = 0;

            if (sortKey === 'status') {
                result = statusRank(a) - statusRank(b) ||
                    getContainerStatus(a).localeCompare(getContainerStatus(b));
            } else if (sortKey === 'name') {
                result = getContainerName(a).localeCompare(getContainerName(b));
            } else if (sortKey === 'image') {
                result = getContainerImage(a).localeCompare(getContainerImage(b));
            } else if (sortKey === 'cpu') {
                result = statsA.cpu - statsB.cpu;
            } else if (sortKey === 'memory') {
                result = statsA.memory - statsB.memory;
            } else if (sortKey === 'created') {
                result = createdTime(a) - createdTime(b);
            }

            return result * direction;
        });
    }, [containers, statusFilter, searchTerm, sortKey, sortDirection, containerStats]);

    const selectedStats = selectedContainer
        ? parseStats(containerStats[getContainerId(selectedContainer)])
        : { cpu: 0, memory: 0, available: false };

    if (loading) {
        return (
            <div className="dx-tab-pane">
                <div className="docker-loading">Loading containers...</div>
            </div>
        );
    }

    return (
        <div className="dx-tab-pane dx-containers-pane">
            <div className="dx-tab-toolbar">
                <div className="dx-filter-chips">
                    {[
                        { id: 'all', label: 'All', count: counts.all },
                        { id: 'running', label: 'Running', count: counts.running },
                        { id: 'stopped', label: 'Stopped', count: counts.stopped },
                    ].map(c => (
                        <button
                            key={c.id}
                            className={`filter-chip ${statusFilter === c.id ? 'active' : ''}`}
                            onClick={() => setStatusFilter(c.id)}
                            disabled={c.id !== 'all' && c.count === 0}
                        >
                            <span>{c.label}</span>
                            <span className="filter-chip-count">{c.count}</span>
                        </button>
                    ))}
                </div>
                <div className="dx-tab-toolbar-right">
                    <div className="dx-sort-control">
                        <span>Sort</span>
                        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                            <option value="status">Status</option>
                            <option value="name">Name</option>
                            <option value="image">Image</option>
                            <option value="cpu">CPU</option>
                            <option value="memory">RAM</option>
                            <option value="created">Created</option>
                        </select>
                        <button
                            className="lv-icon-btn"
                            onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                            title={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
                        >
                            <ArrowUpDown size={13} />
                        </button>
                    </div>
                    <label className="dx-toggle">
                        <input
                            type="checkbox"
                            checked={showAll}
                            onChange={(e) => setShowAll(e.target.checked)}
                        />
                        <span>Include stopped</span>
                    </label>
                    <div className="dx-search-field">
                        <Search size={13} className="lv-search-field-icon" />
                        <input
                            type="text"
                            placeholder="Filter name, image, or ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button className="lv-search-field-clear" onClick={() => setSearchTerm('')} title="Clear search">
                                <X size={11} />
                            </button>
                        )}
                    </div>
                    <button
                        className="lv-icon-btn"
                        onClick={loadContainers}
                        title="Refresh"
                    >
                        <RefreshCw size={13} className={loading ? 'spinning' : ''} />
                    </button>
                </div>
            </div>

            {filteredContainers.length === 0 ? (
                <EmptyState
                    icon={Box}
                    title={containers.length === 0 ? 'No containers' : 'No matching containers'}
                    description={containers.length === 0
                        ? 'Run your first container to see it here.'
                        : 'No containers match the current filters.'}
                />
            ) : (
                <div className="dx-manager-layout">
                    <section className="dx-resource-list">
                        <div className="dx-table-wrap">
                            <table className="dx-manager-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Image</th>
                                        <th>Status</th>
                                        <th>Ports</th>
                                        <th>Resources</th>
                                        <th>Created</th>
                                        <th className="text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredContainers.map(container => {
                                        const containerId = getContainerId(container);
                                        const stats = parseStats(containerStats[containerId]);
                                        const isRunning = isContainerRunning(container);
                                        const ports = formatPorts(container.ports);
                                        const isSelected = getContainerId(selectedContainer) === containerId;
                                        return (
                                            <tr
                                                key={containerId}
                                                className={`${isRunning ? 'is-running' : 'is-stopped'} ${isSelected ? 'is-selected' : ''}`}
                                                onClick={() => setSelectedContainer(container)}
                                            >
                                                <td>
                                                    <div className="dx-name-stack">
                                                        <span className="dx-name-line">
                                                            {/* hue-hashed per-container identity dot (demo .dot-ico);
                                                                dims when stopped — status itself lives in the Status pill */}
                                                            <span
                                                                className={`dx-status-dot ${isRunning ? 'running' : 'stopped'}`}
                                                                style={{
                                                                    background: `hsl(${containerHue(getContainerName(container))} 60% 60%)`,
                                                                    boxShadow: isRunning
                                                                        ? `0 0 6px hsl(${containerHue(getContainerName(container))} 60% 60% / 0.55)`
                                                                        : 'none',
                                                                    opacity: isRunning ? 1 : 0.4,
                                                                }}
                                                            />
                                                            <span title={getContainerName(container)}>{getContainerName(container)}</span>
                                                        </span>
                                                        <span className="dx-muted-line mono">{shortId(containerId)}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="dx-code-pill" title={getContainerImage(container)}>
                                                        {getContainerImage(container)}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`dx-status-pill ${isRunning ? 'running' : 'stopped'}`}>
                                                        {getContainerStatusLabel(container)}
                                                    </span>
                                                    <span className="dx-muted-line">{getContainerStatus(container)}</span>
                                                </td>
                                                <td>
                                                    <div className="dx-port-list">
                                                        {ports.slice(0, 2).map((port, i) => (
                                                            <span key={i} className={`dx-port-pill ${port === '-' ? 'is-empty' : ''}`}>{port}</span>
                                                        ))}
                                                        {ports.length > 2 && <span className="dx-port-more">+{ports.length - 2}</span>}
                                                    </div>
                                                </td>
                                                <td>
                                                    <ContainerResourceBars stats={stats} muted={!isRunning} />
                                                </td>
                                                <td>
                                                    <span className="dx-muted-line">{container.created || container.CreatedAt || '-'}</span>
                                                </td>
                                                <td className="dx-row-actions" onClick={(e) => e.stopPropagation()}>
                                                    <button className="dx-row-action" onClick={() => setLogsContainer(container)} title="Logs">
                                                        <FileText size={13} />
                                                    </button>
                                                    {isRunning && !isRemote && (
                                                        <button className="dx-row-action" onClick={() => setExecContainer(container)} title="Exec">
                                                            <TerminalLucide size={13} />
                                                        </button>
                                                    )}
                                                    {isRunning ? (
                                                        <>
                                                            <button className="dx-row-action" onClick={() => handleAction(containerId, 'restart')} title="Restart">
                                                                <RotateCw size={13} />
                                                            </button>
                                                            <button className="dx-row-action is-danger" onClick={() => handleAction(containerId, 'stop')} title="Stop">
                                                                <Square size={13} />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button className="dx-row-action is-success" onClick={() => handleAction(containerId, 'start')} title="Start">
                                                                <Play size={13} />
                                                            </button>
                                                            <button className="dx-row-action is-danger" onClick={() => handleAction(containerId, 'remove')} title="Remove">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            )}

            {selectedContainer && (
                <ContainerInspector
                    container={selectedContainer}
                    stats={selectedStats}
                    onAction={handleAction}
                    onOpenLogs={setLogsContainer}
                    onOpenExec={setExecContainer}
                    onClose={() => setSelectedContainer(null)}
                />
            )}

            {logsContainer && (
                <ContainerLogsModal
                    container={logsContainer}
                    onClose={() => setLogsContainer(null)}
                />
            )}

            {execContainer && (
                <ContainerExecModal
                    container={execContainer}
                    onClose={() => setExecContainer(null)}
                />
            )}
            <ConfirmDialog
                isOpen={confirmContainerState.isOpen}
                title={confirmContainerState.title}
                message={confirmContainerState.message}
                confirmText={confirmContainerState.confirmText}
                cancelText={confirmContainerState.cancelText}
                variant={confirmContainerState.variant}
                onConfirm={handleContainerConfirm}
                onCancel={handleContainerCancel}
            />
        </div>
    );
};

const ContainerResourceBars = ({ stats, muted = false }) => (
    <div className={`dx-mini-resources ${muted || !stats.available ? 'is-muted' : ''}`}>
        <div className="dx-mini-resource">
            <span>CPU</span>
            <div className="dx-res-track">
                <div className="dx-res-fill cpu" style={{ width: `${stats.available ? Math.min(stats.cpu, 100) : 0}%` }} />
            </div>
            <strong>{stats.available ? `${stats.cpu.toFixed(1)}%` : '--'}</strong>
        </div>
        <div className="dx-mini-resource">
            <span>RAM</span>
            <div className="dx-res-track">
                <div className="dx-res-fill mem" style={{ width: `${stats.available ? Math.min(stats.memory, 100) : 0}%` }} />
            </div>
            <strong>{stats.available ? `${stats.memory.toFixed(1)}%` : '--'}</strong>
        </div>
    </div>
);

const maskEnvValue = (entry) => {
    const [key, ...rest] = String(entry).split('=');
    if (!rest.length) return entry;
    if (/pass|secret|token|key|credential/i.test(key)) {
        return `${key}=****`;
    }
    return entry;
};

const ContainerInspector = ({ container, stats, onAction, onOpenLogs, onOpenExec, onClose }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(false);
    const [activeSection, setActiveSection] = useState('overview');
    const containerId = container ? getContainerId(container) : '';

    useEffect(() => {
        let mounted = true;
        let loadingTimer;

        async function loadDetails() {
            if (!container) {
                setDetails(null);
                return;
            }

            setLoading(true);
            loadingTimer = window.setTimeout(() => {
                if (mounted) setLoading(false);
            }, 2500);
            setActiveSection('overview');
            try {
                let data;
                if (isRemote) {
                    data = unwrapRemoteData(await api.getRemoteContainer(serverId, containerId));
                } else {
                    const result = await api.getContainer(containerId);
                    data = result.container || result;
                }
                if (mounted) setDetails(data || null);
            } catch (err) {
                console.error('Failed to inspect container:', err);
                if (mounted) setDetails(null);
            } finally {
                window.clearTimeout(loadingTimer);
                if (mounted) setLoading(false);
            }
        }

        loadDetails();
        return () => {
            mounted = false;
            window.clearTimeout(loadingTimer);
        };
    }, [container, containerId, serverId, isRemote]);

    if (!container) {
        return null;
    }

    const isRunning = isContainerRunning(container);
    const ports = formatPorts(container.ports);
    const envVars = details?.Config?.Env || [];
    const mounts = details?.Mounts || [];
    const networks = Object.entries(details?.NetworkSettings?.Networks || {});
    const labels = details?.Config?.Labels || {};
    const restartPolicy = details?.HostConfig?.RestartPolicy?.Name || '-';
    const health = details?.State?.Health?.Status || getContainerStatusLabel(container);
    const projectName = getContainerProjectName(container, details);

    async function copyContainerId() {
        try {
            await navigator.clipboard.writeText(containerId);
            toast.success('Container ID copied');
        } catch {
            toast.error('Could not copy container ID');
        }
    }

    return (
        <>
        <div className="dx-drawer-backdrop" onClick={onClose} />
        <aside className="dx-inspector dx-inspector-drawer">
            <div className="dx-inspector-header">
                <div className="dx-inspector-icon">
                    <Box size={18} />
                </div>
                <div className="dx-inspector-title">
                    <h3 title={getContainerName(container)}>{getContainerName(container)}</h3>
                    <span>{shortId(containerId)}</span>
                </div>
                <button className="dx-row-action" onClick={copyContainerId} title="Copy container ID">
                    <Copy size={13} />
                </button>
                <button className="dx-row-action" onClick={onClose} title="Close details">
                    <X size={13} />
                </button>
            </div>

            <div className="dx-inspector-status">
                <span className={`dx-status-pill ${isRunning ? 'running' : 'stopped'}`}>
                    {getContainerStatusLabel(container)}
                </span>
                <span>{health}</span>
            </div>

            <div className="dx-inspector-actions">
                <button className="dx-action-btn" onClick={() => onOpenLogs(container)}>
                    <FileText size={13} /> Logs
                </button>
                {isRunning && !isRemote && (
                    <button className="dx-action-btn" onClick={() => onOpenExec(container)}>
                        <TerminalLucide size={13} /> Exec
                    </button>
                )}
                {isRunning ? (
                    <>
                        <button className="dx-action-btn" onClick={() => onAction(containerId, 'restart')}>
                            <RotateCw size={13} /> Restart
                        </button>
                        <button className="dx-action-btn is-danger" onClick={() => onAction(containerId, 'stop')}>
                            <Square size={13} /> Stop
                        </button>
                    </>
                ) : (
                    <>
                        <button className="dx-action-btn is-success" onClick={() => onAction(containerId, 'start')}>
                            <Play size={13} /> Start
                        </button>
                        <button className="dx-action-btn is-danger" onClick={() => onAction(containerId, 'remove')}>
                            <Trash2 size={13} /> Remove
                        </button>
                    </>
                )}
            </div>

            <div className="dx-inspector-tabs">
                {['overview', 'ports', 'mounts', 'env'].map(section => (
                    <button
                        key={section}
                        className={activeSection === section ? 'active' : ''}
                        onClick={() => setActiveSection(section)}
                    >
                        {section}
                    </button>
                ))}
            </div>

            <div className="dx-inspector-body">
                {loading && <div className="dx-inspector-loading">Inspecting container...</div>}

                {activeSection === 'overview' && (
                    <>
                        <ContainerResourceBars stats={stats} muted={!isRunning} />
                        <div className="dx-detail-grid">
                            <div><span>Image</span><strong title={getContainerImage(container)}>{getContainerImage(container)}</strong></div>
                            <div><span>Project</span><strong>{projectName}</strong></div>
                            <div><span>Restart</span><strong>{restartPolicy}</strong></div>
                            <div><span>Created</span><strong>{container.created || container.CreatedAt || '-'}</strong></div>
                        </div>
                        <div className="dx-section-title"><Gauge size={13} /> Runtime</div>
                        <div className="dx-details-list">
                            <span>Status</span><code>{getContainerStatus(container)}</code>
                            <span>PID</span><code>{details?.State?.Pid || '-'}</code>
                            <span>Platform</span><code>{details?.Platform || details?.Os || '-'}</code>
                            <span>Driver</span><code>{details?.Driver || '-'}</code>
                        </div>
                    </>
                )}

                {activeSection === 'ports' && (
                    <>
                        <div className="dx-section-title"><Activity size={13} /> Published ports</div>
                        <div className="dx-inspector-list">
                            {ports.map((port, index) => (
                                <code key={index} className={port === '-' ? 'is-empty' : ''}>{port}</code>
                            ))}
                        </div>
                        <div className="dx-section-title"><ServerIcon size={13} /> Networks</div>
                        <div className="dx-details-list">
                            {networks.length === 0 ? (
                                <>
                                    <span>Networks</span><code>-</code>
                                </>
                            ) : networks.map(([name, network]) => (
                                <React.Fragment key={name}>
                                    <span>{name}</span>
                                    <code>{network?.IPAddress || network?.Gateway || '-'}</code>
                                </React.Fragment>
                            ))}
                        </div>
                    </>
                )}

                {activeSection === 'mounts' && (
                    <>
                        <div className="dx-section-title"><Database size={13} /> Mounts and volumes</div>
                        <div className="dx-inspector-list">
                            {mounts.length === 0 ? (
                                <code className="is-empty">No mounts</code>
                            ) : mounts.map((mount, index) => (
                                <code key={index}>
                                    {mount.Name || mount.Source || '-'} -&gt; {mount.Destination || '-'}
                                </code>
                            ))}
                        </div>
                    </>
                )}

                {activeSection === 'env' && (
                    <>
                        <div className="dx-section-title"><Package size={13} /> Environment</div>
                        <div className="dx-inspector-list">
                            {envVars.length === 0 ? (
                                <code className="is-empty">No environment variables</code>
                            ) : envVars.slice(0, 24).map((entry, index) => (
                                <code key={index}>{maskEnvValue(entry)}</code>
                            ))}
                            {envVars.length > 24 && <code>+{envVars.length - 24} more variables</code>}
                        </div>
                        <div className="dx-section-title"><Clock3 size={13} /> Labels</div>
                        <div className="dx-details-list">
                            {Object.keys(labels).length === 0 ? (
                                <>
                                    <span>Labels</span><code>-</code>
                                </>
                            ) : Object.entries(labels).slice(0, 12).map(([key, value]) => (
                                <React.Fragment key={key}>
                                    <span title={key}>{key}</span>
                                    <code title={value}>{value}</code>
                                </React.Fragment>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </aside>
        </>
    );
};

// Images Tab
const ImagesTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmImage, confirmState: confirmImageState, handleConfirm: handleImageConfirm, handleCancel: handleImageCancel } = useConfirm();
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadImages();
    }, [serverId]);

    async function loadImages() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteImages(serverId);
                data = { images: normalizeListResponse(result, 'images') };
            } else {
                data = await api.getImages();
            }
            setImages(data.images || []);
        } catch (err) {
            console.error('Failed to load images:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(imageId) {
        const confirmed = await confirmImage({ title: 'Remove Image', message: 'Remove this image?' });
        if (!confirmed) return;

        try {
            if (isRemote) {
                await api.removeRemoteImage(serverId, imageId, true);
            } else {
                await api.removeImage(imageId, true);
            }
            toast.success('Image removed successfully');
            loadImages();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove image:', err);
            toast.error('Failed to remove image. It may be in use by a container.');
        }
    }

    const filteredImages = images.filter(img => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return img.repository?.toLowerCase().includes(search) ||
               img.tag?.toLowerCase().includes(search) ||
               img.id?.toLowerCase().includes(search);
    });

    if (loading) {
        return <div className="docker-loading">Loading images...</div>;
    }

    return (
        <div>
            <div className="docker-table-header">
                <div />
                <Input
                    type="text"
                    className="docker-search"
                    placeholder="Search images..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {filteredImages.length === 0 ? (
                <EmptyState
                    icon={Layers}
                    title="No images"
                    description="Pull an image to see it here."
                />
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Repository</th>
                            <th>Tag</th>
                            <th>Image ID</th>
                            <th>Size</th>
                            <th>Created</th>
                            <th className="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredImages.map(image => (
                            <tr key={image.id}>
                                <td>
                                    <span className="docker-container-name">{image.repository || '<none>'}</span>
                                </td>
                                <td>
                                    <span className="docker-image-tag">{image.tag || '<none>'}</span>
                                </td>
                                <td>
                                    <span className="docker-container-id">{image.id?.substring(0, 12)}</span>
                                </td>
                                <td>{image.size}</td>
                                <td>{image.created}</td>
                                <td className="docker-actions-cell">
                                    <IconAction title="Delete" onClick={() => handleRemove(image.id)} color="#EF4444">
                                        <TrashIcon />
                                    </IconAction>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <ConfirmDialog
                isOpen={confirmImageState.isOpen}
                title={confirmImageState.title}
                message={confirmImageState.message}
                confirmText={confirmImageState.confirmText}
                cancelText={confirmImageState.cancelText}
                variant={confirmImageState.variant}
                onConfirm={handleImageConfirm}
                onCancel={handleImageCancel}
            />
        </div>
    );
};

// Networks Tab
const NetworksTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmNetwork, confirmState: confirmNetworkState, handleConfirm: handleNetworkConfirm, handleCancel: handleNetworkCancel } = useConfirm();
    const [networks, setNetworks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadNetworks();
    }, [serverId]);

    async function loadNetworks() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteNetworks(serverId);
                data = { networks: normalizeListResponse(result, 'networks') };
            } else {
                data = await api.getNetworks();
            }
            setNetworks(data.networks || []);
        } catch (err) {
            console.error('Failed to load networks:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(networkId) {
        const confirmed = await confirmNetwork({ title: 'Remove Network', message: 'Remove this network?' });
        if (!confirmed) return;

        try {
            if (isRemote) {
                await api.removeRemoteNetwork(serverId, networkId);
            } else {
                await api.removeNetwork(networkId);
            }
            toast.success('Network removed successfully');
            loadNetworks();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove network:', err);
            toast.error('Failed to remove network. It may be in use.');
        }
    }

    const systemNetworks = ['bridge', 'host', 'none'];

    if (loading) {
        return <div className="docker-loading">Loading networks...</div>;
    }

    return (
        <div>
            {networks.length === 0 ? (
                <EmptyState
                    icon={NetworkIcon}
                    title="No networks"
                    description="Create a network to connect containers."
                />
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Network ID</th>
                            <th>Driver</th>
                            <th>Scope</th>
                            <th className="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {networks.map(network => (
                            <tr key={network.id}>
                                <td>
                                    <span className="docker-container-name">{network.name}</span>
                                </td>
                                <td>
                                    <span className="docker-container-id">{network.id?.substring(0, 12)}</span>
                                </td>
                                <td>{network.driver}</td>
                                <td>{network.scope}</td>
                                <td className="docker-actions-cell">
                                    {!systemNetworks.includes(network.name) && (
                                        <IconAction title="Delete" onClick={() => handleRemove(network.id)} color="#EF4444">
                                            <TrashIcon />
                                        </IconAction>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <ConfirmDialog
                isOpen={confirmNetworkState.isOpen}
                title={confirmNetworkState.title}
                message={confirmNetworkState.message}
                confirmText={confirmNetworkState.confirmText}
                cancelText={confirmNetworkState.cancelText}
                variant={confirmNetworkState.variant}
                onConfirm={handleNetworkConfirm}
                onCancel={handleNetworkCancel}
            />
        </div>
    );
};

// Volumes Tab
const VolumesTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmVolume, confirmState: confirmVolumeState, handleConfirm: handleVolumeConfirm, handleCancel: handleVolumeCancel } = useConfirm();
    const [volumes, setVolumes] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadVolumes();
    }, [serverId]);

    async function loadVolumes() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteVolumes(serverId);
                data = { volumes: normalizeListResponse(result, 'volumes') };
            } else {
                data = await api.getVolumes();
            }
            setVolumes(data.volumes || []);
        } catch (err) {
            console.error('Failed to load volumes:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(volumeName) {
        const confirmed = await confirmVolume({ title: 'Remove Volume', message: 'Remove this volume? All data will be lost.' });
        if (!confirmed) return;

        try {
            if (isRemote) {
                await api.removeRemoteVolume(serverId, volumeName, true);
            } else {
                await api.removeVolume(volumeName, true);
            }
            toast.success('Volume removed successfully');
            loadVolumes();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove volume:', err);
            toast.error('Failed to remove volume. It may be in use.');
        }
    }

    if (loading) {
        return <div className="docker-loading">Loading volumes...</div>;
    }

    return (
        <div>
            {volumes.length === 0 ? (
                <EmptyState
                    icon={HardDrive}
                    title="No volumes"
                    description="Create a volume for persistent data storage."
                />
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Driver</th>
                            <th>Mountpoint</th>
                            <th className="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {volumes.map(volume => (
                            <tr key={volume.name}>
                                <td>
                                    <span className="docker-container-name">{volume.name}</span>
                                </td>
                                <td>{volume.driver}</td>
                                <td>
                                    <span className="docker-container-id truncate inline-block" style={{ maxWidth: '300px' }}>
                                        {volume.mountpoint || '-'}
                                    </span>
                                </td>
                                <td className="docker-actions-cell">
                                    <IconAction title="Delete" onClick={() => handleRemove(volume.name)} color="#EF4444">
                                        <TrashIcon />
                                    </IconAction>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <ConfirmDialog
                isOpen={confirmVolumeState.isOpen}
                title={confirmVolumeState.title}
                message={confirmVolumeState.message}
                confirmText={confirmVolumeState.confirmText}
                cancelText={confirmVolumeState.cancelText}
                variant={confirmVolumeState.variant}
                onConfirm={handleVolumeConfirm}
                onCancel={handleVolumeCancel}
            />
        </div>
    );
};

// Compose Tab
const ComposeTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmCompose, confirmState: confirmComposeState, handleConfirm: handleComposeConfirm, handleCancel: handleComposeCancel } = useConfirm();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [logsProject, setLogsProject] = useState(null);
    const [actionLoading, setActionLoading] = useState({});

    useEffect(() => {
        loadProjects();
    }, [serverId]);

    async function loadProjects() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                data = await api.getRemoteComposeProjects(serverId);
            } else {
                data = await api.composeList();
            }
            setProjects(normalizeListResponse(data, 'projects'));
        } catch (err) {
            console.error('Failed to load compose projects:', err);
            setProjects([]);
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(project, action) {
        const projectPath = project.ConfigFiles || project.config_files;
        if (!projectPath) {
            toast.error('Project path not found');
            return;
        }

        setActionLoading(prev => ({ ...prev, [project.Name || project.name]: true }));

        try {
            if (action === 'up') {
                if (isRemote) {
                    await api.remoteComposeUp(serverId, projectPath);
                } else {
                    await api.composeUp(projectPath, true, false);
                }
                toast.success('Project started');
            } else if (action === 'down') {
                const downConfirmed = await confirmCompose({ title: 'Stop Compose Project', message: 'Stop this compose project? Containers will be removed.' });
                if (!downConfirmed) {
                    setActionLoading(prev => ({ ...prev, [project.Name || project.name]: false }));
                    return;
                }
                if (isRemote) {
                    await api.remoteComposeDown(serverId, projectPath);
                } else {
                    await api.composeDown(projectPath, false, true);
                }
                toast.success('Project stopped');
            } else if (action === 'restart') {
                if (isRemote) {
                    await api.remoteComposeRestart(serverId, projectPath);
                } else {
                    await api.composeRestart(projectPath);
                }
                toast.success('Project restarted');
            } else if (action === 'pull') {
                if (isRemote) {
                    await api.remoteComposePull(serverId, projectPath);
                } else {
                    await api.composePull(projectPath);
                }
                toast.success('Images pulled');
            }
            loadProjects();
            onStatsChange?.();
        } catch (err) {
            console.error(`Failed to ${action} project:`, err);
            toast.error(err.message || `Failed to ${action} project`);
        } finally {
            setActionLoading(prev => ({ ...prev, [project.Name || project.name]: false }));
        }
    }

    function getProjectStatus(project) {
        const status = project.Status || project.status || '';
        if (status.includes('running')) return 'running';
        if (status.includes('exited') || status.includes('stopped')) return 'exited';
        return 'unknown';
    }

    function parseRunningCount(status) {
        // Parse status like "running(3)" or "exited(2), running(1)"
        const match = status.match(/running\((\d+)\)/);
        return match ? parseInt(match[1], 10) : 0;
    }

    if (loading) {
        return <div className="docker-loading">Loading compose projects...</div>;
    }

    return (
        <div>
            <div className="docker-table-header">
                <div className="docker-table-info">
                    {projects.length} project{projects.length !== 1 ? 's' : ''} found
                </div>
                <Button variant="outline" size="sm" onClick={loadProjects}>
                    Refresh
                </Button>
            </div>

            {projects.length === 0 ? (
                <EmptyState
                    icon={Package}
                    title="No Compose projects"
                    description="No Docker Compose projects are running on this server."
                    action={<code>docker compose up -d</code>}
                />
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Project</th>
                            <th>Status</th>
                            <th>Config File</th>
                            <th className="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.map(project => {
                            const name = project.Name || project.name;
                            const status = project.Status || project.status || 'unknown';
                            const configFiles = project.ConfigFiles || project.config_files || '';
                            const isRunning = getProjectStatus(project) === 'running';
                            const runningCount = parseRunningCount(status);
                            const isLoading = actionLoading[name];

                            return (
                                <tr key={name}>
                                    <td>
                                        <span className="docker-container-name">{name}</span>
                                    </td>
                                    <td>
                                        <span className={`docker-status-pill ${isRunning ? 'running' : 'exited'}`}>
                                            <span className="docker-status-dot" />
                                            {isRunning ? `Running (${runningCount})` : 'Stopped'}
                                        </span>
                                        <div className="docker-status-detail">{status}</div>
                                    </td>
                                    <td>
                                        <span className="docker-container-id truncate inline-block" style={{ maxWidth: '300px' }}>
                                            {configFiles}
                                        </span>
                                    </td>
                                    <td className="docker-actions-cell">
                                        <IconAction
                                            title="Logs"
                                            onClick={() => setLogsProject(project)}
                                            disabled={isLoading}
                                        >
                                            <FileText size={14} />
                                        </IconAction>
                                        {isRunning ? (
                                            <>
                                                <IconAction
                                                    title="Restart"
                                                    onClick={() => handleAction(project, 'restart')}
                                                    disabled={isLoading}
                                                >
                                                    <RotateCw size={14} />
                                                </IconAction>
                                                <IconAction
                                                    title="Stop"
                                                    onClick={() => handleAction(project, 'down')}
                                                    disabled={isLoading}
                                                    color="#EF4444"
                                                >
                                                    <Square size={14} />
                                                </IconAction>
                                            </>
                                        ) : (
                                            <IconAction
                                                title="Start"
                                                onClick={() => handleAction(project, 'up')}
                                                disabled={isLoading}
                                                color="#10B981"
                                            >
                                                <Play size={14} />
                                            </IconAction>
                                        )}
                                        <IconAction
                                            title="Pull Images"
                                            onClick={() => handleAction(project, 'pull')}
                                            disabled={isLoading}
                                        >
                                            <DownloadIcon />
                                        </IconAction>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {logsProject && (
                <ComposeLogsModal
                    project={logsProject}
                    onClose={() => setLogsProject(null)}
                />
            )}
            <ConfirmDialog
                isOpen={confirmComposeState.isOpen}
                title={confirmComposeState.title}
                message={confirmComposeState.message}
                confirmText={confirmComposeState.confirmText}
                cancelText={confirmComposeState.cancelText}
                variant={confirmComposeState.variant}
                onConfirm={handleComposeConfirm}
                onCancel={handleComposeCancel}
            />
        </div>
    );
};

// Download Icon for Compose Pull
const DownloadIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
);

// Compose Logs Modal
const ComposeLogsModal = ({ project, onClose }) => {
    const { serverId, isRemote } = useServer();
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [tail, setTail] = useState(200);
    const [selectedService, setSelectedService] = useState('');
    const [services, setServices] = useState([]);

    const projectName = project.Name || project.name;
    const projectPath = project.ConfigFiles || project.config_files || '';

    useEffect(() => {
        loadServices();
        loadLogs();
    }, [project, tail, selectedService]);

    async function loadServices() {
        try {
            let containers;
            if (isRemote) {
                containers = normalizeListResponse(
                    await api.getRemoteComposePs(serverId, projectPath),
                    'containers'
                );
            } else {
                const result = await api.composePs(projectPath);
                containers = result.containers || result || [];
            }

            // Extract unique service names
            const serviceNames = [...new Set(
                (Array.isArray(containers) ? containers : [])
                    .map(c => c.Service || c.service)
                    .filter(Boolean)
            )];
            setServices(serviceNames);
        } catch (err) {
            console.error('Failed to load services:', err);
        }
    }

    async function loadLogs() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                data = unwrapRemoteData(await api.remoteComposeLogs(serverId, projectPath, selectedService || null, tail));
            } else {
                data = await api.composeLogs(projectPath, selectedService || null, tail);
            }
            setLogs(data.logs || 'No logs available');
        } catch (err) {
            setLogs('Failed to load logs: ' + (err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Logs: {projectName}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    <div className="logs-controls flex flex-wrap items-center gap-2 mb-2">
                        <label>Service:</label>
                        <select
                            value={selectedService}
                            onChange={(e) => setSelectedService(e.target.value)}
                            className="py-2 px-2"
                        >
                            <option value="">All Services</option>
                            {services.map(service => (
                                <option key={service} value={service}>{service}</option>
                            ))}
                        </select>
                        <label>Lines:</label>
                        <select value={tail} onChange={(e) => setTail(Number(e.target.value))} className="py-2 px-2">
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                            <option value={1000}>1000</option>
                        </select>
                    </div>
                    <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
                </div>
                <div className="modal-actions">
                    <Button variant="outline" onClick={loadLogs} disabled={loading}>
                        {loading ? 'Loading...' : 'Refresh'}
                    </Button>
                    <Button onClick={onClose}>Close</Button>
                </div>
            </div>
        </div>
    );
};

// Modals
const RunContainerModal = ({ onClose, onCreated }) => {
    const [formData, setFormData] = useState({
        image: '',
        name: '',
        ports: '',
        volumes: '',
        env: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    function handleChange(e) {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const data = {
                image: formData.image,
                name: formData.name || undefined,
                ports: formData.ports ? formData.ports.split(',').map(p => p.trim()) : [],
                volumes: formData.volumes ? formData.volumes.split(',').map(v => v.trim()) : [],
                env: formData.env ? Object.fromEntries(
                    formData.env.split('\n').filter(l => l.includes('=')).map(l => {
                        const [key, ...rest] = l.split('=');
                        return [key.trim(), rest.join('=').trim()];
                    })
                ) : {},
            };

            await api.runContainer(data);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to run container');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Run Container</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Image *</label>
                        <Input
                            type="text"
                            name="image"
                            value={formData.image}
                            onChange={handleChange}
                            placeholder="nginx:latest"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Container Name</label>
                        <Input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="my-container"
                        />
                    </div>

                    <div className="form-group">
                        <label>Ports (comma-separated)</label>
                        <Input
                            type="text"
                            name="ports"
                            value={formData.ports}
                            onChange={handleChange}
                            placeholder="8080:80, 443:443"
                        />
                    </div>

                    <div className="form-group">
                        <label>Volumes (comma-separated)</label>
                        <Input
                            type="text"
                            name="volumes"
                            value={formData.volumes}
                            onChange={handleChange}
                            placeholder="/host/path:/container/path"
                        />
                    </div>

                    <div className="form-group">
                        <label>Environment Variables (one per line, KEY=value)</label>
                        <Textarea
                            name="env"
                            value={formData.env}
                            onChange={handleChange}
                            placeholder="NODE_ENV=production&#10;API_KEY=xxx"
                            rows={4}
                        />
                    </div>

                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Running...' : 'Run Container'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const ContainerLogsModal = ({ container, onClose }) => {
    const { serverId, isRemote } = useServer();
    const containerId = getContainerId(container);
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [tail, setTail] = useState(200);
    const [searchPattern, setSearchPattern] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [showLineNumbers, setShowLineNumbers] = useState(true);
    const [wrapLines, setWrapLines] = useState(true);
    const contentRef = useRef(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        loadLogs();
    }, [container, tail]); // eslint-disable-line

    useEffect(() => {
        if (autoRefresh) {
            intervalRef.current = setInterval(() => loadLogs(false), 3000);
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [autoRefresh, tail]); // eslint-disable-line

    async function loadLogs(showSpinner = true) {
        if (showSpinner) setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteContainerLogs(serverId, containerId, tail);
                data = unwrapRemoteData(result);
            } else {
                data = await api.getContainerLogs(containerId, tail);
            }
            setLogs(data.logs || '');
            if (autoRefresh && contentRef.current) {
                contentRef.current.scrollTop = contentRef.current.scrollHeight;
            }
        } catch (err) {
            setLogs('Failed to load logs: ' + (err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }

    function handleDownload() {
        if (!logs) return;
        const blob = new Blob([logs], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${container.name}-${Date.now()}.log`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <>
            <div className="preview-drawer-backdrop" onClick={onClose} />
            <aside className="preview-drawer">
                <header className="preview-drawer-header">
                    <Box size={20} style={{ color: 'var(--accent-primary)' }} />
                    <div className="preview-drawer-title">
                        <h3>{getContainerName(container)}</h3>
                        <p className="preview-drawer-path">{getContainerImage(container)} - {shortId(containerId)}</p>
                    </div>
                    <button className="preview-drawer-close" onClick={onClose}>
                        <X size={18} />
                    </button>
                </header>

                <div className="preview-drawer-meta">
                    <div className="meta-item">
                        <span className="meta-label">Status</span>
                        <span className="meta-value">{getContainerStatus(container)}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">Image</span>
                        <span className="meta-value mono">{getContainerImage(container)}</span>
                    </div>
                    <div className="meta-item meta-item-wide">
                        <span className="meta-label">ID</span>
                        <span className="meta-value mono">{containerId}</span>
                    </div>
                    {container.ports && container.ports.length > 0 && (
                        <div className="meta-item meta-item-wide">
                            <span className="meta-label">Ports</span>
                            <span className="meta-value mono">{formatPorts(container.ports).join(', ')}</span>
                        </div>
                    )}
                </div>

                <LogToolbar
                    searchPattern={searchPattern}
                    onSearchChange={setSearchPattern}
                    onSearchSubmit={() => setAppliedSearch(searchPattern)}
                    onSearchClear={() => { setSearchPattern(''); setAppliedSearch(''); }}
                    lineCount={tail}
                    onLineCountChange={(n) => setTail(n)}
                    autoRefresh={autoRefresh}
                    onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
                    showLineNumbers={showLineNumbers}
                    onToggleLineNumbers={() => setShowLineNumbers(!showLineNumbers)}
                    wrapLines={wrapLines}
                    onToggleWrap={() => setWrapLines(!wrapLines)}
                    isFullscreen={false}
                    onToggleFullscreen={() => {}}
                    onRefresh={() => loadLogs()}
                    onDownload={handleDownload}
                    onClear={() => {}}
                    onScrollToBottom={() => {
                        if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
                    }}
                    canAct={true}
                />

                <div className="preview-drawer-body">
                    <LogContent
                        ref={contentRef}
                        content={logs}
                        loading={loading}
                        emptyMessage="No log output."
                        showLineNumbers={showLineNumbers}
                        wrapLines={wrapLines}
                        searchPattern={appliedSearch}
                    />
                </div>
            </aside>
        </>
    );
};

const ContainerExecModal = ({ container, onClose }) => {
    const containerId = getContainerId(container);
    const [command, setCommand] = useState('');
    const [output, setOutput] = useState([]);
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const outputRef = React.useRef(null);
    const inputRef = React.useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    async function executeCommand(e) {
        e.preventDefault();
        if (!command.trim() || loading) return;

        const cmd = command.trim();
        setOutput(prev => [...prev, { type: 'command', text: `$ ${cmd}` }]);
        setHistory(prev => [cmd, ...prev.slice(0, 49)]);
        setHistoryIndex(-1);
        setCommand('');
        setLoading(true);

        try {
            const result = await api.execContainer(containerId, cmd);
            const stdout = result.output ?? result.stdout;
            const stderr = result.error ?? result.stderr;
            const exitCode = result.exit_code ?? result.return_code;
            if (stdout) {
                setOutput(prev => [...prev, { type: 'output', text: stdout }]);
            }
            if (stderr) {
                setOutput(prev => [...prev, { type: 'error', text: stderr }]);
            }
            if (exitCode !== undefined && exitCode !== 0) {
                setOutput(prev => [...prev, { type: 'info', text: `Exit code: ${exitCode}` }]);
            }
        } catch (err) {
            setOutput(prev => [...prev, { type: 'error', text: err.message || 'Failed to execute command' }]);
        } finally {
            setLoading(false);
            if (inputRef.current) {
                inputRef.current.focus();
            }
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (history.length > 0 && historyIndex < history.length - 1) {
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                setCommand(history[newIndex]);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setCommand(history[newIndex]);
            } else if (historyIndex === 0) {
                setHistoryIndex(-1);
                setCommand('');
            }
        }
    }

    function clearOutput() {
        setOutput([]);
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Exec: {getContainerName(container)}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body exec-modal-body">
                    <div className="exec-output" ref={outputRef}>
                        {output.length === 0 ? (
                            <div className="exec-welcome">
                                <p>Execute commands in container <code>{getContainerName(container)}</code></p>
                                <p className="text-muted">Type a command and press Enter</p>
                            </div>
                        ) : (
                            output.map((line, idx) => (
                                <div key={idx} className={`exec-line exec-${line.type}`}>
                                    <pre>{line.text}</pre>
                                </div>
                            ))
                        )}
                        {loading && (
                            <div className="exec-line exec-loading">
                                <span className="spinner-inline"></span> Running...
                            </div>
                        )}
                    </div>
                    <form onSubmit={executeCommand} className="exec-input-form">
                        <span className="exec-prompt">$</span>
                        <input
                            ref={inputRef}
                            type="text"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Enter command..."
                            className="exec-input"
                            disabled={loading}
                            autoComplete="off"
                            spellCheck="false"
                        />
                        <Button type="submit" size="sm" disabled={loading || !command.trim()}>
                            Run
                        </Button>
                    </form>
                </div>
                <div className="modal-actions">
                    <Button variant="outline" onClick={clearOutput}>Clear</Button>
                    <Button onClick={onClose}>Close</Button>
                </div>
            </div>
        </div>
    );
};

const PullImageModal = ({ onClose, onPulled }) => {
    const { serverId, isRemote } = useServer();
    const [image, setImage] = useState('');
    const [tag, setTag] = useState('latest');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isRemote) {
                const fullImage = tag ? `${image}:${tag}` : image;
                await api.pullRemoteImage(serverId, fullImage);
            } else {
                await api.pullImage(image, tag);
            }
            onPulled();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to pull image');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Pull Image</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Image Name *</label>
                        <Input
                            type="text"
                            value={image}
                            onChange={(e) => setImage(e.target.value)}
                            placeholder="nginx, mysql, redis"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Tag</label>
                        <Input
                            type="text"
                            value={tag}
                            onChange={(e) => setTag(e.target.value)}
                            placeholder="latest"
                        />
                    </div>

                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Pulling...' : 'Pull Image'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreateNetworkModal = ({ onClose, onCreated }) => {
    const [name, setName] = useState('');
    const [driver, setDriver] = useState('bridge');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.createNetwork(name, driver);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create network');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Network</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Network Name *</label>
                        <Input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="my-network"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Driver</label>
                        <select value={driver} onChange={(e) => setDriver(e.target.value)}>
                            <option value="bridge">bridge</option>
                            <option value="overlay">overlay</option>
                            <option value="macvlan">macvlan</option>
                        </select>
                    </div>

                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Network'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreateVolumeModal = ({ onClose, onCreated }) => {
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.createVolume(name);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create volume');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Volume</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Volume Name *</label>
                        <Input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="my-volume"
                            required
                        />
                    </div>

                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Volume'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Docker;
