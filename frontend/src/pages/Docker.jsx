import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import TargetPicker from '../components/TargetPicker';
import LogToolbar from '../components/log-viewer/LogToolbar';
import LogContent from '../components/log-viewer/LogContent';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Box, Layers, HardDrive, Network as NetworkIcon, Search, X, RefreshCw,
    Trash2, Play, Square, RotateCw, Terminal as TerminalLucide, FileText,
    Cpu,
} from 'lucide-react';

// Server context for Docker operations
const ServerContext = createContext({ serverId: 'local', serverName: 'Local' });
const useServer = () => useContext(ServerContext);

const VALID_TABS = ['containers', 'compose', 'images', 'volumes', 'networks'];

const unwrapRemoteData = (response) => {
    if (response?.success && response.data !== undefined) {
        return response.data;
    }
    return response;
};

const normalizeListResponse = (response, key) => {
    const data = unwrapRemoteData(response);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[key])) return data[key];
    return [];
};

const Docker = () => {
    const [activeTab, setActiveTab] = useTabParam('/docker', VALID_TABS);
    const [dockerStatus, setDockerStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [servers, setServers] = useState([]);
    const [selectedServer, setSelectedServer] = useState({ id: 'local', name: 'Local (this server)' });
    const [stats, setStats] = useState({
        containers: { total: 0, running: 0, stopped: 0 },
        images: { total: 0, size: '0 B' },
        volumes: { total: 0 },
        networks: { total: 0 }
    });

    useEffect(() => {
        loadServers();
    }, []);

    useEffect(() => {
        checkDockerStatus();
    }, [selectedServer]);

    async function loadServers() {
        try {
            const data = await api.getAvailableServers();
            setServers(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load servers:', err);
            // Default to just local
            setServers([{ id: 'local', name: 'Local (this server)', status: 'online' }]);
        }
    }

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
        { id: 'containers', label: 'Containers' },
        { id: 'compose', label: 'Compose' },
        { id: 'images', label: 'Images' },
        { id: 'volumes', label: 'Volumes' },
        { id: 'networks', label: 'Networks' }
    ];

    const serverContextValue = {
        serverId: selectedServer.id,
        serverName: selectedServer.name,
        isRemote: selectedServer.id !== 'local'
    };

    return (
        <ServerContext.Provider value={serverContextValue}>
        <div className="page-container docker-page-new dx-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Docker</h1>
                    <p className="page-description">Manage containers, images, networks, and volumes</p>
                </div>
                <div className="page-header-actions">
                    {activeTab === 'containers' && <RunContainerButton />}
                    {activeTab === 'images' && <PullImageButton />}
                    {activeTab === 'networks' && <CreateNetworkButton />}
                    {activeTab === 'volumes' && <CreateVolumeButton />}
                </div>
            </div>

            <div className="lv-header">
                <div className="lv-header-target">
                    <span className="lv-header-label">Server</span>
                    <TargetPicker
                        feature="docker"
                        value={selectedServer.id === 'local'
                            ? { kind: 'local' }
                            : { kind: 'agent', server_id: selectedServer.id, name: selectedServer.name }}
                        onChange={(v) => {
                            if (v.kind === 'local') setSelectedServer({ id: 'local', name: 'Local (this server)' });
                            else setSelectedServer({ id: v.server_id, name: v.name });
                        }}
                    />
                </div>
                <div className="lv-header-stats">
                    <PruneButton onPruned={loadStats} />
                </div>
            </div>

            <div className="dx-stats-row">
                <div className="dx-stat" data-kind="containers">
                    <div className="dx-stat-icon"><Box size={18} /></div>
                    <div className="dx-stat-body">
                        <div className="dx-stat-label">Containers</div>
                        <div className="dx-stat-value">{stats.containers.total}</div>
                        <div className="dx-stat-meta">
                            <span className="dx-pill running"><span className="dot" />{stats.containers.running} running</span>
                            <span className="dx-pill stopped"><span className="dot" />{stats.containers.stopped} stopped</span>
                        </div>
                    </div>
                </div>
                <div className="dx-stat" data-kind="images">
                    <div className="dx-stat-icon"><Layers size={18} /></div>
                    <div className="dx-stat-body">
                        <div className="dx-stat-label">Images</div>
                        <div className="dx-stat-value">{stats.images.total}</div>
                        <div className="dx-stat-meta">
                            <span className="dx-stat-sub">{stats.images.size} on disk</span>
                        </div>
                    </div>
                </div>
                <div className="dx-stat" data-kind="volumes">
                    <div className="dx-stat-icon"><HardDrive size={18} /></div>
                    <div className="dx-stat-body">
                        <div className="dx-stat-label">Volumes</div>
                        <div className="dx-stat-value">{stats.volumes.total}</div>
                        <div className="dx-stat-meta">
                            <span className="dx-stat-sub">Persistent data</span>
                        </div>
                    </div>
                </div>
                <div className="dx-stat" data-kind="networks">
                    <div className="dx-stat-icon"><NetworkIcon size={18} /></div>
                    <div className="dx-stat-body">
                        <div className="dx-stat-label">Networks</div>
                        <div className="dx-stat-value">{stats.networks.total}</div>
                        <div className="dx-stat-meta">
                            <span className="dx-stat-sub">Bridge · Host · None</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="dx-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`dx-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="dx-panel">
                {activeTab === 'containers' && <ContainersTab onStatsChange={loadStats} />}
                {activeTab === 'compose' && <ComposeTab onStatsChange={loadStats} />}
                {activeTab === 'images' && <ImagesTab onStatsChange={loadStats} />}
                {activeTab === 'networks' && <NetworksTab onStatsChange={loadStats} />}
                {activeTab === 'volumes' && <VolumesTab onStatsChange={loadStats} />}
            </div>
        </div>
        </ServerContext.Provider>
    );
};

// Action Buttons
const RunContainerButton = () => {
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <Button onClick={() => setShowModal(true)}>
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
    return (
        <>
            <Button onClick={() => setShowModal(true)}>
                <span>+</span> Create Network
            </Button>
            {showModal && <CreateNetworkModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const CreateVolumeButton = () => {
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <Button onClick={() => setShowModal(true)}>
                <span>+</span> Create Volume
            </Button>
            {showModal && <CreateVolumeModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const PruneButton = ({ onPruned }) => {
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();

    async function handlePrune() {
        const confirmed = await confirm({ title: 'Docker Cleanup', message: 'Remove unused Docker resources? This will remove stopped containers, unused images, and unused networks.' });
        if (!confirmed) return;

        setLoading(true);
        try {
            await api.request('/docker/cleanup', { method: 'POST', body: {} });
            toast.success('Docker cleanup completed');
            onPruned?.();
        } catch (err) {
            toast.error('Failed to cleanup Docker resources');
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <Button variant="outline" size="sm" onClick={handlePrune} disabled={loading}>
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
    const [execContainer, setExecContainer] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadContainers();
    }, [showAll, serverId]);

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
            setContainers(containerList);

            // Load stats for running containers
            const runningContainers = containerList.filter(c => c.state === 'running');
            const statsPromises = runningContainers.map(async (c) => {
                try {
                    let statsData;
                    if (isRemote) {
                        const result = await api.getRemoteContainerStats(serverId, c.id);
                        statsData = { stats: unwrapRemoteData(result) };
                    } else {
                        statsData = await api.getContainerStats(c.id);
                    }
                    return { id: c.id, stats: statsData.stats };
                } catch {
                    return { id: c.id, stats: null };
                }
            });

            const statsResults = await Promise.all(statsPromises);
            const statsMap = {};
            statsResults.forEach(({ id, stats }) => {
                if (stats) statsMap[id] = stats;
            });
            setContainerStats(statsMap);
        } catch (err) {
            console.error('Failed to load containers:', err);
        } finally {
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
        if (!stats) return { cpu: 0, memory: 0 };

        // CPU comes as "0.12%" format
        const cpuStr = stats.CPUPerc || stats.cpu_percent || '0%';
        const cpu = parseFloat(cpuStr.replace('%', '')) || 0;

        // Memory comes as "0.12%" format
        const memStr = stats.MemPerc || stats.memory_percent || '0%';
        const memory = parseFloat(memStr.replace('%', '')) || 0;

        return { cpu, memory };
    }

    function formatPorts(portsStr) {
        if (!portsStr) return '-';
        // Parse ports like "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp"
        const ports = portsStr.split(',').map(p => p.trim()).filter(Boolean);
        return ports.length > 0 ? ports : ['-'];
    }

    const [statusFilter, setStatusFilter] = useState('all');

    const counts = useMemo(() => {
        const c = { all: containers.length, running: 0, stopped: 0 };
        containers.forEach(x => { if (x.state === 'running') c.running++; else c.stopped++; });
        return c;
    }, [containers]);

    const filteredContainers = containers.filter(c => {
        if (statusFilter === 'running' && c.state !== 'running') return false;
        if (statusFilter === 'stopped' && c.state === 'running') return false;
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return c.name?.toLowerCase().includes(search) ||
               c.id?.toLowerCase().includes(search) ||
               c.image?.toLowerCase().includes(search);
    });

    if (loading) {
        return <div className="lv-content-loading" style={{ padding: 60 }}>Loading containers…</div>;
    }

    return (
        <div className="dx-tab-pane">
            <div className="dx-tab-toolbar">
                <div className="proc-filter-chips">
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
                    <div className="lv-search-field" style={{ minWidth: 240 }}>
                        <Search size={13} className="lv-search-field-icon" />
                        <input
                            type="text"
                            placeholder="Filter name or image…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button className="lv-search-field-clear" onClick={() => setSearchTerm('')}>
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
                <div className="lv-empty-hint" style={{ padding: 60, minHeight: 240 }}>
                    <Box size={32} />
                    <p>{containers.length === 0 ? 'No containers yet. Run your first one.' : 'No containers match the current filters.'}</p>
                </div>
            ) : (
                <div className="dx-container-grid">
                    {filteredContainers.map(container => {
                        const stats = parseStats(containerStats[container.id]);
                        const isRunning = container.state === 'running';
                        const ports = formatPorts(container.ports);
                        return (
                            <div
                                key={container.id}
                                className={`dx-container-card ${isRunning ? 'is-running' : 'is-stopped'}`}
                                onClick={() => setSelectedContainer(container)}
                            >
                                <div className="dx-card-head">
                                    <div className="dx-card-title">
                                        <span className={`dx-status-dot ${isRunning ? 'running' : 'stopped'}`} />
                                        <h4 title={container.name}>{container.name}</h4>
                                    </div>
                                    <span className={`dx-status-pill ${isRunning ? 'running' : 'stopped'}`}>
                                        {isRunning ? 'Running' : 'Exited'}
                                    </span>
                                </div>
                                <div className="dx-card-image">
                                    <Layers size={11} />
                                    <span title={container.image}>{container.image}</span>
                                </div>
                                <div className="dx-card-detail">{container.status}</div>
                                {isRunning && Array.isArray(ports) && ports[0] !== '-' && (
                                    <div className="dx-card-ports">
                                        {ports.slice(0, 3).map((p, i) => (
                                            <span key={i} className="dx-port-pill">{p}</span>
                                        ))}
                                        {ports.length > 3 && <span className="dx-port-more">+{ports.length - 3}</span>}
                                    </div>
                                )}
                                {isRunning && (
                                    <div className="dx-card-resources">
                                        <div className="dx-res">
                                            <span className="dx-res-label"><Cpu size={10} /> CPU</span>
                                            <div className="dx-res-track">
                                                <div className="dx-res-fill cpu" style={{ width: `${Math.min(stats.cpu, 100)}%` }} />
                                            </div>
                                            <span className="dx-res-value">{stats.cpu.toFixed(1)}%</span>
                                        </div>
                                        <div className="dx-res">
                                            <span className="dx-res-label">RAM</span>
                                            <div className="dx-res-track">
                                                <div className="dx-res-fill mem" style={{ width: `${Math.min(stats.memory, 100)}%` }} />
                                            </div>
                                            <span className="dx-res-value">{stats.memory.toFixed(1)}%</span>
                                        </div>
                                    </div>
                                )}
                                <div className="dx-card-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        className="svc-action-btn ghost"
                                        onClick={() => setSelectedContainer(container)}
                                        title="Logs"
                                    >
                                        <FileText size={12} /> Logs
                                    </button>
                                    {isRunning && (
                                        <>
                                            <button
                                                className="svc-action-btn ghost"
                                                onClick={() => setExecContainer(container)}
                                                title="Exec"
                                            >
                                                <TerminalLucide size={12} /> Exec
                                            </button>
                                            <button
                                                className="svc-action-btn"
                                                onClick={() => handleAction(container.id, 'restart')}
                                                title="Restart"
                                            >
                                                <RotateCw size={12} /> Restart
                                            </button>
                                            <button
                                                className="svc-action-btn"
                                                onClick={() => handleAction(container.id, 'stop')}
                                                title="Stop"
                                            >
                                                <Square size={12} /> Stop
                                            </button>
                                        </>
                                    )}
                                    {!isRunning && (
                                        <>
                                            <button
                                                className="svc-action-btn primary"
                                                onClick={() => handleAction(container.id, 'start')}
                                                title="Start"
                                            >
                                                <Play size={12} /> Start
                                            </button>
                                            <button
                                                className="svc-action-btn danger"
                                                onClick={() => handleAction(container.id, 'remove')}
                                                title="Remove"
                                            >
                                                <Trash2 size={12} /> Remove
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {selectedContainer && (
                <ContainerLogsModal
                    container={selectedContainer}
                    onClose={() => setSelectedContainer(null)}
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
                <div className="docker-empty">
                    <h3>No images</h3>
                    <p>Pull your first image to get started.</p>
                </div>
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
                <div className="docker-empty">
                    <h3>No networks</h3>
                    <p>Create a network to connect containers.</p>
                </div>
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
                <div className="docker-empty">
                    <h3>No volumes</h3>
                    <p>Create a volume for persistent data storage.</p>
                </div>
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
    const [selectedProject, setSelectedProject] = useState(null);
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
                data = await api.request('/docker/compose/list');
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
            let result;
            if (action === 'up') {
                if (isRemote) {
                    result = await api.remoteComposeUp(serverId, projectPath);
                } else {
                    result = await api.composeUp(projectPath, true, false);
                }
                toast.success('Project started');
            } else if (action === 'down') {
                const downConfirmed = await confirmCompose({ title: 'Stop Compose Project', message: 'Stop this compose project? Containers will be removed.' });
                if (!downConfirmed) {
                    setActionLoading(prev => ({ ...prev, [project.Name || project.name]: false }));
                    return;
                }
                if (isRemote) {
                    result = await api.remoteComposeDown(serverId, projectPath);
                } else {
                    result = await api.composeDown(projectPath, false, true);
                }
                toast.success('Project stopped');
            } else if (action === 'restart') {
                if (isRemote) {
                    result = await api.remoteComposeRestart(serverId, projectPath);
                } else {
                    result = await api.composeRestart(projectPath);
                }
                toast.success('Project restarted');
            } else if (action === 'pull') {
                if (isRemote) {
                    result = await api.remoteComposePull(serverId, projectPath);
                } else {
                    result = await api.composePull(projectPath);
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
                <div className="docker-empty">
                    <h3>No Compose Projects</h3>
                    <p>No Docker Compose projects are running on this server.</p>
                    <p className="text-muted">
                        Start a compose project with <code>docker compose up -d</code>
                    </p>
                </div>
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
                                            <LogsIcon />
                                        </IconAction>
                                        {isRunning ? (
                                            <>
                                                <IconAction
                                                    title="Restart"
                                                    onClick={() => handleAction(project, 'restart')}
                                                    disabled={isLoading}
                                                >
                                                    <RestartIcon />
                                                </IconAction>
                                                <IconAction
                                                    title="Stop"
                                                    onClick={() => handleAction(project, 'down')}
                                                    disabled={isLoading}
                                                    color="#EF4444"
                                                >
                                                    <StopIcon />
                                                </IconAction>
                                            </>
                                        ) : (
                                            <IconAction
                                                title="Start"
                                                onClick={() => handleAction(project, 'up')}
                                                disabled={isLoading}
                                                color="#10B981"
                                            >
                                                <PlayIcon />
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
                const result = await api.getRemoteContainerLogs(serverId, container.id, tail);
                data = unwrapRemoteData(result);
            } else {
                data = await api.getContainerLogs(container.id, tail);
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
                        <h3>{container.name}</h3>
                        <p className="preview-drawer-path">{container.image} · {container.id?.substring(0, 12)}</p>
                    </div>
                    <button className="preview-drawer-close" onClick={onClose}>
                        <X size={18} />
                    </button>
                </header>

                <div className="preview-drawer-meta">
                    <div className="meta-item">
                        <span className="meta-label">Status</span>
                        <span className="meta-value">{container.state || container.status}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">Image</span>
                        <span className="meta-value mono">{container.image}</span>
                    </div>
                    <div className="meta-item meta-item-wide">
                        <span className="meta-label">ID</span>
                        <span className="meta-value mono">{container.id}</span>
                    </div>
                    {container.ports && (
                        <div className="meta-item meta-item-wide">
                            <span className="meta-label">Ports</span>
                            <span className="meta-value mono">{container.ports || '—'}</span>
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
            const result = await api.execContainer(container.id, cmd);
            if (result.output) {
                setOutput(prev => [...prev, { type: 'output', text: result.output }]);
            }
            if (result.error) {
                setOutput(prev => [...prev, { type: 'error', text: result.error }]);
            }
            if (result.exit_code !== 0) {
                setOutput(prev => [...prev, { type: 'info', text: `Exit code: ${result.exit_code}` }]);
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
                    <h2>Exec: {container.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body exec-modal-body">
                    <div className="exec-output" ref={outputRef}>
                        {output.length === 0 ? (
                            <div className="exec-welcome">
                                <p>Execute commands in container <code>{container.name}</code></p>
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
    const [image, setImage] = useState('');
    const [tag, setTag] = useState('latest');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.pullImage(image, tag);
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
