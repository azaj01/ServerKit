import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, X, Container, Globe, RefreshCw, Boxes, Activity, Square,
    FileText, RotateCw, Play, Trash2, Settings,
} from 'lucide-react';
import api from '../services/api';
import EmptyState from '../components/EmptyState';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { getServiceType, getStatusConfig } from '../utils/serviceTypes';
import { Button } from '@/components/ui/button';
import { PageTopbar, MetricCard, Gauge } from '@/components/ds';
import SearchFilterBar from '../components/SearchFilterBar';
import ContainerStatusPill from '../components/status/ContainerStatusPill';
import { useContainerStatus } from '../hooks/useContainerStatus';

const Applications = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const [apps, setApps] = useState([]);
    const [appStats, setAppStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedApp, setSelectedApp] = useState(null);
    const [stats, setStats] = useState({
        total: 0,
        running: 0,
        stopped: 0,
        docker: 0
    });

    useEffect(() => {
        loadApps();
    }, []);

    async function loadApps() {
        setLoading(true);
        try {
            const data = await api.getApps();
            // Filter out WordPress apps - they have their own dedicated page at /wordpress
            const appList = (data.apps || []).filter(a => a.app_type !== 'wordpress');
            setApps(appList);

            // Calculate stats
            const running = appList.filter(a => a.status === 'running').length;
            const docker = appList.filter(a => a.app_type === 'docker').length;
            setStats({
                total: appList.length,
                running,
                stopped: appList.length - running,
                docker
            });

            // Load resource stats for running Docker apps (via container stats)
            const runningDockerApps = appList.filter(a => a.status === 'running' && a.app_type === 'docker');
            const statsPromises = runningDockerApps.map(async (app) => {
                try {
                    // Try to get container stats using app name as container reference
                    const containersData = await api.getContainers(false).catch(() => ({ containers: [] }));
                    const appContainer = containersData.containers?.find(c =>
                        c.name?.includes(app.name) || c.name?.includes(app.id)
                    );
                    if (appContainer) {
                        const statsData = await api.getContainerStats(appContainer.id).catch(() => null);
                        if (statsData?.stats) {
                            const cpuStr = statsData.stats.CPUPerc || '0%';
                            const memStr = statsData.stats.MemPerc || '0%';
                            return {
                                id: app.id,
                                stats: {
                                    cpu_percent: parseFloat(cpuStr.replace('%', '')) || 0,
                                    memory_percent: parseFloat(memStr.replace('%', '')) || 0
                                }
                            };
                        }
                    }
                    return { id: app.id, stats: null };
                } catch {
                    return { id: app.id, stats: null };
                }
            });

            const statsResults = await Promise.all(statsPromises);
            const statsMap = {};
            statsResults.forEach(({ id, stats }) => {
                if (stats) statsMap[id] = stats;
            });
            setAppStats(statsMap);
        } catch (err) {
            console.error('Failed to load apps:', err);
            toast.error('Failed to load applications');
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(appId, action) {
        try {
            if (action === 'start') {
                await api.startApp(appId);
                toast.success('Application started');
            } else if (action === 'stop') {
                await api.stopApp(appId);
                toast.success('Application stopped');
            } else if (action === 'restart') {
                await api.restartApp(appId);
                toast.success('Application restarted');
            } else if (action === 'delete') {
                const deleteConfirmed = await confirm({ title: 'Delete Application', message: 'Delete this application? This action cannot be undone.' });
                if (!deleteConfirmed) return;
                await api.deleteApp(appId);
                toast.success('Application deleted');
            }
            loadApps();
        } catch (err) {
            console.error(`Failed to ${action} app:`, err);
            toast.error(err.message || `Failed to ${action} application`);
        }
    }

    const filteredApps = apps.filter(app => {
        if (statusFilter === 'running' && app.status !== 'running') return false;
        if (statusFilter === 'stopped' && app.status === 'running') return false;
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return app.name?.toLowerCase().includes(search) ||
               app.app_type?.toLowerCase().includes(search);
    });

    if (loading) {
        return <EmptyState loading size="lg" title="Loading applications..." />;
    }

    return (
        <div className="page-container applications-page">
            <PageTopbar
                icon={<Boxes size={18} />}
                title="Applications"
                meta={`${stats.total} apps · ${stats.running} running`}
                actions={(
                    <>
                        <Button variant="outline" size="sm" onClick={loadApps}>
                            <RefreshCw size={14} /> Refresh
                        </Button>
                        <Button size="sm" onClick={() => setShowCreateModal(true)}>
                            <Plus size={16} /> New Application
                        </Button>
                    </>
                )}
            />

            {apps.length > 0 && (
                <div className="apps-kpis">
                    <MetricCard tone="green" icon={<Activity size={16} />} value={stats.running} label="Running" />
                    <MetricCard tone="amber" icon={<Square size={16} />} value={stats.stopped} label="Stopped" />
                    <MetricCard tone="cyan" icon={<Container size={16} />} value={stats.docker} label="Docker Apps">
                        <div className="sk-kpi__sub"><span>Container-based</span></div>
                    </MetricCard>
                    <MetricCard tone="accent" icon={<Boxes size={16} />} value={stats.total} label="Total Applications" />
                </div>
            )}

            <div className="apps-list-card">
                <div className="apps-list-head">
                    <SearchFilterBar
                        search={searchTerm}
                        onSearch={setSearchTerm}
                        placeholder="Search apps..."
                        filters={[
                            { key: 'all', label: 'All', count: stats.total },
                            { key: 'running', label: 'Running', count: stats.running },
                            { key: 'stopped', label: 'Stopped', count: stats.stopped },
                        ]}
                        activeFilter={statusFilter}
                        onFilterChange={setStatusFilter}
                    />
                </div>

                {filteredApps.length === 0 ? (
                    <EmptyState
                        icon={Boxes}
                        title="No applications"
                        description={searchTerm || statusFilter !== 'all'
                            ? 'Try adjusting your filters.'
                            : 'Create your first application to get started.'}
                        action={!searchTerm && statusFilter === 'all' && (
                            <Button onClick={() => setShowCreateModal(true)}><Plus size={16} /> New Application</Button>
                        )}
                    />
                ) : (
                    <table className="sk-dtable apps-table">
                        <thead>
                            <tr>
                                <th>Application</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Domain</th>
                                <th>Resources</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredApps.map(app => {
                                const res = appStats[app.id];
                                const typeInfo = getServiceType(app.app_type);
                                const statusInfo = getStatusConfig(app.status);
                                const isRunning = app.status === 'running';
                                const cpuPercent = res?.cpu_percent || 0;
                                const memPercent = res?.memory_percent || 0;

                                return (
                                    <tr key={app.id} className="is-clickable" onClick={() => navigate(`/apps/${app.id}`)}>
                                        <td>
                                            <div className="sk-cell-name">
                                                <span
                                                    className="apps-type-ico"
                                                    style={{ background: typeInfo.bgColor, color: typeInfo.color }}
                                                >
                                                    {app.app_type === 'docker'
                                                        ? <Container size={16} />
                                                        : (app.app_type || '?').charAt(0).toUpperCase()}
                                                </span>
                                                <div>
                                                    <div>{app.name}</div>
                                                    <div className="sk-cell-sub">id {app.id}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span
                                                className="apps-type-chip"
                                                style={{ color: typeInfo.color, background: typeInfo.bgColor, borderColor: typeInfo.borderColor }}
                                            >
                                                {typeInfo.label}
                                            </span>
                                        </td>
                                        <td>
                                            <AppStatusCell app={app} fallbackLabel={statusInfo.label} />
                                            {app.port && (
                                                <div className="sk-cell-sub">port {app.port}</div>
                                            )}
                                        </td>
                                        <td>
                                            {app.domains && app.domains.length > 0 ? (
                                                <div className={`apps-domain ${!isRunning ? 'is-faded' : ''}`}>
                                                    {app.domains.map((d, i) => (
                                                        <span key={i}>
                                                            <Globe size={11} /> {d.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="apps-none">—</span>
                                            )}
                                        </td>
                                        <td>
                                            <div className={!isRunning ? 'is-faded' : ''}>
                                                <div className="apps-res">
                                                    <span className="apps-res__label">CPU</span>
                                                    <Gauge value={cpuPercent} color="var(--accent-bright)" />
                                                    <span className="apps-res__val">{cpuPercent.toFixed(0)}%</span>
                                                </div>
                                                <div className="apps-res">
                                                    <span className="apps-res__label">RAM</span>
                                                    <Gauge value={memPercent} color="var(--cyan)" />
                                                    <span className="apps-res__val">{memPercent.toFixed(0)}%</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td onClick={(e) => e.stopPropagation()}>
                                            <div className="apps-actions-cell">
                                                <IconAction title="Logs" onClick={() => setSelectedApp(app)}>
                                                    <FileText size={14} />
                                                </IconAction>
                                                {isRunning ? (
                                                    <>
                                                        <IconAction title="Restart" onClick={() => handleAction(app.id, 'restart')}>
                                                            <RotateCw size={14} />
                                                        </IconAction>
                                                        <IconAction title="Stop" tone="red" onClick={() => handleAction(app.id, 'stop')}>
                                                            <Square size={13} />
                                                        </IconAction>
                                                    </>
                                                ) : (
                                                    <>
                                                        <IconAction title="Start" tone="green" onClick={() => handleAction(app.id, 'start')}>
                                                            <Play size={14} />
                                                        </IconAction>
                                                        <IconAction title="Delete" tone="red" onClick={() => handleAction(app.id, 'delete')}>
                                                            <Trash2 size={14} />
                                                        </IconAction>
                                                    </>
                                                )}
                                                <IconAction title="Manage" onClick={() => navigate(`/apps/${app.id}`)}>
                                                    <Settings size={14} />
                                                </IconAction>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {showCreateModal && (
                <CreateAppModal onClose={() => setShowCreateModal(false)} />
            )}

            {selectedApp && (
                <AppLogsModal
                    app={selectedApp}
                    onClose={() => setSelectedApp(null)}
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

// Per-row aggregated container status, driven by the centralized aggregator.
// Falls back to the app's persisted status label until the aggregator resolves.
const AppStatusCell = ({ app, fallbackLabel }) => {
    const { status } = useContainerStatus(app.id);
    return <ContainerStatusPill status={status} fallbackLabel={fallbackLabel} />;
};

// Per-row icon action (tones via modifier classes — no inline colors)
const IconAction = ({ title, onClick, tone, children, disabled }) => (
    <button
        type="button"
        className={`apps-icon-action${tone ? ` apps-icon-action--${tone}` : ''}`}
        title={title}
        onClick={onClick}
        disabled={disabled}
    >
        {children}
    </button>
);

// App Logs Modal
const AppLogsModal = ({ app, onClose }) => {
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [logType, setLogType] = useState('access');

    useEffect(() => {
        loadLogs();
    }, [app, logType]);

    async function loadLogs() {
        setLoading(true);
        try {
            // For Docker apps, try to get container logs
            if (app.app_type === 'docker') {
                const data = await api.getDockerAppLogs(app.id, 200);
                setLogs(data.logs || data.content || 'No logs available');
                return;
            }
            // For other apps, use app logs endpoint
            const data = await api.getAppLogs(app.name, logType, 200);
            setLogs(data.logs || data.content || 'No logs available');
        } catch (err) {
            setLogs('Failed to load logs: ' + (err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg app-logs-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Logs: {app.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {app.app_type !== 'docker' && (
                        <div className="app-logs-controls">
                            <select
                                value={logType}
                                onChange={(e) => setLogType(e.target.value)}
                                className="app-logs-select"
                            >
                                <option value="access">Access Logs</option>
                                <option value="error">Error Logs</option>
                            </select>
                        </div>
                    )}
                    <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
                </div>
                <div className="modal-actions">
                    <Button variant="outline" onClick={loadLogs}>Refresh</Button>
                    <Button onClick={onClose}>Close</Button>
                </div>
            </div>
        </div>
    );
};

// Create App Modal
const CreateAppModal = ({ onClose }) => {
    const navigate = useNavigate();

    // Brand categorical colors (literal on purpose)
    const templates = [
        { id: 'wordpress', name: 'WordPress', icon: 'W', color: '#21759b', description: 'Full WordPress installation with database' },
        { id: 'nextcloud', name: 'Nextcloud', icon: 'N', color: '#0082c9', description: 'Self-hosted cloud storage platform' },
        { id: 'grafana', name: 'Grafana', icon: 'G', color: '#f46800', description: 'Monitoring and observability dashboards' },
        { id: 'portainer', name: 'Portainer', icon: 'P', color: '#13bef9', description: 'Docker container management UI' },
        { id: 'uptime-kuma', name: 'Uptime Kuma', icon: 'U', color: '#5cdd8b', description: 'Self-hosted monitoring tool' },
        { id: 'gitea', name: 'Gitea', icon: 'G', color: '#609926', description: 'Lightweight Git hosting service' },
    ];

    function selectTemplate(templateId) {
        onClose();
        // WordPress has its own dedicated management page
        if (templateId === 'wordpress') {
            navigate('/wordpress');
        } else {
            navigate(`/templates?install=${templateId}`);
        }
    }

    function goToAllTemplates() {
        onClose();
        navigate('/templates');
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Select Application Type</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="app-type-grid">
                    {templates.map(template => (
                        <button
                            key={template.id}
                            className="app-type-card"
                            onClick={() => selectTemplate(template.id)}
                        >
                            <div className="app-type-icon" style={{ background: template.color }}>
                                {template.id === 'portainer' ? <Container size={20} /> : template.icon}
                            </div>
                            <h3>{template.name}</h3>
                            <p>{template.description}</p>
                        </button>
                    ))}
                </div>

                <div className="modal-footer">
                    <Button variant="outline" onClick={goToAllTemplates}>
                        Browse All Templates
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default Applications;
