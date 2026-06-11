import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { GitBranch, GitMerge, Boxes } from 'lucide-react';
import api from '../services/api';
import EmptyState from '../components/EmptyState';
import useTabParam from '../hooks/useTabParam';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DangerZone } from '../components/DangerZone';
import { InfoList, InfoItem } from '../components/InfoList';
import EnvironmentVariables from '../components/EnvironmentVariables';
import PrivateURLSection from '../components/PrivateURLSection';
import LinkedAppsSection from '../components/LinkedAppsSection';
import LinkAppModal from '../components/LinkAppModal';
import { getServiceType, getStatusConfig } from '../utils/serviceTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Pill, EnvTag } from '@/components/ds';

const VALID_TABS = ['overview', 'environment', 'packages', 'gunicorn', 'commands', 'build', 'deploy', 'logs', 'settings'];

// statusInfo.dotClass → ds Pill kind
const STATUS_PILL = {
    live: 'green',
    stopped: 'gray',
    deploying: 'amber',
    building: 'amber',
    failed: 'red',
};

const ApplicationDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [app, setApp] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useTabParam(`/apps/${id}`, VALID_TABS);

    useEffect(() => {
        loadApp();
    }, [id]);

    // Redirect WordPress apps to the dedicated WordPress detail page
    useEffect(() => {
        if (app && app.app_type === 'wordpress') {
            navigate(`/wordpress/${id}`, { replace: true });
        }
    }, [app, id, navigate]);

    async function loadApp() {
        try {
            const data = await api.getApp(id);
            setApp(data.app);
        } catch (err) {
            console.error('Failed to load app:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(action) {
        try {
            if (action === 'start') {
                await api.startApp(id);
            } else if (action === 'stop') {
                await api.stopApp(id);
            } else if (action === 'restart') {
                await api.restartApp(id);
            }
            loadApp();
        } catch (err) {
            console.error(`Failed to ${action} app:`, err);
        }
    }

    function getAppIcon(type) {
        switch (type) {
            case 'wordpress':
                return (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 19.542c-5.261 0-9.542-4.281-9.542-9.542S6.739 2.458 12 2.458 21.542 6.739 21.542 12 17.261 21.542 12 21.542z"/>
                        <path d="M3.019 12c0 3.403 1.977 6.347 4.844 7.746l-4.1-11.237C3.284 9.593 3.019 10.764 3.019 12zm15.109-.274c0-1.063-.382-1.799-.709-2.372-.436-.709-.845-1.309-.845-2.018 0-.791.6-1.527 1.446-1.527.038 0 .074.005.111.007A8.954 8.954 0 0012 3.019c-3.218 0-6.049 1.65-7.699 4.149.216.007.42.011.594.011.964 0 2.458-.117 2.458-.117.497-.029.555.701.059.76 0 0-.499.059-1.055.088l3.356 9.979 2.017-6.042-1.436-3.937c-.497-.029-.968-.088-.968-.088-.497-.029-.439-.789.058-.76 0 0 1.523.117 2.429.117.964 0 2.458-.117 2.458-.117.497-.029.556.701.059.76 0 0-.5.059-1.055.088l3.331 9.905.92-3.072c.398-1.275.702-2.19.702-2.978z"/>
                    </svg>
                );
            case 'docker':
                return (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z"/>
                    </svg>
                );
            default:
                return <span>{type.charAt(0).toUpperCase()}</span>;
        }
    }

    if (loading) {
        return <EmptyState loading size="lg" title="Loading application..." />;
    }

    if (!app) {
        return (
            <EmptyState
                size="lg"
                icon={Boxes}
                title="Application not found"
                action={<Button onClick={() => navigate('/apps')}>Back to Applications</Button>}
            />
        );
    }

    const isPythonApp = ['flask', 'django'].includes(app.app_type);
    const isDockerApp = app.app_type === 'docker';
    const isRunning = app.status === 'running';
    const typeInfo = getServiceType(app.app_type);
    const statusInfo = getStatusConfig(app.status);

    return (
        <div className="page-container app-detail-page">
            {/* Top Bar with Breadcrumbs and Actions */}
            <div className="app-detail-topbar">
                <div className="app-detail-breadcrumbs">
                    <Link to="/apps">Applications</Link>
                    <span>/</span>
                    <span className="current">{app.name}</span>
                </div>
                <div className="app-detail-actions">
                    {app.port && (
                        <Button variant="ghost" asChild>
                            <a
                                href={`http://localhost:${app.port}`}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                                Open App
                            </a>
                        </Button>
                    )}
                    {isRunning && (
                        <>
                            <Button variant="ghost" onClick={() => handleAction('restart')}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="23 4 23 10 17 10"/>
                                    <polyline points="1 20 1 14 7 14"/>
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                                </svg>
                                Restart
                            </Button>
                            <Button variant="outline" onClick={() => handleAction('stop')}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="6" width="12" height="12"/>
                                </svg>
                                Stop
                            </Button>
                        </>
                    )}
                    {!isRunning && (
                        <Button onClick={() => handleAction('start')}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"/>
                            </svg>
                            Start
                        </Button>
                    )}
                </div>
            </div>

            {/* App Header */}
            <div className="app-detail-header">
                <div className="app-detail-icon" style={{ background: typeInfo.bgColor, color: typeInfo.color }}>
                    {getAppIcon(app.app_type)}
                </div>
                <div className="app-detail-title-block">
                    <h1>
                        {app.name}
                        <Pill kind={STATUS_PILL[statusInfo.dotClass] || 'gray'}>{statusInfo.label}</Pill>
                        {app.environment_type && app.environment_type !== 'standalone' && (
                            <EnvTag env={app.environment_type}>
                                {app.environment_type === 'production' ? 'PROD' :
                                 app.environment_type === 'development' ? 'DEV' : 'STAGING'}
                                {app.has_linked_app && <GitBranch size={10} />}
                            </EnvTag>
                        )}
                    </h1>
                    <div className="app-detail-subtitle">
                        <span>{app.app_type.toUpperCase()}</span>
                        <span className="separator">&middot;</span>
                        {app.port && <><span className="mono">Port {app.port}</span><span className="separator">&middot;</span></>}
                        <span>Created {new Date(app.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="environment">Environment</TabsTrigger>
                    {isPythonApp && (
                        <>
                            <TabsTrigger value="packages">Packages</TabsTrigger>
                            <TabsTrigger value="gunicorn">Gunicorn</TabsTrigger>
                            <TabsTrigger value="commands">Commands</TabsTrigger>
                        </>
                    )}
                    <TabsTrigger value="build">Build</TabsTrigger>
                    <TabsTrigger value="deploy">Deploy</TabsTrigger>
                    <TabsTrigger value="logs">Logs</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                {/* Tab Content */}
                <div className="app-detail-content">
                    <TabsContent value="overview">
                        <OverviewTab app={app} onUpdate={loadApp} />
                    </TabsContent>
                    <TabsContent value="environment">
                        <EnvironmentVariables appId={app.id} />
                    </TabsContent>
                    {isPythonApp && (
                        <>
                            <TabsContent value="packages">
                                <PackagesTab appId={app.id} />
                            </TabsContent>
                            <TabsContent value="gunicorn">
                                <GunicornTab appId={app.id} />
                            </TabsContent>
                            <TabsContent value="commands">
                                <CommandsTab appId={app.id} appType={app.app_type} />
                            </TabsContent>
                        </>
                    )}
                    <TabsContent value="build">
                        <BuildTab appId={app.id} appPath={app.path} />
                    </TabsContent>
                    <TabsContent value="deploy">
                        <DeployTab appId={app.id} appPath={app.path} />
                    </TabsContent>
                    <TabsContent value="logs">
                        <LogsTab app={app} />
                    </TabsContent>
                    <TabsContent value="settings">
                        <SettingsTab app={app} onUpdate={loadApp} />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
};

// Overview Tab with new grid layout
const OverviewTab = ({ app, onUpdate }) => {
    const navigate = useNavigate();
    const { confirm: confirmOverview, confirmState: confirmOverviewState, handleConfirm: handleOverviewConfirm, handleCancel: handleOverviewCancel } = useConfirm();
    const [status, setStatus] = useState(null);
    const [appStatus, setAppStatus] = useState(null);
    const [linkedApps, setLinkedApps] = useState([]);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [linkLoading, setLinkLoading] = useState(false);
    const [containerStats, setContainerStats] = useState(null);

    useEffect(() => {
        if (['flask', 'django'].includes(app.app_type)) {
            loadStatus();
        }
        loadAppStatus();
        loadLinkedApps();
        if (app.app_type === 'docker') {
            loadContainerStats();
        }
    }, [app]);

    async function loadStatus() {
        try {
            const data = await api.getPythonAppStatus(app.id);
            setStatus(data);
        } catch (err) {
            console.error('Failed to load status:', err);
        }
    }

    async function loadAppStatus() {
        try {
            const data = await api.getAppStatus(app.id);
            setAppStatus(data);
        } catch (err) {
            console.error('Failed to load app status:', err);
        }
    }

    async function loadLinkedApps() {
        try {
            const data = await api.getLinkedApps(app.id);
            setLinkedApps(data.linked_apps || []);
        } catch (err) {
            console.error('Failed to load linked apps:', err);
        }
    }

    async function loadContainerStats() {
        try {
            // Try to get container stats for docker apps
            const containers = await api.getContainers(true);
            const appContainer = containers.containers?.find(c =>
                c.name?.includes(app.name) || c.name?.includes(app.slug)
            );
            if (appContainer && appContainer.state === 'running') {
                const stats = await api.getContainerStats(appContainer.id);
                setContainerStats(stats.stats);
            }
        } catch (err) {
            console.error('Failed to load container stats:', err);
        }
    }

    async function handleUnlink() {
        const confirmed = await confirmOverview({ title: 'Unlink Apps', message: 'Are you sure you want to unlink these apps? Database credentials will remain unchanged.', variant: 'warning' });
        if (!confirmed) {
            return;
        }
        setLinkLoading(true);
        try {
            await api.unlinkApp(app.id);
            onUpdate();
            loadLinkedApps();
        } catch (err) {
            console.error('Failed to unlink apps:', err);
        } finally {
            setLinkLoading(false);
        }
    }

    function handleLinked() {
        onUpdate();
        loadLinkedApps();
    }

    function parseResourceValue(value) {
        if (!value) return 0;
        return parseFloat(value.replace('%', '')) || 0;
    }

    return (
        <div className="app-overview-grid">
            {/* Left Column */}
            <div className="app-overview-left">
                {/* Application Info Panel */}
                <div className="app-panel">
                    <div className="app-panel-header">Application Info</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item">
                                <span className="app-info-label">Type</span>
                                <span className="app-info-value">{app.app_type === 'docker' ? 'Docker Container' : app.app_type.toUpperCase()}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Port</span>
                                <span className="app-info-value">
                                    {app.port || '-'}
                                    {appStatus && app.port && (
                                        <span className={`port-indicator ${appStatus.port_accessible ? 'accessible' : ''}`}>
                                            {appStatus.port_accessible ? ' (accessible)' : ' (not accessible)'}
                                        </span>
                                    )}
                                </span>
                            </div>
                            {app.python_version && (
                                <div className="app-info-item">
                                    <span className="app-info-label">Python Version</span>
                                    <span className="app-info-value">{app.python_version}</span>
                                </div>
                            )}
                            {app.php_version && (
                                <div className="app-info-item">
                                    <span className="app-info-label">PHP Version</span>
                                    <span className="app-info-value">{app.php_version}</span>
                                </div>
                            )}
                            <div className="app-info-item full-width">
                                <span className="app-info-label">Root Path</span>
                                <div><span className="app-path-value">{app.root_path || `/var/serverkit/apps/${app.name}`}</span></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Routing Diagnostics Panel (Docker apps only) */}
                {app.app_type === 'docker' && (
                    <RoutingDiagnosticsPanel appId={app.id} />
                )}

                {/* Environment Linking Panel */}
                <div className="app-panel">
                    <div className="app-panel-header">Environment Linking</div>
                    <div className="app-panel-body">
                        <p className="app-panel-hint">
                            Link this app to another to create a production/development pair. Linked apps can share database credentials.
                        </p>
                        <LinkedAppsSection
                            app={app}
                            linkedApps={linkedApps}
                            onLink={() => setShowLinkModal(true)}
                            onUnlink={handleUnlink}
                            onNavigate={(appId) => navigate(`/apps/${appId}`)}
                            loading={linkLoading}
                            compact
                        />
                    </div>
                </div>

                {/* Process Status (Python apps) */}
                {status && (
                    <div className="app-panel">
                        <div className="app-panel-header">Process Status</div>
                        <div className="app-panel-body">
                            <div className="app-info-grid">
                                <div className="app-info-item">
                                    <span className="app-info-label">Service</span>
                                    <span className="app-info-value mono">{status.service_name}</span>
                                </div>
                                <div className="app-info-item">
                                    <span className="app-info-label">State</span>
                                    <span className="app-info-value">{status.active_state} ({status.sub_state})</span>
                                </div>
                                {status.main_pid !== '0' && (
                                    <div className="app-info-item">
                                        <span className="app-info-label">PID</span>
                                        <span className="app-info-value mono">{status.main_pid}</span>
                                    </div>
                                )}
                                {status.memory && status.memory !== '0' && (
                                    <div className="app-info-item">
                                        <span className="app-info-label">Memory</span>
                                        <span className="app-info-value">{formatBytes(parseInt(status.memory))}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Domains Panel */}
                {app.domains && app.domains.length > 0 && (
                    <div className="app-panel">
                        <div className="app-panel-header">Domains</div>
                        <div className="app-panel-body">
                            <div className="domains-list">
                                {app.domains.map(domain => (
                                    <div key={domain.id} className="domain-item">
                                        <a href={`https://${domain.name}`} target="_blank" rel="noopener noreferrer">
                                            {domain.name}
                                        </a>
                                        {domain.ssl_enabled && (
                                            <span className="ssl-badge">SSL</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right Column */}
            <div className="app-overview-right">
                {/* Private URL Panel (Docker apps with port) */}
                {app.app_type === 'docker' && app.port && (
                    <PrivateURLSection app={app} onUpdate={onUpdate} />
                )}

                {/* Live Resources Panel */}
                {app.app_type === 'docker' && (
                    <div className="app-panel">
                        <div className="app-panel-header">Live Resources</div>
                        <div className="app-panel-body">
                            <div className="resource-bar-container">
                                <div className="resource-bar-header">
                                    <span className="resource-bar-label">CPU Load</span>
                                    <span className="resource-bar-value">
                                        {containerStats ? `${parseResourceValue(containerStats.CPUPerc).toFixed(0)}%` : '-'}
                                    </span>
                                </div>
                                <div className="resource-bar-track">
                                    <div
                                        className="resource-bar-fill cpu"
                                        style={{ width: `${containerStats ? parseResourceValue(containerStats.CPUPerc) : 0}%` }}
                                    />
                                </div>
                            </div>
                            <div className="resource-bar-container">
                                <div className="resource-bar-header">
                                    <span className="resource-bar-label">RAM Usage</span>
                                    <span className="resource-bar-value">
                                        {containerStats?.MemUsage || '-'}
                                    </span>
                                </div>
                                <div className="resource-bar-track">
                                    <div
                                        className="resource-bar-fill ram"
                                        style={{ width: `${containerStats ? parseResourceValue(containerStats.MemPerc) : 0}%` }}
                                    />
                                </div>
                            </div>
                            {!containerStats && app.status !== 'running' && (
                                <p className="resource-hint">Start the container to see live resources.</p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {showLinkModal && (
                <LinkAppModal
                    app={app}
                    onClose={() => setShowLinkModal(false)}
                    onLinked={handleLinked}
                />
            )}
            <ConfirmDialog
                isOpen={confirmOverviewState.isOpen}
                title={confirmOverviewState.title}
                message={confirmOverviewState.message}
                confirmText={confirmOverviewState.confirmText}
                cancelText={confirmOverviewState.cancelText}
                variant={confirmOverviewState.variant}
                onConfirm={handleOverviewConfirm}
                onCancel={handleOverviewCancel}
            />
        </div>
    );
};

// Routing Diagnostics Panel
const RoutingDiagnosticsPanel = ({ appId }) => {
    const [diagnostics, setDiagnostics] = useState(null);
    const [loading, setLoading] = useState(false);
    const [lastChecked, setLastChecked] = useState(null);

    async function runDiagnostics() {
        setLoading(true);
        try {
            const response = await fetch(`/api/v1/domains/debug/diagnose/${appId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                }
            });
            const data = await response.json();
            setDiagnostics(data);
            setLastChecked(new Date());
        } catch (err) {
            console.error('Failed to run diagnostics:', err);
        } finally {
            setLoading(false);
        }
    }

    const isHealthy = diagnostics?.health?.overall;

    return (
        <div className="app-panel">
            <div className="app-panel-header">
                <span>Routing Diagnostics</span>
                <span className="app-panel-header-actions">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={runDiagnostics}
                        disabled={loading}
                    >
                        {loading ? 'Checking...' : 'Run Diagnostics'}
                    </Button>
                </span>
            </div>
            <div className="app-panel-body">
                {diagnostics ? (
                    <>
                        <div className={`diag-status ${isHealthy ? 'healthy' : 'unhealthy'}`}>
                            <div className={`diag-icon ${isHealthy ? 'healthy' : 'unhealthy'}`}>
                                {isHealthy ? '✓' : '✗'}
                            </div>
                            <div className="diag-text">
                                <h4>{isHealthy ? 'Configuration Healthy' : 'Issues Detected'}</h4>
                                <p>
                                    {lastChecked && `Last checked: ${Math.round((Date.now() - lastChecked) / 60000)} minutes ago. `}
                                    {isHealthy ? 'No routing issues detected.' : 'Some checks failed.'}
                                </p>
                            </div>
                        </div>
                        {diagnostics.health?.issues?.length > 0 && (
                            <ul className="diag-issues">
                                {diagnostics.health.issues.map((issue, i) => (
                                    <li key={i}>{issue}</li>
                                ))}
                            </ul>
                        )}
                    </>
                ) : (
                    <p className="app-panel-hint">
                        Click &quot;Run Diagnostics&quot; to check routing configuration and identify issues.
                    </p>
                )}
            </div>
        </div>
    );
};

// Helper function
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================================
// EXISTING TAB COMPONENTS (preserved)
// ============================================

const PackagesTab = ({ appId }) => {
    const toast = useToast();
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [newPackage, setNewPackage] = useState('');

    useEffect(() => {
        loadPackages();
    }, [appId]);

    async function loadPackages() {
        try {
            const data = await api.getPythonPackages(appId);
            setPackages(data.packages || []);
        } catch (err) {
            console.error('Failed to load packages:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleInstall(e) {
        e.preventDefault();
        if (!newPackage.trim()) return;

        setInstalling(true);
        try {
            await api.installPythonPackages(appId, [newPackage.trim()]);
            setNewPackage('');
            loadPackages();
        } catch (err) {
            console.error('Failed to install package:', err);
        } finally {
            setInstalling(false);
        }
    }

    async function handleFreeze() {
        try {
            await api.freezePythonRequirements(appId);
            toast.success('requirements.txt updated');
        } catch (err) {
            toast.error('Failed to freeze requirements');
            console.error('Failed to freeze requirements:', err);
        }
    }

    if (loading) {
        return <EmptyState loading title="Loading packages..." />;
    }

    return (
        <div>
            <div className="section-header">
                <h3>Installed Packages</h3>
                <Button variant="outline" size="sm" onClick={handleFreeze}>
                    Freeze to requirements.txt
                </Button>
            </div>

            <form className="install-form" onSubmit={handleInstall}>
                <Input
                    type="text"
                    value={newPackage}
                    onChange={(e) => setNewPackage(e.target.value)}
                    placeholder="Package name (e.g., requests, flask==2.0.0)"
                />
                <Button type="submit" disabled={installing}>
                    {installing ? 'Installing...' : 'Install'}
                </Button>
            </form>

            <div className="packages-list">
                {packages.map(pkg => (
                    <div key={pkg.name} className="package-item">
                        <span className="package-name">{pkg.name}</span>
                        <span className="package-version">{pkg.version}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const GunicornTab = ({ appId }) => {
    const toast = useToast();
    const [config, setConfig] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadConfig();
    }, [appId]);

    async function loadConfig() {
        try {
            const data = await api.getGunicornConfig(appId);
            setConfig(data.content || '');
        } catch (err) {
            console.error('Failed to load config:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        try {
            await api.updateGunicornConfig(appId, config);
            toast.success('Configuration saved. Restart the app to apply changes.');
        } catch (err) {
            toast.error('Failed to save configuration');
            console.error('Failed to save config:', err);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <EmptyState loading title="Loading Gunicorn configuration..." />;
    }

    return (
        <div>
            <div className="section-header">
                <h3>Gunicorn Configuration</h3>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                </Button>
            </div>
            <textarea
                className="code-editor"
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                spellCheck={false}
            />
        </div>
    );
};

const CommandsTab = ({ appId, appType }) => {
    const [command, setCommand] = useState('');
    const [output, setOutput] = useState(null);
    const [running, setRunning] = useState(false);

    const quickCommands = appType === 'django' ? [
        { label: 'Run Migrations', cmd: 'python manage.py migrate' },
        { label: 'Collect Static', cmd: 'python manage.py collectstatic --noinput' },
        { label: 'Create Superuser', cmd: 'python manage.py createsuperuser' },
        { label: 'Shell', cmd: 'python manage.py shell' },
        { label: 'Check', cmd: 'python manage.py check' },
    ] : [
        { label: 'Flask Routes', cmd: 'flask routes' },
        { label: 'Flask Shell', cmd: 'flask shell' },
        { label: 'DB Upgrade', cmd: 'flask db upgrade' },
        { label: 'DB Migrate', cmd: 'flask db migrate' },
    ];

    async function handleRun(cmd) {
        const commandToRun = cmd || command;
        if (!commandToRun.trim()) return;

        setRunning(true);
        setOutput(null);

        try {
            const result = await api.runPythonCommand(appId, commandToRun);
            setOutput(result);
        } catch (err) {
            setOutput({ success: false, stderr: err.message });
        } finally {
            setRunning(false);
        }
    }

    return (
        <div>
            <h3 className="app-eyebrow">Run Commands</h3>
            <p className="hint">Commands run in the app&apos;s virtual environment context.</p>

            <div className="quick-commands">
                {quickCommands.map(({ label, cmd }) => (
                    <Button
                        key={cmd}
                        variant="outline"
                        size="sm"
                        onClick={() => handleRun(cmd)}
                        disabled={running}
                    >
                        {label}
                    </Button>
                ))}
            </div>

            <div className="command-input">
                <Input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="Enter command..."
                    onKeyDown={(e) => e.key === 'Enter' && handleRun()}
                />
                <Button
                    onClick={() => handleRun()}
                    disabled={running}
                >
                    {running ? 'Running...' : 'Run'}
                </Button>
            </div>

            {output && (
                <div className={`command-output ${output.success ? '' : 'error'}`}>
                    {output.stdout && <pre>{output.stdout}</pre>}
                    {output.stderr && <pre className="stderr">{output.stderr}</pre>}
                    {!output.stdout && !output.stderr && (
                        <pre>{output.success ? 'Command completed successfully' : 'Command failed'}</pre>
                    )}
                </div>
            )}
        </div>
    );
};

const BuildTab = ({ appId, appPath }) => {
    const toast = useToast();
    const { confirm: confirmBuild, confirmState: confirmBuildState, handleConfirm: handleBuildConfirm, handleCancel: handleBuildCancel } = useConfirm();
    const [buildConfig, setBuildConfig] = useState(null);
    const [detection, setDetection] = useState(null);
    const [deployments, setDeployments] = useState([]);
    const [currentDeployment, setCurrentDeployment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [building, setBuilding] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showLogsModal, setShowLogsModal] = useState(false);
    const [selectedLog, setSelectedLog] = useState(null);
    const [buildLogs, setBuildLogs] = useState([]);
    const [error, setError] = useState(null);

    const [configForm, setConfigForm] = useState({
        buildMethod: 'auto',
        dockerfilePath: 'Dockerfile',
        customBuildCmd: '',
        customStartCmd: '',
        cacheEnabled: true,
        timeout: 600,
        keepDeployments: 5
    });

    useEffect(() => {
        loadData();
    }, [appId]);

    async function loadData() {
        try {
            setLoading(true);
            const [configRes, detectRes, deploymentsRes] = await Promise.all([
                api.getBuildConfig(appId),
                api.detectBuildMethod(appId),
                api.getDeployments(appId, 10)
            ]);

            setDetection(detectRes);

            if (configRes.configured) {
                setBuildConfig(configRes.config);
                setConfigForm({
                    buildMethod: configRes.config.build_method || 'auto',
                    dockerfilePath: configRes.config.dockerfile_path || 'Dockerfile',
                    customBuildCmd: configRes.config.custom_build_cmd || '',
                    customStartCmd: configRes.config.custom_start_cmd || '',
                    cacheEnabled: configRes.config.cache_enabled !== false,
                    timeout: configRes.config.timeout || 600,
                    keepDeployments: configRes.config.keep_deployments || 5
                });
            }

            setDeployments(deploymentsRes.deployments || []);
            setCurrentDeployment(deploymentsRes.current);

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleConfigureBuild(e) {
        e.preventDefault();
        try {
            await api.configureBuild(appId, {
                build_method: configForm.buildMethod,
                dockerfile_path: configForm.dockerfilePath,
                custom_build_cmd: configForm.customBuildCmd || null,
                custom_start_cmd: configForm.customStartCmd || null,
                cache_enabled: configForm.cacheEnabled,
                timeout: configForm.timeout,
                keep_deployments: configForm.keepDeployments
            });
            setShowConfigModal(false);
            toast.success('Build configuration saved');
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleBuild(noCache = false) {
        setBuilding(true);
        setError(null);
        try {
            const result = await api.triggerBuild(appId, noCache);
            if (result.success) {
                toast.success('Build completed successfully');
            } else {
                setError(result.error || 'Build failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setBuilding(false);
        }
    }

    async function handleDeploy(noCache = false) {
        setDeploying(true);
        setError(null);
        try {
            const result = await api.deployApp(appId, { no_cache: noCache });
            if (result.success) {
                toast.success(`Deployment v${result.deployment.version} successful!`);
            } else {
                setError(result.error || 'Deployment failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    async function handleRollback(version = null) {
        const rollbackMsg = version
            ? `Rollback to version ${version}? This will replace the current deployment.`
            : 'Rollback to previous deployment?';
        const confirmed = await confirmBuild({ title: 'Rollback', message: rollbackMsg, variant: 'warning' });
        if (!confirmed) return;

        setDeploying(true);
        setError(null);
        try {
            const result = await api.rollback(appId, version);
            if (result.success) {
                toast.success('Rollback successful');
            } else {
                setError(result.error || 'Rollback failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    function getStatusPillKind(status) {
        switch (status) {
            case 'live': return 'green';
            case 'building':
            case 'deploying':
            case 'pending': return 'amber';
            case 'failed': return 'red';
            case 'rolled_back': return 'gray';
            default: return 'gray';
        }
    }

    function formatDuration(seconds) {
        if (!seconds) return '-';
        if (seconds < 60) return `${Math.round(seconds)}s`;
        return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    }

    if (loading) {
        return <EmptyState loading title="Loading build configuration..." />;
    }

    return (
        <div className="build-tab">
            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            {detection && (
                <div className="card">
                    <h3>Auto-Detection Results</h3>
                    <div className="detection-results">
                        <div className="detection-item">
                            <span className="detection-label">Detected Method:</span>
                            <span className="detection-value">{detection.detected_method || 'None'}</span>
                        </div>
                        {detection.dockerfile_exists && (
                            <div className="detection-item">
                                <span className="detection-label">Dockerfile:</span>
                                <span className="detection-value">Found</span>
                            </div>
                        )}
                        {detection.docker_compose_exists && (
                            <div className="detection-item">
                                <span className="detection-label">Docker Compose:</span>
                                <span className="detection-value">Found</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-header-row">
                    <h3>Build Configuration</h3>
                    <Button variant="outline" size="sm" onClick={() => setShowConfigModal(true)}>
                        Configure
                    </Button>
                </div>
                {buildConfig ? (
                    <InfoList>
                        <InfoItem label="Method" value={buildConfig.build_method} />
                        <InfoItem label="Timeout" value={`${buildConfig.timeout}s`} />
                    </InfoList>
                ) : (
                    <p className="hint">No build configuration. Click Configure to set up.</p>
                )}
                <div className="card-actions">
                    <Button
                        onClick={() => handleDeploy(false)}
                        disabled={deploying || building}
                    >
                        {deploying ? 'Deploying...' : 'Build & Deploy'}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => handleBuild(false)}
                        disabled={building || deploying}
                    >
                        {building ? 'Building...' : 'Build Only'}
                    </Button>
                </div>
            </div>

            {deployments.length > 0 && (
                <div className="card">
                    <h3>Deployment History</h3>
                    <div className="deployments-list">
                        {deployments.map(dep => (
                            <div key={dep.version} className={`deployment-item ${dep.status === 'live' ? 'current' : ''}`}>
                                <div className="deployment-info">
                                    <span className="deployment-version">v{dep.version}</span>
                                    <Pill kind={getStatusPillKind(dep.status)}>{dep.status}</Pill>
                                </div>
                                <div className="deployment-meta">
                                    <span>{new Date(dep.created_at).toLocaleString()}</span>
                                    <span>{formatDuration(dep.build_duration)}</span>
                                </div>
                                {dep.status !== 'live' && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRollback(dep.version)}
                                        disabled={deploying}
                                    >
                                        Rollback
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {showConfigModal && (
                <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Build Configuration</h2>
                            <button className="modal-close" onClick={() => setShowConfigModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleConfigureBuild}>
                            <div className="form-group">
                                <label>Build Method</label>
                                <select
                                    value={configForm.buildMethod}
                                    onChange={e => setConfigForm({...configForm, buildMethod: e.target.value})}
                                >
                                    <option value="auto">Auto-detect</option>
                                    <option value="dockerfile">Dockerfile</option>
                                    <option value="docker-compose">Docker Compose</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </div>
                            {configForm.buildMethod === 'dockerfile' && (
                                <div className="form-group">
                                    <label>Dockerfile Path</label>
                                    <Input
                                        type="text"
                                        value={configForm.dockerfilePath}
                                        onChange={e => setConfigForm({...configForm, dockerfilePath: e.target.value})}
                                    />
                                </div>
                            )}
                            {configForm.buildMethod === 'custom' && (
                                <>
                                    <div className="form-group">
                                        <label>Build Command</label>
                                        <Input
                                            type="text"
                                            value={configForm.customBuildCmd}
                                            onChange={e => setConfigForm({...configForm, customBuildCmd: e.target.value})}
                                            placeholder="npm run build"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Start Command</label>
                                        <Input
                                            type="text"
                                            value={configForm.customStartCmd}
                                            onChange={e => setConfigForm({...configForm, customStartCmd: e.target.value})}
                                            placeholder="npm start"
                                        />
                                    </div>
                                </>
                            )}
                            <div className="form-group">
                                <label>Timeout (seconds)</label>
                                <Input
                                    type="number"
                                    value={configForm.timeout}
                                    onChange={e => setConfigForm({...configForm, timeout: parseInt(e.target.value)})}
                                />
                            </div>
                            <div className="modal-actions">
                                <Button type="button" variant="outline" onClick={() => setShowConfigModal(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    Save Configuration
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            <ConfirmDialog
                isOpen={confirmBuildState.isOpen}
                title={confirmBuildState.title}
                message={confirmBuildState.message}
                confirmText={confirmBuildState.confirmText}
                cancelText={confirmBuildState.cancelText}
                variant={confirmBuildState.variant}
                onConfirm={handleBuildConfirm}
                onCancel={handleBuildCancel}
            />
        </div>
    );
};

const LogsTab = ({ app }) => {
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(false);

    const isDockerApp = app.app_type === 'docker';
    const isPythonApp = ['flask', 'django'].includes(app.app_type);

    useEffect(() => {
        loadLogs();
    }, [app.id]);

    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(loadLogs, 5000);
        return () => clearInterval(interval);
    }, [autoRefresh, app.id]);

    async function loadLogs() {
        try {
            let data;
            if (isDockerApp) {
                data = await api.getDockerAppLogs(app.id, 200);
            } else if (isPythonApp) {
                data = await api.getPythonAppLogs(app.id, 200);
            } else {
                data = { logs: 'Logs not available for this app type.' };
            }
            setLogs(data.logs || 'No logs available');
        } catch (err) {
            console.error('Failed to load logs:', err);
            setLogs('Failed to load logs');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="logs-tab">
            <div className="logs-header">
                <h3>Application Logs</h3>
                <div className="logs-controls">
                    {isPythonApp && (
                        <span className="hint">Gunicorn/systemd Logs</span>
                    )}
                    {isDockerApp && (
                        <span className="hint">Docker Compose Logs</span>
                    )}
                    <label className="checkbox-inline">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        Auto-refresh
                    </label>
                    <Button variant="outline" size="sm" onClick={loadLogs}>
                        Refresh
                    </Button>
                </div>
            </div>
            <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
        </div>
    );
};

const SettingsTab = ({ app, onUpdate }) => {
    const navigate = useNavigate();
    const { confirm: confirmAppSettings, confirmState: confirmAppSettingsState, handleConfirm: handleAppSettingsConfirm, handleCancel: handleAppSettingsCancel } = useConfirm();
    const [deleting, setDeleting] = useState(false);
    const [environmentType, setEnvironmentType] = useState(app.environment_type || 'standalone');
    const [savingEnvironment, setSavingEnvironment] = useState(false);
    const [unlinking, setUnlinking] = useState(false);

    const envLabels = {
        standalone: 'Standalone',
        production: 'Production',
        development: 'Development',
        staging: 'Staging'
    };

    async function handleDelete() {
        const firstConfirm = await confirmAppSettings({ title: 'Delete Application', message: `Delete ${app.name}? This action cannot be undone.` });
        if (!firstConfirm) return;
        const secondConfirm = await confirmAppSettings({ title: 'Confirm Deletion', message: 'Are you sure? This will permanently delete the application and all its data.' });
        if (!secondConfirm) return;

        setDeleting(true);
        try {
            await api.deleteApp(app.id);
            navigate('/apps');
        } catch (err) {
            console.error('Failed to delete app:', err);
            setDeleting(false);
        }
    }

    async function handleEnvironmentChange(newType) {
        if (newType === app.environment_type) return;

        setSavingEnvironment(true);
        try {
            await api.updateAppEnvironment(app.id, newType);
            setEnvironmentType(newType);
            onUpdate();
        } catch (err) {
            console.error('Failed to update environment:', err);
            setEnvironmentType(app.environment_type || 'standalone');
        } finally {
            setSavingEnvironment(false);
        }
    }

    async function handleUnlink() {
        const confirmed = await confirmAppSettings({ title: 'Unlink Application', message: `Unlink ${app.name} from its linked application? Both apps will become standalone.`, variant: 'warning' });
        if (!confirmed) return;

        setUnlinking(true);
        try {
            await api.unlinkApp(app.id);
            onUpdate();
        } catch (err) {
            console.error('Failed to unlink app:', err);
        } finally {
            setUnlinking(false);
        }
    }

    return (
        <div>
            <h3 className="app-eyebrow">Application Settings</h3>

            <div className="card settings-section">
                <h4>Environment Configuration</h4>
                <div className="settings-row">
                    <div className="settings-label">
                        <span>Environment Type</span>
                        <span className="settings-hint">
                            {app.has_linked_app
                                ? 'This app is linked. Unlink to change environment type.'
                                : 'Set how this application is used in your workflow.'}
                        </span>
                    </div>
                    <div className="settings-control">
                        {app.has_linked_app ? (
                            <EnvTag env={app.environment_type}>
                                {envLabels[app.environment_type] || app.environment_type}
                            </EnvTag>
                        ) : (
                            <select
                                value={environmentType}
                                onChange={(e) => handleEnvironmentChange(e.target.value)}
                                disabled={savingEnvironment}
                                className="settings-select"
                            >
                                <option value="standalone">Standalone</option>
                                <option value="development">Development</option>
                                <option value="staging">Staging</option>
                                <option value="production">Production</option>
                            </select>
                        )}
                        {savingEnvironment && <span className="settings-saving">Saving...</span>}
                    </div>
                </div>

                {app.has_linked_app && (
                    <div className="settings-row settings-linked-warning">
                        <div className="settings-label">
                            <span>Linked Application</span>
                            <span className="settings-hint">
                                This app is linked to another application. Unlinking will reset both apps to standalone mode.
                            </span>
                        </div>
                        <div className="settings-control">
                            <Button
                                variant="outline"
                                onClick={handleUnlink}
                                disabled={unlinking}
                            >
                                {unlinking ? 'Unlinking...' : 'Unlink Application'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <DangerZone
                title="Danger Zone"
                description="Once you delete an application, there is no going back."
                action={
                    <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                        {deleting ? 'Deleting...' : 'Delete Application'}
                    </Button>
                }
            />
            <ConfirmDialog
                isOpen={confirmAppSettingsState.isOpen}
                title={confirmAppSettingsState.title}
                message={confirmAppSettingsState.message}
                confirmText={confirmAppSettingsState.confirmText}
                cancelText={confirmAppSettingsState.cancelText}
                variant={confirmAppSettingsState.variant}
                onConfirm={handleAppSettingsConfirm}
                onCancel={handleAppSettingsCancel}
            />
        </div>
    );
};

const DeployTab = ({ appId, appPath }) => {
    const toast = useToast();
    const { confirm: confirmDeploy, confirmState: confirmDeployState, handleConfirm: handleDeployConfirm, handleCancel: handleDeployCancel } = useConfirm();
    const [config, setConfig] = useState(null);
    const [gitStatus, setGitStatus] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [branches, setBranches] = useState([]);
    const [error, setError] = useState(null);

    const [configForm, setConfigForm] = useState({
        repoUrl: '',
        branch: 'main',
        autoDeploy: true,
        preDeployScript: '',
        postDeployScript: ''
    });

    useEffect(() => {
        loadData();
    }, [appId]);

    async function loadData() {
        try {
            setLoading(true);
            const [configRes, historyRes] = await Promise.all([
                api.getDeployConfig(appId),
                api.getDeploymentHistory(appId, 20)
            ]);

            if (configRes.configured) {
                setConfig(configRes.config);
                setConfigForm({
                    repoUrl: configRes.config.repo_url || '',
                    branch: configRes.config.branch || 'main',
                    autoDeploy: configRes.config.auto_deploy !== false,
                    preDeployScript: configRes.config.pre_deploy_script || '',
                    postDeployScript: configRes.config.post_deploy_script || ''
                });
                try {
                    const statusRes = await api.getAppGitStatus(appId);
                    setGitStatus(statusRes);
                } catch { /* git status is optional context for the deploy tab */ }
            } else {
                setConfig(null);
            }

            setHistory(historyRes.deployments || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleConfigureDeployment(e) {
        e.preventDefault();
        try {
            await api.configureDeployment(
                appId,
                configForm.repoUrl,
                configForm.branch,
                configForm.autoDeploy,
                configForm.preDeployScript || null,
                configForm.postDeployScript || null
            );
            setShowConfigModal(false);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleRemoveDeployment() {
        const confirmed = await confirmDeploy({ title: 'Remove Deployment', message: 'Remove deployment configuration? This will not delete the repository files.', variant: 'warning' });
        if (!confirmed) return;
        try {
            await api.removeDeployment(appId);
            setConfig(null);
            setGitStatus(null);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleDeploy(force = false) {
        setDeploying(true);
        setError(null);
        try {
            const result = await api.triggerAppDeploy(appId, force);
            if (result.success) {
                toast.success('Deployment completed successfully!');
            } else {
                setError(result.error || 'Deployment failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    async function handlePull() {
        setDeploying(true);
        setError(null);
        try {
            const result = await api.pullChanges(appId);
            if (result.success) {
                toast.success('Changes pulled successfully!');
            } else {
                setError(result.error || 'Pull failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    function getStatusPillKind(status) {
        switch (status) {
            case 'success': return 'green';
            case 'failed': return 'red';
            case 'in_progress': return 'amber';
            default: return 'gray';
        }
    }

    if (loading) {
        return <EmptyState loading title="Loading deployment configuration..." />;
    }

    return (
        <div className="deploy-tab">
            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            {!config ? (
                <div className="deploy-setup">
                    <EmptyState
                        icon={GitMerge}
                        title="Git Deployment Not Configured"
                        description="Connect a Git repository to enable automatic deployments via webhooks or manual triggers."
                        action={<Button onClick={() => setShowConfigModal(true)}>Configure Deployment</Button>}
                    />
                </div>
            ) : (
                <>
                    <div className="deploy-header">
                        <div className="deploy-status-card">
                            <div className="deploy-repo-info">
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                                </svg>
                                <div>
                                    <span className="repo-url">{config.repo_url}</span>
                                    <span className="repo-branch">Branch: {config.branch}</span>
                                </div>
                            </div>
                            <div className="deploy-actions">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePull}
                                    disabled={deploying}
                                >
                                    Pull Only
                                </Button>
                                <Button
                                    onClick={() => handleDeploy(false)}
                                    disabled={deploying}
                                >
                                    {deploying ? 'Deploying...' : 'Deploy Now'}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="deploy-grid">
                        <div className="card">
                            <h3>Configuration</h3>
                            <InfoList>
                                <InfoItem label="Repository" value={config.repo_url} mono />
                                <InfoItem label="Branch" value={config.branch} />
                                <InfoItem label="Auto Deploy" value={config.auto_deploy ? 'Enabled' : 'Disabled'} />
                            </InfoList>
                            <div className="card-actions">
                                <Button variant="outline" size="sm" onClick={() => setShowConfigModal(true)}>
                                    Edit
                                </Button>
                                <Button variant="destructive" size="sm" onClick={handleRemoveDeployment}>
                                    Remove
                                </Button>
                            </div>
                        </div>

                        {history.length > 0 && (
                            <div className="card">
                                <h3>Deployment History</h3>
                                <div className="deployments-list">
                                    {history.slice(0, 5).map((dep, idx) => (
                                        <div key={idx} className="deployment-item">
                                            <Pill kind={getStatusPillKind(dep.status)}>{dep.status}</Pill>
                                            <span className="deployment-date">{new Date(dep.timestamp).toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {showConfigModal && (
                <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Configure Deployment</h2>
                            <button className="modal-close" onClick={() => setShowConfigModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleConfigureDeployment}>
                            <div className="form-group">
                                <label>Repository URL</label>
                                <Input
                                    type="text"
                                    value={configForm.repoUrl}
                                    onChange={e => setConfigForm({...configForm, repoUrl: e.target.value})}
                                    placeholder="https://github.com/user/repo.git"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Branch</label>
                                <Input
                                    type="text"
                                    value={configForm.branch}
                                    onChange={e => setConfigForm({...configForm, branch: e.target.value})}
                                    placeholder="main"
                                />
                            </div>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={configForm.autoDeploy}
                                        onChange={e => setConfigForm({...configForm, autoDeploy: e.target.checked})}
                                    />
                                    <span>Enable auto-deploy on push</span>
                                </label>
                            </div>
                            <div className="form-group">
                                <label>Pre-deploy Script</label>
                                <Textarea
                                    value={configForm.preDeployScript}
                                    onChange={e => setConfigForm({...configForm, preDeployScript: e.target.value})}
                                    placeholder="npm install"
                                    rows={3}
                                />
                            </div>
                            <div className="form-group">
                                <label>Post-deploy Script</label>
                                <Textarea
                                    value={configForm.postDeployScript}
                                    onChange={e => setConfigForm({...configForm, postDeployScript: e.target.value})}
                                    placeholder="npm run build"
                                    rows={3}
                                />
                            </div>
                            <div className="modal-actions">
                                <Button type="button" variant="outline" onClick={() => setShowConfigModal(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    Save Configuration
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            <ConfirmDialog
                isOpen={confirmDeployState.isOpen}
                title={confirmDeployState.title}
                message={confirmDeployState.message}
                confirmText={confirmDeployState.confirmText}
                cancelText={confirmDeployState.cancelText}
                variant={confirmDeployState.variant}
                onConfirm={handleDeployConfirm}
                onCancel={handleDeployCancel}
            />
        </div>
    );
};

export default ApplicationDetail;
