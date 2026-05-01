import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    HardDrive, Activity,
    RefreshCw, Zap,
    Database, Container, Globe, Code, Layers, Server, Terminal
} from 'lucide-react';
import api from '../services/api';
import { useMetrics } from '../hooks/useMetrics';
import MetricsGraph from '../components/MetricsGraph';
import useDashboardLayout from '../hooks/useDashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Refresh interval options in seconds
const REFRESH_OPTIONS = [
    { label: 'Off', value: 0 },
    { label: '5s', value: 5 },
    { label: '10s', value: 10 },
    { label: '30s', value: 30 },
    { label: '1m', value: 60 },
];

const ServerSelectorIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
        <line x1="6" y1="6" x2="6.01" y2="6"/>
        <line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
);

const Dashboard = () => {
    const navigate = useNavigate();
    const { metrics: localMetrics, loading: metricsLoading, connected, refresh: refreshMetrics } = useMetrics(true);
    const { widgets } = useDashboardLayout();
    const [apps, setApps] = useState([]);
    const [systemInfo, setSystemInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshInterval, setRefreshInterval] = useState(() => {
        const saved = localStorage.getItem('dashboard_refresh_interval');
        return saved ? parseInt(saved, 10) : 10;
    });
    const [localUptime, setLocalUptime] = useState(null);
    const [localTime, setLocalTime] = useState(null);
    const lastServerUptime = React.useRef(null);
    const lastServerTime = React.useRef(null);

    // Server selector state
    const [servers, setServers] = useState([]);
    const [selectedServer, setSelectedServer] = useState({ id: 'local', name: 'Local (this server)' });
    const isRemote = selectedServer.id !== 'local';

    // Remote metrics (when a non-local server is selected)
    const [remoteMetrics, setRemoteMetrics] = useState(null);
    const [remoteSystemInfo, setRemoteSystemInfo] = useState(null);
    const [remoteLoading, setRemoteLoading] = useState(false);

    // Active metrics: remote when a remote server is selected, local otherwise
    const metrics = isRemote ? remoteMetrics : localMetrics;

    const fetchRemote = useCallback(async () => {
        if (!isRemote) return;
        setRemoteLoading(true);
        try {
            const [metricsData, sysInfo] = await Promise.all([
                api.getRemoteSystemMetrics(selectedServer.id),
                api.getRemoteSystemInfo(selectedServer.id).catch(() => null)
            ]);
            setRemoteMetrics(metricsData);
            setRemoteSystemInfo(sysInfo);
        } catch (err) {
            console.error('Failed to load remote metrics:', err);
        } finally {
            setRemoteLoading(false);
        }
    }, [selectedServer.id, isRemote]);

    // Load servers list on mount
    useEffect(() => {
        api.getAvailableServers()
            .then(data => setServers(Array.isArray(data) ? data : []))
            .catch(() => setServers([{ id: 'local', name: 'Local (this server)', status: 'online' }]));
    }, []);

    // Fetch remote metrics when a remote server is selected
    useEffect(() => {
        if (!isRemote) {
            setRemoteMetrics(null);
            setRemoteSystemInfo(null);
            return;
        }

        fetchRemote();
        const interval = refreshInterval > 0
            ? setInterval(fetchRemote, refreshInterval * 1000)
            : null;

        return () => { if (interval) clearInterval(interval); };
    }, [fetchRemote, refreshInterval, isRemote]);

    // Sync local counters when server data arrives
    useEffect(() => {
        const serverUptime = metrics?.system?.uptime_seconds;
        const serverTimeStr = metrics?.time?.current_time_formatted;

        if (serverUptime && serverUptime !== lastServerUptime.current) {
            lastServerUptime.current = serverUptime;
            setLocalUptime(serverUptime);
        }

        if (serverTimeStr && serverTimeStr !== lastServerTime.current) {
            lastServerTime.current = serverTimeStr;
            try {
                const parsed = new Date(serverTimeStr);
                if (!isNaN(parsed)) {
                    setLocalTime(parsed);
                }
            } catch {
                // If parsing fails, skip
            }
        }
    }, [metrics?.system?.uptime_seconds, metrics?.time?.current_time_formatted]);

    // Tick every second - increment uptime and time locally
    useEffect(() => {
        const tick = setInterval(() => {
            if (localUptime !== null) {
                setLocalUptime(prev => prev + 1);
            }
            if (localTime !== null) {
                setLocalTime(prev => new Date(prev.getTime() + 1000));
            }
        }, 1000);

        return () => clearInterval(tick);
    }, [localUptime !== null, localTime !== null]);

    // Load initial data
    useEffect(() => {
        loadData();
    }, []);

    // Polling fallback when WebSocket is not connected (local only)
    useEffect(() => {
        if (refreshInterval > 0 && !connected && !isRemote) {
            const interval = setInterval(() => {
                refreshMetrics();
            }, refreshInterval * 1000);
            return () => clearInterval(interval);
        }
    }, [refreshInterval, connected, refreshMetrics, isRemote]);

    // Save refresh interval preference
    const handleRefreshIntervalChange = useCallback((value) => {
        setRefreshInterval(value);
        localStorage.setItem('dashboard_refresh_interval', value.toString());
    }, []);

    function handleServerChange(e) {
        const serverId = e.target.value;
        const server = servers.find(s => s.id === serverId) || { id: 'local', name: 'Local (this server)' };
        setSelectedServer(server);
        // Reset ticking counters when switching servers
        lastServerUptime.current = null;
        lastServerTime.current = null;
        setLocalUptime(null);
        setLocalTime(null);
    }

    async function loadData() {
        try {
            const [appsData, sysInfoData] = await Promise.all([
                api.getApps(),
                api.getSystemInfo().catch(() => null)
            ]);
            setApps(appsData.apps || []);
            setSystemInfo(sysInfoData);
        } catch (err) {
            console.error('Failed to load data:', err);
        } finally {
            setLoading(false);
        }
    }

    function handleRefreshAll() {
        if (isRemote) {
            fetchRemote();
        } else {
            refreshMetrics();
        }
        loadData();
    }

    function formatUptime(seconds) {
        if (!seconds) return { days: 0, hours: 0, minutes: 0 };
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return { days, hours, minutes };
    }

    function getStackIcon(type) {
        switch (type) {
            case 'docker': return <Container size={16} />;
            case 'wordpress':
            case 'php': return <Code size={16} />;
            case 'flask':
            case 'django': return <Layers size={16} />;
            default: return <Globe size={16} />;
        }
    }

    // Get uptime from local ticking counter (synced with server)
    const uptimeFormatted = formatUptime(localUptime ?? metrics?.system?.uptime_seconds);
    const activeSysInfo = isRemote ? remoteSystemInfo : systemInfo;
    const hostname = metrics?.system?.hostname || activeSysInfo?.hostname || 'server';
    const kernelVersion = metrics?.system?.kernel || activeSysInfo?.kernel || '-';
    const ipAddress = metrics?.system?.ip_address || activeSysInfo?.ip_address || '-';
    const serverTime = metrics?.time;

    // Format the local ticking clock
    const displayTime = localTime
        ? localTime.toLocaleTimeString('en-US', { hour12: false })
        : serverTime?.current_time_formatted?.split(' ')[1] || '--:--:--';

    // Show green if we have metrics data (regardless of transport — WS or HTTP poll)
    const isConnected = isRemote ? !remoteLoading && !!remoteMetrics : !!localMetrics;

    if (loading && metricsLoading) {
        return <div className="loading">Loading dashboard...</div>;
    }

    return (
        <div className="page-container dashboard-page">
            {/* Top Bar */}
            <div className="top-bar">
                <div className="server-identity">
                    <h1>
                        <span className={`status-dot-live ${isConnected ? '' : 'disconnected'}`}></span>
                        {hostname}
                    </h1>
                    <div className="server-details">
                        <span>IP: {ipAddress}</span>
                        <span className="detail-separator">|</span>
                        <span>KERNEL: {kernelVersion}</span>
                        <span className="detail-separator">|</span>
                        <span>UPTIME: {uptimeFormatted.days}d {String(uptimeFormatted.hours).padStart(2, '0')}h {String(uptimeFormatted.minutes).padStart(2, '0')}m</span>
                    </div>
                </div>
                <div className="top-bar-right">
                    {servers.length > 1 && (
                        <div className="server-selector">
                            <ServerSelectorIcon />
                            <select value={selectedServer.id} onChange={handleServerChange}>
                                {servers.map(server => (
                                    <option key={server.id} value={server.id} disabled={server.status === 'offline'}>
                                        {server.name} {server.status === 'offline' ? '(Offline)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="clock-widget">
                        <span className="clock-time">{displayTime}</span>
                        <span className="clock-zone">{serverTime?.timezone_id || 'UTC'}</span>
                    </div>
                    <div className="refresh-control">
                        <button
                            className="btn-refresh"
                            onClick={handleRefreshAll}
                            title="Refresh now"
                        >
                            <RefreshCw size={14} />
                        </button>
                        <select
                            value={refreshInterval}
                            onChange={(e) => handleRefreshIntervalChange(parseInt(e.target.value, 10))}
                            className="refresh-select"
                            title="Auto-refresh interval"
                        >
                            {REFRESH_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Grid Container */}
            <div className="grid-container">
                {widgets.filter(w => w.visible).map(w => {
                    const WIDGET_RENDERERS = {
                        cpu: () => (
                            <div key="cpu" className="metric-tile">
                                <div className="tile-head">
                                    <span className="tile-title">CPU</span>
                                    <Zap size={16} className="tile-icon cpu" />
                                </div>
                                <div className="tile-val">{(metrics?.cpu?.percent || 0).toFixed(1)}%</div>
                                <div className="tile-sub">
                                    <span>Cores: {metrics?.cpu?.count_logical || 0}</span>
                                </div>
                            </div>
                        ),
                        ram: () => (
                            <div key="ram" className="metric-tile">
                                <div className="tile-head">
                                    <span className="tile-title">RAM</span>
                                    <Database size={16} className="tile-icon memory" />
                                </div>
                                <div className="tile-val">{metrics?.memory?.ram?.used_human || '0 GB'}</div>
                                <div className="tile-sub">
                                    <span>Total: {metrics?.memory?.ram?.total_human || '0 GB'}</span>
                                    <span>Cached: {metrics?.memory?.ram?.cached_human || '0 GB'}</span>
                                </div>
                            </div>
                        ),
                        network: () => (
                            <div key="network" className="metric-tile">
                                <div className="tile-head">
                                    <span className="tile-title">Network</span>
                                    <Activity size={16} className="tile-icon network" />
                                </div>
                                <div className="tile-val">
                                    {metrics?.network?.io?.bytes_sent_human || '0 B'}
                                    <span className="tile-val-unit">sent</span>
                                </div>
                                <div className="tile-sub">
                                    <span>In: {metrics?.network?.io?.bytes_recv_human || '0 B'}</span>
                                    <span>Out: {metrics?.network?.io?.bytes_sent_human || '0 B'}</span>
                                </div>
                            </div>
                        ),
                        disk: () => (
                            <div key="disk" className="metric-tile">
                                <div className="tile-head">
                                    <span className="tile-title">Disk</span>
                                    <HardDrive size={16} className="tile-icon disk" />
                                </div>
                                <div className="tile-val">
                                    {(metrics?.disk?.partitions?.[0]?.percent || 0).toFixed(1)}%
                                    <span className="tile-val-unit">used</span>
                                </div>
                                <div className="tile-sub">
                                    <span>Used: {metrics?.disk?.partitions?.[0]?.used_human || '0 GB'}</span>
                                    <span>Free: {metrics?.disk?.partitions?.[0]?.free_human || '0 GB'}</span>
                                </div>
                            </div>
                        ),
                        chart: () => (
                            <div key="chart" className="chart-panel">
                                <MetricsGraph timezone={serverTime?.timezone_id} />
                            </div>
                        ),
                        specs: () => (
                            <div key="specs" className="spec-panel">
                                <h3 className="spec-panel-title">Quick Actions</h3>
                                <button className="btn-action" onClick={() => navigate('/servers')}>
                                    <span>Manage Servers</span>
                                    <span><Server size={14} /></span>
                                </button>
                                <button className="btn-action" onClick={() => navigate('/docker')}>
                                    <span>Docker Containers</span>
                                    <span><Container size={14} /></span>
                                </button>
                                <button className="btn-action" onClick={() => navigate('/terminal')}>
                                    <span>Open Terminal</span>
                                    <span><Terminal size={14} /></span>
                                </button>

                                <h3 className="spec-panel-title mt-6">Hardware Specs</h3>
                                <div className="spec-row">
                                    <span className="spec-label">Processor</span>
                                    <span className="spec-data">{activeSysInfo?.cpu?.model || 'N/A'}</span>
                                </div>
                                <div className="spec-row">
                                    <span className="spec-label">Architecture</span>
                                    <span className="spec-data">{activeSysInfo?.cpu?.architecture || 'N/A'}</span>
                                </div>
                                <div className="spec-row">
                                    <span className="spec-label">Swap Memory</span>
                                    <span className="spec-data">{metrics?.memory?.swap?.total_human || 'N/A'}</span>
                                </div>
                            </div>
                        ),
                        processes: () => (
                            <div key="processes" className="table-panel">
                                <div className="table-header">
                                    <span>Applications</span>
                                    <Button variant="outline" size="sm" onClick={loadData}>
                                        <RefreshCw size={14} />
                                    </Button>
                                </div>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Name</th>
                                            <th>Type</th>
                                            <th>Status</th>
                                            <th>Domain</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {apps.length === 0 ? (
                                            <tr>
                                                <td colSpan="5" className="text-center text-gray-400">
                                                    No applications found
                                                </td>
                                            </tr>
                                        ) : (
                                            apps.slice(0, 6).map(app => (
                                                <tr key={app.id} onClick={() => navigate(`/apps/${app.id}`)} className="cursor-pointer">
                                                    <td>{app.id}</td>
                                                    <td>
                                                        <div className="app-name-cell">
                                                            <span className="app-icon-mini">{getStackIcon(app.app_type)}</span>
                                                            {app.name}
                                                        </div>
                                                    </td>
                                                    <td>{app.app_type}</td>
                                                    <td>
                                                        <Badge variant={app.status === 'running' ? 'success' : 'warning'}>
                                                            {app.status?.toUpperCase()}
                                                        </Badge>
                                                    </td>
                                                    <td>{app.domains?.[0]?.name || '-'}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ),
                    };
                    return WIDGET_RENDERERS[w.id]?.();
                })}
            </div>
        </div>
    );
};

export default Dashboard;
