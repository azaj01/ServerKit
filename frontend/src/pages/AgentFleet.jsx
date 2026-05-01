import React, { useState, useEffect, useCallback } from 'react';
import {
    Users,
    Shield,
    Activity,
    Download,
    RefreshCw,
    CheckCircle,
    AlertCircle,
    Clock,
    Zap,
    Search,
    ChevronRight,
    Server,
    Layers,
    Package,
    Plus,
    Trash2,
    Play,
    Pause,
    XCircle,
    Wifi,
    WifiOff,
    RotateCcw,
    Info
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { StatCard, StatsGrid } from '../components/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const AgentFleet = () => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [loading, setLoading] = useState(true);
    const [health, setHealth] = useState(null);
    const [versions, setVersions] = useState([]);
    const [discoveredAgents, setDiscoveredAgents] = useState([]);
    const [pendingServers, setPendingServers] = useState([]);
    const [rollouts, setRollouts] = useState([]);
    const [queuedCommands, setQueuedCommands] = useState([]);
    const [diagnostics, setDiagnostics] = useState(null);
    const [diagnosticsServerId, setDiagnosticsServerId] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState('');
    const [rolloutStrategy, setRolloutStrategy] = useState('all');
    const [rolloutBatchSize, setRolloutBatchSize] = useState(5);
    const [rolloutDelay, setRolloutDelay] = useState(10);
    const { addToast } = useToast();
    const { user } = useAuth();

    useEffect(() => {
        fetchData();
    }, [activeTab]);

    const fetchData = async () => {
        setLoading(true);
        try {
            if (activeTab === 'dashboard') {
                const data = await api.getFleetHealth();
                setHealth(data);
            } else if (activeTab === 'versions') {
                const data = await api.getAgentVersions();
                setVersions(data);
            } else if (activeTab === 'rollouts') {
                const [rolloutData, versionData] = await Promise.all([
                    api.getRollouts(),
                    api.getAgentVersions()
                ]);
                setRollouts(rolloutData);
                setVersions(versionData);
                if (versionData.length > 0 && !selectedVersion) {
                    setSelectedVersion(versionData[0].id);
                }
            } else if (activeTab === 'discovery') {
                const data = await api.getDiscoveredAgents();
                setDiscoveredAgents(data);
            } else if (activeTab === 'approvals') {
                const data = await api.getServers();
                setPendingServers((data.servers || data).filter(s => s.status === 'pending'));
            } else if (activeTab === 'queue') {
                const data = await api.getQueuedCommands();
                setQueuedCommands(data);
            }
        } catch (error) {
            console.error('Error fetching fleet data:', error);
            addToast('Error', 'Failed to fetch fleet data', 'error');
        } finally {
            setLoading(false);
        }
    };

    const startDiscovery = async () => {
        setIsScanning(true);
        try {
            addToast('Discovery', 'Scanning network for agents...', 'info');
            await api.startDiscovery(10);
            const data = await api.getDiscoveredAgents();
            setDiscoveredAgents(data);
            addToast('Success', `Discovered ${data.length} agents`, 'success');
        } catch (error) {
            addToast('Error', 'Discovery scan failed', 'error');
        } finally {
            setIsScanning(false);
        }
    };

    const approveAgent = async (serverId) => {
        try {
            await api.approveRegistration(serverId);
            addToast('Success', 'Agent registration approved', 'success');
            fetchData();
        } catch (error) {
            addToast('Error', 'Failed to approve agent', 'error');
        }
    };

    const rejectAgent = async (serverId) => {
        try {
            await api.rejectRegistration(serverId);
            addToast('Success', 'Agent registration rejected', 'success');
            fetchData();
        } catch (error) {
            addToast('Error', 'Failed to reject agent', 'error');
        }
    };

    const triggerUpgrade = async () => {
        if (!selectedVersion) {
            addToast('Error', 'Select a target version', 'error');
            return;
        }

        try {
            if (rolloutStrategy === 'all') {
                await api.upgradeFleet([], selectedVersion);
                addToast('Success', 'Upgrade triggered for all online agents', 'success');
            } else {
                const data = {
                    version_id: selectedVersion,
                    strategy: rolloutStrategy,
                    batch_size: rolloutStrategy === 'canary' ? 1 : rolloutBatchSize,
                    delay_minutes: rolloutDelay
                };
                await api.startRollout(data);
                addToast('Success', 'Staged rollout started', 'success');
            }
            fetchData();
        } catch (error) {
            addToast('Error', 'Failed to trigger upgrade', 'error');
        }
    };

    const cancelRollout = async (rolloutId) => {
        try {
            await api.cancelRollout(rolloutId);
            addToast('Success', 'Rollout cancelled', 'success');
            fetchData();
        } catch (error) {
            addToast('Error', 'Failed to cancel rollout', 'error');
        }
    };

    const retryCommand = async (commandId) => {
        try {
            await api.retryCommand(commandId);
            addToast('Success', 'Command retry triggered', 'success');
            fetchData();
        } catch (error) {
            addToast('Error', 'Failed to retry command', 'error');
        }
    };

    const loadDiagnostics = async (serverId) => {
        try {
            const data = await api.getServerDiagnostics(serverId);
            setDiagnostics(data);
            setDiagnosticsServerId(serverId);
        } catch (error) {
            addToast('Error', 'Failed to load diagnostics', 'error');
        }
    };

    const rolloutStatusVariant = (status) => {
        const map = {
            running: 'info',
            completed: 'success',
            failed: 'destructive',
            cancelled: 'warning',
            pending: 'secondary'
        };
        return map[status] || 'secondary';
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <div className="header-info">
                    <h1>Agent Fleet Management</h1>
                    <p>Monitor health, manage versions, and control updates across your infrastructure.</p>
                </div>
                <div className="header-actions">
                    <Button onClick={fetchData} disabled={loading}>
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    {[
                        { key: 'dashboard', icon: Activity, label: 'Dashboard' },
                        { key: 'versions', icon: Package, label: 'Versions' },
                        { key: 'rollouts', icon: Zap, label: 'Rollouts' },
                        { key: 'queue', icon: Clock, label: 'Command Queue' },
                        { key: 'discovery', icon: Search, label: 'Discovery' },
                        { key: 'approvals', icon: Shield, label: 'Approvals' },
                    ].map(tab => (
                        <TabsTrigger key={tab.key} value={tab.key}>
                            <tab.icon size={18} />
                            {tab.label}
                            {tab.key === 'approvals' && pendingServers.length > 0 && (
                                <Badge variant="destructive" className="ml-2">{pendingServers.length}</Badge>
                            )}
                            {tab.key === 'queue' && queuedCommands.length > 0 && (
                                <Badge variant="warning" className="ml-2">{queuedCommands.length}</Badge>
                            )}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            <div className="tab-content mt-6">
                {/* ==================== Dashboard ==================== */}
                {activeTab === 'dashboard' && health && (
                    <div className="space-y-6">
                        <StatsGrid>
                            <StatCard icon={Server} iconVariant="backups" label="Total Agents" value={health.total_servers} />
                            <StatCard icon={CheckCircle} iconVariant="apps" label="Online" value={health.online_servers} />
                            <StatCard icon={AlertCircle} iconVariant="alerts" label="Offline" value={health.offline_servers} />
                            <StatCard icon={Zap} iconVariant="schedules" label="Success Rate" value={`${health.command_success_rate}%`} />
                        </StatsGrid>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="card">
                                <div className="card-header">
                                    <h2>Fleet Health Summary</h2>
                                </div>
                                <div className="card-body">
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Overall Uptime</span>
                                            <span className="font-semibold text-green-600">{health.uptime_percentage?.toFixed(2)}%</span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-green-600 h-2 rounded-full"
                                                style={{ width: `${health.uptime_percentage}%` }}
                                            ></div>
                                        </div>

                                        <div className="flex justify-between items-center mt-6">
                                            <span className="text-gray-600">Avg Heartbeat Latency</span>
                                            <span className="font-semibold">{health.avg_heartbeat_latency} ms</span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-blue-600 h-2 rounded-full"
                                                style={{ width: `${Math.min(100, health.avg_heartbeat_latency / 2)}%` }}
                                            ></div>
                                        </div>

                                        {health.queued_commands > 0 && (
                                            <div className="flex justify-between items-center mt-4 p-3 bg-yellow-50 rounded-lg">
                                                <span className="text-yellow-700 flex items-center gap-2">
                                                    <Clock size={16} /> Queued Commands
                                                </span>
                                                <span className="font-semibold text-yellow-700">{health.queued_commands}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="card">
                                <div className="card-header">
                                    <h2>Version Distribution</h2>
                                </div>
                                <div className="card-body">
                                    <div className="space-y-4">
                                        {Object.entries(health.version_distribution || {}).map(([version, count]) => (
                                            <div key={version} className="space-y-1">
                                                <div className="flex justify-between text-sm">
                                                    <span>v{version}</span>
                                                    <span className="text-gray-500">{count} agents ({(count / health.total_servers * 100).toFixed(0)}%)</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-2">
                                                    <div
                                                        className="bg-indigo-600 h-2 rounded-full"
                                                        style={{ width: `${count / health.total_servers * 100}%` }}
                                                    ></div>
                                                </div>
                                            </div>
                                        ))}
                                        {Object.keys(health.version_distribution || {}).length === 0 && (
                                            <p className="text-gray-500 text-center py-4">No agents registered yet.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ==================== Versions ==================== */}
                {activeTab === 'versions' && (
                    <div className="card">
                        <div className="card-header flex justify-between items-center">
                            <h2>Agent Versions</h2>
                            <Button size="sm">
                                <Plus size={16} /> Add Version
                            </Button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Version</th>
                                        <th>Channel</th>
                                        <th>Published</th>
                                        <th>Panel Compatibility</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {versions.map(v => (
                                        <tr key={v.id}>
                                            <td className="font-semibold">v{v.version}</td>
                                            <td>
                                                <Badge variant={v.channel === 'stable' ? 'success' : 'warning'}>
                                                    {v.channel}
                                                </Badge>
                                            </td>
                                            <td>{new Date(v.published_at).toLocaleDateString()}</td>
                                            <td>{v.min_panel_version || 'Any'} - {v.max_panel_version || 'Latest'}</td>
                                            <td>
                                                <span className={`flex items-center gap-1 ${v.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                                                    {v.is_active ? <CheckCircle size={14} /> : <Clock size={14} />}
                                                    {v.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="actions">
                                                <Button variant="ghost" size="sm" title="Edit"><RefreshCw size={14} /></Button>
                                                <Button variant="ghost" size="sm" className="text-red-600" title="Delete"><Trash2 size={14} /></Button>
                                            </td>
                                        </tr>
                                    ))}
                                    {versions.length === 0 && (
                                        <tr>
                                            <td colSpan="6" className="text-center py-8 text-gray-500">
                                                No agent versions registered in database.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {versions.length > 0 && versions[0].release_notes && (
                            <div className="card-body border-t">
                                <h3 className="text-sm font-semibold mb-2">Latest Release Notes (v{versions[0].version})</h3>
                                <p className="text-sm text-gray-600 whitespace-pre-wrap">{versions[0].release_notes}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* ==================== Rollouts ==================== */}
                {activeTab === 'rollouts' && (
                    <div className="space-y-6">
                        <div className="card">
                            <div className="card-header">
                                <h2>Trigger Fleet Upgrade</h2>
                            </div>
                            <div className="card-body">
                                <p className="text-gray-600 mb-4">
                                    Push a specific agent version to multiple servers at once.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="form-group">
                                        <label>Target Version</label>
                                        <select
                                            className="form-select w-full"
                                            value={selectedVersion}
                                            onChange={e => setSelectedVersion(e.target.value)}
                                        >
                                            <option value="">Select version...</option>
                                            {versions.map(v => (
                                                <option key={v.id} value={v.id}>v{v.version} ({v.channel})</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Rollout Strategy</label>
                                        <select
                                            className="form-select w-full"
                                            value={rolloutStrategy}
                                            onChange={e => setRolloutStrategy(e.target.value)}
                                        >
                                            <option value="all">All At Once</option>
                                            <option value="staged">Staged (Batch by Batch)</option>
                                            <option value="canary">Canary (1 server first)</option>
                                        </select>
                                    </div>
                                    {rolloutStrategy === 'staged' && (
                                        <>
                                            <div className="form-group">
                                                <label>Batch Size</label>
                                                <Input
                                                    type="number"
                                                    value={rolloutBatchSize}
                                                    onChange={e => setRolloutBatchSize(parseInt(e.target.value) || 5)}
                                                    min={1}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Delay (minutes)</label>
                                                <Input
                                                    type="number"
                                                    value={rolloutDelay}
                                                    onChange={e => setRolloutDelay(parseInt(e.target.value) || 10)}
                                                    min={1}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div className="mt-6 flex justify-end">
                                    <Button onClick={triggerUpgrade} disabled={!selectedVersion}>
                                        <Play size={18} /> Start Rollout
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-header">
                                <h2>Rollout History</h2>
                            </div>
                            {rollouts.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Version</th>
                                                <th>Strategy</th>
                                                <th>Progress</th>
                                                <th>Status</th>
                                                <th>Started</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rollouts.map(r => (
                                                <tr key={r.id}>
                                                    <td className="font-semibold">v{r.version}</td>
                                                    <td>{r.strategy}</td>
                                                    <td>
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-24 bg-gray-200 rounded-full h-2">
                                                                <div
                                                                    className={`h-2 rounded-full ${r.status === 'failed' ? 'bg-red-500' : r.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                                                                    style={{ width: `${r.total_servers > 0 ? (r.processed_servers / r.total_servers * 100) : 0}%` }}
                                                                ></div>
                                                            </div>
                                                            <span className="text-sm text-gray-500">
                                                                {r.processed_servers}/{r.total_servers}
                                                                {r.failed_servers > 0 && (
                                                                    <span className="text-red-500 ml-1">({r.failed_servers} failed)</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <Badge variant={rolloutStatusVariant(r.status)}>
                                                            {r.status}
                                                        </Badge>
                                                    </td>
                                                    <td className="text-sm">{r.started_at ? new Date(r.started_at).toLocaleString() : '-'}</td>
                                                    <td className="actions">
                                                        {r.status === 'running' && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="text-red-600"
                                                                onClick={() => cancelRollout(r.id)}
                                                                title="Cancel Rollout"
                                                            >
                                                                <XCircle size={14} /> Cancel
                                                            </Button>
                                                        )}
                                                        {r.error && (
                                                            <span className="text-xs text-red-500" title={r.error}>
                                                                <AlertCircle size={14} />
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="card-body py-12 text-center text-gray-500">
                                    <Zap size={48} className="mx-auto text-gray-300 mb-4" />
                                    <p>No rollouts have been started yet.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ==================== Command Queue ==================== */}
                {activeTab === 'queue' && (
                    <div className="card">
                        <div className="card-header flex justify-between items-center">
                            <h2>Queued Commands</h2>
                            <p className="text-sm text-gray-500">Commands waiting to be delivered when agents reconnect</p>
                        </div>
                        {queuedCommands.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Server</th>
                                            <th>Command</th>
                                            <th>Retries</th>
                                            <th>Queued At</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {queuedCommands.map(cmd => (
                                            <tr key={cmd.id}>
                                                <td>{cmd.server_id?.slice(0, 8)}...</td>
                                                <td className="font-mono text-sm">{cmd.command_type}</td>
                                                <td>
                                                    <span className={cmd.retry_count > 0 ? 'text-yellow-600' : ''}>
                                                        {cmd.retry_count}/{cmd.max_retries}
                                                    </span>
                                                </td>
                                                <td className="text-sm">{new Date(cmd.created_at).toLocaleString()}</td>
                                                <td className="actions">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => retryCommand(cmd.id)}
                                                        title="Retry now"
                                                    >
                                                        <RotateCcw size={14} /> Retry
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="card-body py-12 text-center text-gray-500">
                                <CheckCircle size={48} className="mx-auto text-gray-300 mb-4" />
                                <p>No queued commands. All agents are up to date.</p>
                            </div>
                        )}
                    </div>
                )}

                {/* ==================== Discovery ==================== */}
                {activeTab === 'discovery' && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h2>Network Discovery</h2>
                            <Button onClick={startDiscovery} disabled={isScanning}>
                                {isScanning ? <RefreshCw size={18} className="animate-spin" /> : <Search size={18} />}
                                {isScanning ? 'Scanning...' : 'Start Scan'}
                            </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {discoveredAgents.map(agent => (
                                <div key={agent.agent_id} className="card p-4 flex flex-col justify-between">
                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="bg-blue-100 p-2 rounded text-blue-600">
                                                <Server size={20} />
                                            </div>
                                            {agent.is_registered ? (
                                                <Badge variant="success">Registered</Badge>
                                            ) : (
                                                <Badge variant="warning">New</Badge>
                                            )}
                                        </div>
                                        <h3 className="font-bold">{agent.hostname}</h3>
                                        <p className="text-sm text-gray-500">{agent.ip_address}</p>
                                        <div className="mt-4 space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">OS:</span>
                                                <span>{agent.os} ({agent.arch})</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">Agent Version:</span>
                                                <span>v{agent.agent_version}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-4 border-t">
                                        {agent.is_registered ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="w-full"
                                                onClick={() => {
                                                    setActiveTab('dashboard');
                                                    loadDiagnostics(agent.server_id);
                                                }}
                                            >
                                                View Details
                                            </Button>
                                        ) : (
                                            <Button size="sm" className="w-full">Add to Fleet</Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {discoveredAgents.length === 0 && !isScanning && (
                                <div className="col-span-full py-12 text-center card bg-gray-50">
                                    <Search size={48} className="mx-auto text-gray-300 mb-4" />
                                    <p className="text-gray-500">No agents discovered yet. Start a scan to find agents on your local network.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ==================== Approvals ==================== */}
                {activeTab === 'approvals' && (
                    <div className="card">
                        <div className="card-header">
                            <h2>Pending Registrations</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Server Name</th>
                                        <th>IP Address</th>
                                        <th>Requested</th>
                                        <th>Agent Version</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pendingServers.map(server => (
                                        <tr key={server.id}>
                                            <td className="font-semibold">{server.name}</td>
                                            <td>{server.ip_address || 'N/A'}</td>
                                            <td>{new Date(server.created_at).toLocaleString()}</td>
                                            <td>v{server.agent_version || 'Unknown'}</td>
                                            <td className="actions">
                                                <Button
                                                    size="sm"
                                                    className="flex items-center gap-1"
                                                    onClick={() => approveAgent(server.id)}
                                                >
                                                    <CheckCircle size={14} /> Approve
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-600"
                                                    onClick={() => rejectAgent(server.id)}
                                                >
                                                    <XCircle size={14} /> Reject
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                    {pendingServers.length === 0 && (
                                        <tr>
                                            <td colSpan="5" className="text-center py-8 text-gray-500">
                                                No pending agent registrations.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ==================== Diagnostics Modal ==================== */}
                {diagnostics && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setDiagnostics(null)}>
                        <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
                            <div className="p-6 border-b flex justify-between items-center">
                                <h2 className="text-lg font-semibold">
                                    Agent Diagnostics - {diagnostics.server_name}
                                </h2>
                                <Button variant="ghost" size="sm" onClick={() => setDiagnostics(null)}>
                                    <XCircle size={18} />
                                </Button>
                            </div>
                            <div className="p-6 space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-sm text-gray-500">Status</label>
                                        <p className="font-semibold flex items-center gap-2">
                                            {diagnostics.connection.is_connected ? (
                                                <><Wifi size={16} className="text-green-500" /> Connected</>
                                            ) : (
                                                <><WifiOff size={16} className="text-red-500" /> Disconnected</>
                                            )}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-500">Agent Version</label>
                                        <p className="font-semibold">v{diagnostics.agent_version || 'Unknown'}</p>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-500">Current Latency</label>
                                        <p className="font-semibold">
                                            {diagnostics.connection.current_latency_ms != null
                                                ? `${diagnostics.connection.current_latency_ms.toFixed(1)} ms`
                                                : 'N/A'}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-500">Avg Latency</label>
                                        <p className="font-semibold">
                                            {diagnostics.connection.avg_latency_ms != null
                                                ? `${diagnostics.connection.avg_latency_ms.toFixed(1)} ms`
                                                : 'N/A'}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-500">IP Address</label>
                                        <p className="font-semibold">{diagnostics.connection.ip_address || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-500">Connected Since</label>
                                        <p className="font-semibold">
                                            {diagnostics.connection.connected_since
                                                ? new Date(diagnostics.connection.connected_since).toLocaleString()
                                                : 'N/A'}
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-3">Command Stats (24h)</h3>
                                    <div className="grid grid-cols-4 gap-3">
                                        <div className="text-center p-3 bg-gray-50 rounded">
                                            <div className="text-lg font-bold">{diagnostics.commands_24h.total}</div>
                                            <div className="text-xs text-gray-500">Total</div>
                                        </div>
                                        <div className="text-center p-3 bg-green-50 rounded">
                                            <div className="text-lg font-bold text-green-600">{diagnostics.commands_24h.success}</div>
                                            <div className="text-xs text-gray-500">Success</div>
                                        </div>
                                        <div className="text-center p-3 bg-red-50 rounded">
                                            <div className="text-lg font-bold text-red-600">{diagnostics.commands_24h.failed}</div>
                                            <div className="text-xs text-gray-500">Failed</div>
                                        </div>
                                        <div className="text-center p-3 bg-yellow-50 rounded">
                                            <div className="text-lg font-bold text-yellow-600">{diagnostics.commands_24h.timeout}</div>
                                            <div className="text-xs text-gray-500">Timeout</div>
                                        </div>
                                    </div>
                                </div>

                                {diagnostics.queued_commands > 0 && (
                                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2">
                                        <Clock size={16} className="text-yellow-600" />
                                        <span className="text-sm text-yellow-700">
                                            {diagnostics.queued_commands} commands queued for delivery
                                        </span>
                                    </div>
                                )}

                                <div>
                                    <h3 className="font-semibold mb-3">Recent Sessions</h3>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {diagnostics.recent_sessions.map(session => (
                                            <div key={session.id} className="flex justify-between items-center text-sm p-2 bg-gray-50 rounded">
                                                <div className="flex items-center gap-2">
                                                    {session.is_active ? (
                                                        <Wifi size={14} className="text-green-500" />
                                                    ) : (
                                                        <WifiOff size={14} className="text-gray-400" />
                                                    )}
                                                    <span>{session.ip_address}</span>
                                                </div>
                                                <div className="text-gray-500">
                                                    {new Date(session.connected_at).toLocaleString()}
                                                    {session.disconnect_reason && (
                                                        <span className="ml-2 text-red-500">({session.disconnect_reason})</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AgentFleet;
