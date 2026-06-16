import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ExternalLink, Settings, RefreshCw, Plus, Database, GitBranch, Package, Palette, Archive, Trash2, Replace, ShieldCheck, FolderOpen, FileText, Lock, Copy, Zap, Activity, Globe, Layers, BarChart3, FileBarChart, Printer, Download, ChevronDown, Check, AlertTriangle, HardDrive } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import useTabParam from '../hooks/useTabParam';
import wordpressApi from '../services/wordpress';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useLogsDrawer } from '../contexts/LogsDrawerContext';
import { EnvironmentCard, SnapshotTable, GitConnectForm, CommitList, DiskUsageBar } from '../components/wordpress';
import ChangeUrlModal from '../components/wordpress/ChangeUrlModal';
import AttachDomainModal from '../components/wordpress/AttachDomainModal';
import { HealthDot } from '../components/wordpress/HealthStatusPanel';
import { Pill, EnvTag, MetricCard, SegControl, ScoreGauge, ServiceTile } from '../components/ds';
import { ErrorBoundary, ErrorState } from '../components/ErrorBoundary';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DangerZone } from '../components/DangerZone';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Detail Page Skeleton for initial loading
const DetailPageSkeleton = () => (
    <div className="app-detail-page app-detail-page--wide wp-detail-page">
        <div className="app-detail-topbar">
            <div className="app-detail-breadcrumbs">
                <span className="skeleton" style={{ width: 80, height: 16 }} />
                <span>/</span>
                <span className="skeleton" style={{ width: 120, height: 16 }} />
            </div>
        </div>
        <div className="app-detail-header">
            <div className="skeleton" style={{ width: 48, height: 48, borderRadius: 8 }} />
            <div className="app-detail-title-block">
                <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: 300, height: 16 }} />
            </div>
        </div>
        <div className="app-detail-tabs flex gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
                <div key={i} className="skeleton" style={{ width: 80, height: 32, borderRadius: 4 }} />
            ))}
        </div>
        <div className="app-detail-content">
            <div className="tab-loading">
                <div className="tab-loading-header">
                    <div className="tab-loading-title" />
                    <div className="tab-loading-btn" />
                </div>
                <div className="environments-grid">
                    <div className="wp-env-card-skeleton">
                        <div className="wp-env-card-skeleton-header">
                            <div className="wp-env-card-skeleton-badge" />
                            <div className="wp-env-card-skeleton-status" />
                        </div>
                        <div className="wp-env-card-skeleton-body">
                            <div className="wp-env-card-skeleton-url" />
                        </div>
                    </div>
                    <div className="wp-env-card-skeleton">
                        <div className="wp-env-card-skeleton-header">
                            <div className="wp-env-card-skeleton-badge" />
                            <div className="wp-env-card-skeleton-status" />
                        </div>
                        <div className="wp-env-card-skeleton-body">
                            <div className="wp-env-card-skeleton-url" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const VALID_TABS = ['overview', 'environments', 'database', 'plugins', 'themes', 'git', 'backups', 'uptime', 'analytics', 'vulnerabilities', 'security', 'updates', 'php', 'reports'];

// Environment-type → dot tint for the header environment switcher.
const ENV_DOT_COLORS = {
    production: 'var(--green)',
    staging: 'var(--amber)',
    development: 'var(--cyan)',
    multidev: 'var(--violet)',
};

// Short label for an environment type tag (PROD / STAGING / DEV).
const envTagLabel = (type) => (
    type === 'production' ? 'PROD' : type === 'staging' ? 'STAGING' : 'DEV'
);

const ENV_TYPE_LABELS = { production: 'Production', staging: 'Staging', development: 'Development', multidev: 'Multidev' };

// Compact header environment switcher — navigates between the environment
// site ids already present in the loaded payload (no extra fetches).
const EnvSwitcher = ({ options, onSelect }) => {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return undefined;
        const close = () => setOpen(false);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [open]);

    const current = options.find(o => o.current) || options[0];

    return (
        <div className="wp-envswitch-wrap">
            <button
                type="button"
                className={`wp-envswitch ${open ? 'open' : ''}`}
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
                title="Switch environment"
            >
                <span className="ed" style={{ background: ENV_DOT_COLORS[current.type] || 'var(--text-faint)' }} />
                {ENV_TYPE_LABELS[current.type] || current.name}
                <ChevronDown size={13} className="chev" />
            </button>
            {open && (
                <div className="wp-envswitch-menu" onClick={e => e.stopPropagation()}>
                    <div className="wp-envswitch-head">Switch environment</div>
                    {options.map(o => (
                        <button
                            type="button"
                            className="wp-envswitch-opt"
                            key={o.id}
                            onClick={() => { setOpen(false); if (!o.current) onSelect(o.id); }}
                        >
                            <span className="ed" style={{ background: ENV_DOT_COLORS[o.type] || 'var(--text-faint)' }} />
                            <span className="wp-envswitch-opt-body">
                                <span className="nm">{o.name}</span>
                                <span className="meta">
                                    {envTagLabel(o.type)}
                                    {o.url ? ` · ${o.url.replace(/^https?:\/\//, '')}` : ''}
                                </span>
                            </span>
                            {o.current && <Check size={14} className="check" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const WordPressDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { openDrawer } = useLogsDrawer();
    const [site, setSite] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useTabParam(`/wordpress/${id}`, VALID_TABS);
    const [autoLoggingIn, setAutoLoggingIn] = useState(false);
    const [showCloneModal, setShowCloneModal] = useState(false);
    const [showChangeUrl, setShowChangeUrl] = useState(false);
    const [showAddDomain, setShowAddDomain] = useState(false);
    const [cloning, setCloning] = useState(false);
    const [cloneName, setCloneName] = useState('');
    const [clonedCreds, setClonedCreds] = useState(null);

    useEffect(() => {
        // Show the skeleton again when navigating between environment site ids
        // (env switcher / "Open new site") so stale data never renders.
        setLoading(true);
        loadSite();
    }, [id]);

    async function loadSite() {
        try {
            const data = await wordpressApi.getSite(id);
            setSite(data.site || data);
        } catch (err) {
            console.error('Failed to load site:', err);
            toast.error('Failed to load WordPress site');
        } finally {
            setLoading(false);
        }
    }

    async function handleClone() {
        if (!cloneName.trim()) {
            toast.error('New site name is required');
            return;
        }
        setCloning(true);
        toast.info('Cloning site... this spins up a new stack and may take a minute.', { duration: 6000 });
        try {
            const res = await wordpressApi.cloneSite(site.id, { name: cloneName.trim() });
            if (res.success) {
                setShowCloneModal(false);
                setCloneName('');
                if (res.admin_password) {
                    setClonedCreds({ user: res.admin_user || 'admin', password: res.admin_password, id: res.site?.id });
                }
                toast.success('Site cloned successfully');
            } else {
                toast.error(res.error || 'Failed to clone site');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to clone site');
        } finally {
            setCloning(false);
        }
    }

    async function handleAutoLogin() {
        setAutoLoggingIn(true);
        toast.info('Creating one-time login link...', { duration: 3000 });
        try {
            const res = await wordpressApi.autoLogin(site.id);
            if (res && res.url) {
                window.open(res.url, '_blank', 'noopener,noreferrer');
            } else {
                toast.error('No login URL returned');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to create login link');
        } finally {
            setAutoLoggingIn(false);
        }
    }

    if (loading) {
        return <DetailPageSkeleton />;
    }

    if (!site) {
        return (
            <EmptyState
                icon={Globe}
                title="Site not found"
                description="This WordPress site does not exist or has been removed."
                action={<Button onClick={() => navigate('/wordpress')}>Back to WordPress Sites</Button>}
            />
        );
    }

    const isRunning = site.status === 'running';

    // Environment switcher options from data already in the payload:
    // production sites carry `environments`; child envs carry `production_site_id`.
    let envOptions = null;
    if (site.is_production && (site.environments || []).length > 0) {
        envOptions = [
            { id: site.id, name: site.name, type: 'production', url: site.url, current: true },
            ...site.environments.map(e => ({
                id: e.id,
                name: e.name || e.environment_type || `Environment ${e.id}`,
                type: e.environment_type || 'development',
                url: e.url,
                current: false,
            })),
        ];
    } else if (!site.is_production && site.production_site_id) {
        envOptions = [
            { id: site.production_site_id, name: 'Production', type: 'production', current: false },
            { id: site.id, name: site.name, type: site.environment_type || 'development', url: site.url, current: true },
        ];
    }

    return (
        <div className="app-detail-page app-detail-page--wide wp-detail-page">
            {/* One-time cloned-admin credentials banner */}
            {clonedCreds && (
                <div className="wp-creds-banner">
                    <div className="wp-creds-banner-text">
                        <strong>New site created — save these admin credentials, shown only once.</strong>
                        <span>Username: <code>{clonedCreds.user}</code></span>
                        <span>Password: <code>{clonedCreds.password}</code></span>
                        {clonedCreds.id && (
                            <Button variant="ghost" onClick={() => navigate(`/wordpress/${clonedCreds.id}`)}>Open new site</Button>
                        )}
                    </div>
                    <Button variant="ghost" onClick={() => setClonedCreds(null)}>Dismiss</Button>
                </div>
            )}

            {/* Top Bar */}
            <div className="app-detail-topbar">
                <div className="app-detail-breadcrumbs">
                    <Link to="/wordpress">WordPress</Link>
                    <span>/</span>
                    <span className="current">{site.name}</span>
                </div>
                <div className="app-detail-actions">
                    <Button
                        variant="ghost"
                        onClick={() => navigate(`/files?path=${encodeURIComponent(site.application?.root_path || '/')}`)}
                        disabled={!site.application?.root_path}
                        title={site.application?.root_path ? `Open ${site.application.root_path} in the File Manager` : 'No root path configured for this site'}
                    >
                        <FolderOpen size={16} />
                        Open Files
                    </Button>
                    {site.db_name && (
                        <Button
                            variant="ghost"
                            onClick={() => navigate(`/databases/mysql?db=${encodeURIComponent(site.db_name)}`)}
                            title={`Open ${site.db_name} in the Database manager`}
                        >
                            <Database size={16} />
                            Open Database
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        onClick={() => openDrawer({ name: site.name, containerId: site.application_id, appType: 'docker' })}
                        title="View live container logs"
                    >
                        <FileText size={16} />
                        View Logs
                    </Button>
                    {site.url && (
                        <>
                            <Button variant="ghost" asChild>
                                <a
                                    href={site.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <ExternalLink size={16} />
                                    Visit Site
                                </a>
                            </Button>
                            <Button variant="ghost" asChild>
                                <a
                                    href={`${site.url}/wp-admin`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Settings size={16} />
                                    Dashboard
                                </a>
                            </Button>
                        </>
                    )}
                    <Button
                        variant="ghost"
                        onClick={() => setShowAddDomain(true)}
                        title="Point a custom domain you own at this site (auto-DNS + migrate)"
                    >
                        <Plus size={16} />
                        Add Domain
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setShowChangeUrl(true)}
                        title="Change this site's URL (serialization-safe database rewrite + re-point routing)"
                    >
                        <Globe size={16} />
                        Change URL
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setShowCloneModal(true)}
                        title="Duplicate this site as a new independent site with fresh admin credentials"
                    >
                        <Copy size={16} />
                        Clone
                    </Button>
                    <Button
                        variant="default"
                        onClick={handleAutoLogin}
                        disabled={autoLoggingIn}
                        title="Open wp-admin logged in, no password (one-time link)"
                    >
                        <Lock size={16} />
                        {autoLoggingIn ? 'Signing in...' : 'Auto Login'}
                    </Button>
                </div>
            </div>

            {/* Header */}
            <div className="app-detail-header">
                <div className="app-detail-icon wp-icon">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 19.542c-5.261 0-9.542-4.281-9.542-9.542S6.739 2.458 12 2.458 21.542 6.739 21.542 12 17.261 21.542 12 21.542z"/>
                    </svg>
                    <span className={`wp-head-dot ${isRunning ? 'running' : 'stopped'}`} />
                </div>
                <div className="app-detail-title-block">
                    <h1>
                        {site.name}
                        <Pill kind={isRunning ? 'green' : 'gray'}>{isRunning ? 'Running' : 'Stopped'}</Pill>
                        {site.is_production ? (
                            <EnvTag env="PROD" />
                        ) : site.production_site_id ? (
                            <EnvTag env={envTagLabel(site.environment_type)} />
                        ) : null}
                        {envOptions && envOptions.length > 1 && (
                            <EnvSwitcher options={envOptions} onSelect={(envId) => navigate(`/wordpress/${envId}`)} />
                        )}
                    </h1>
                    <div className="app-detail-subtitle">
                        <span>WordPress {site.wp_version || '—'}</span>
                        {site.application?.php_version && (
                            <>
                                <span className="separator">·</span>
                                <span>PHP {site.application.php_version}</span>
                            </>
                        )}
                        {site.url && (
                            <>
                                <span className="separator">·</span>
                                <a href={site.url} target="_blank" rel="noopener noreferrer">{site.url}</a>
                            </>
                        )}
                        {site.multisite && (
                            <>
                                <span className="separator">·</span>
                                <span>multisite</span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="app-detail-tabs">
                <div
                    className={`app-detail-tab ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => setActiveTab('overview')}
                >
                    Overview
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'environments' ? 'active' : ''}`}
                    onClick={() => setActiveTab('environments')}
                >
                    Environments
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'database' ? 'active' : ''}`}
                    onClick={() => setActiveTab('database')}
                >
                    <Database size={14} /> Database
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'plugins' ? 'active' : ''}`}
                    onClick={() => setActiveTab('plugins')}
                >
                    <Package size={14} /> Plugins
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'themes' ? 'active' : ''}`}
                    onClick={() => setActiveTab('themes')}
                >
                    <Palette size={14} /> Themes
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'git' ? 'active' : ''}`}
                    onClick={() => setActiveTab('git')}
                >
                    <GitBranch size={14} /> Git
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'backups' ? 'active' : ''}`}
                    onClick={() => setActiveTab('backups')}
                >
                    <Archive size={14} /> Backups
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'uptime' ? 'active' : ''}`}
                    onClick={() => setActiveTab('uptime')}
                >
                    <Activity size={14} /> Uptime
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'analytics' ? 'active' : ''}`}
                    onClick={() => setActiveTab('analytics')}
                >
                    <BarChart3 size={14} /> Analytics
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'vulnerabilities' ? 'active' : ''}`}
                    onClick={() => setActiveTab('vulnerabilities')}
                >
                    <ShieldCheck size={14} /> Vulnerabilities
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'security' ? 'active' : ''}`}
                    onClick={() => setActiveTab('security')}
                >
                    <Lock size={14} /> Security
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'updates' ? 'active' : ''}`}
                    onClick={() => setActiveTab('updates')}
                >
                    <RefreshCw size={14} /> Updates
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'php' ? 'active' : ''}`}
                    onClick={() => setActiveTab('php')}
                >
                    <Settings size={14} /> PHP
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'reports' ? 'active' : ''}`}
                    onClick={() => setActiveTab('reports')}
                >
                    <FileBarChart size={14} /> Reports
                </div>
            </div>

            {showChangeUrl && (
                <ChangeUrlModal
                    site={site}
                    onClose={() => setShowChangeUrl(false)}
                    onChanged={loadSite}
                />
            )}

            {showAddDomain && (
                <AttachDomainModal
                    site={site}
                    onClose={() => setShowAddDomain(false)}
                    onChanged={loadSite}
                />
            )}

            {/* Clone Site Modal */}
            {showCloneModal && (
                <div className="modal-overlay" onClick={() => !cloning && setShowCloneModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Clone Site</h2>
                            <button className="modal-close" onClick={() => !cloning && setShowCloneModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); handleClone(); }}>
                            <p className="hint">Creates a brand-new independent WordPress site (its own Docker stack and database) seeded from <strong>{site.name}</strong>, with fresh admin credentials shown once.</p>
                            <div className="form-group">
                                <Label>New Site Name *</Label>
                                <Input
                                    type="text"
                                    value={cloneName}
                                    onChange={(e) => setCloneName(e.target.value)}
                                    placeholder={`${site.name}-copy`}
                                    autoFocus
                                    disabled={cloning}
                                />
                            </div>
                            <div className="modal-actions">
                                <Button type="button" variant="outline" onClick={() => setShowCloneModal(false)} disabled={cloning}>Cancel</Button>
                                <Button type="submit" disabled={cloning || !cloneName.trim()}>{cloning ? 'Cloning...' : 'Clone Site'}</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Tab Content */}
            <div className="app-detail-content">
                <ErrorBoundary key={activeTab} onRetry={loadSite}>
                    {activeTab === 'overview' && <OverviewTab site={site} onUpdate={loadSite} />}
                    {activeTab === 'environments' && <EnvironmentsTab siteId={site.id} site={site} onUpdate={loadSite} />}
                    {activeTab === 'database' && <DatabaseTab siteId={site.id} site={site} />}
                    {activeTab === 'plugins' && <PluginsTab siteId={site.id} />}
                    {activeTab === 'themes' && <ThemesTab siteId={site.id} />}
                    {activeTab === 'git' && <GitTab siteId={site.id} site={site} onUpdate={loadSite} />}
                    {activeTab === 'backups' && <BackupsTab siteId={site.id} />}
                    {activeTab === 'uptime' && <UptimeTab siteId={site.id} />}
                    {activeTab === 'analytics' && <AnalyticsTab siteId={site.id} />}
                    {activeTab === 'vulnerabilities' && <VulnerabilitiesTab siteId={site.id} />}
                    {activeTab === 'security' && <SecurityTab siteId={site.id} />}
                    {activeTab === 'updates' && <UpdatesTab siteId={site.id} />}
                    {activeTab === 'php' && <PhpTab siteId={site.id} />}
                    {activeTab === 'reports' && <ReportsTab siteId={site.id} />}
                </ErrorBoundary>
            </div>
        </div>
    );
};

// Friendly labels for the editable php.ini directives (#24 limits panel).
const PHP_LIMIT_LABELS = {
    memory_limit: 'Memory Limit',
    upload_max_filesize: 'Upload Max Filesize',
    post_max_size: 'Post Max Size',
    max_execution_time: 'Max Execution Time',
    max_input_time: 'Max Input Time',
    max_input_vars: 'Max Input Vars',
};

// PHP Tab — live PHP version + ini limits for the Docker (apache/mod_php) site.
// Version is the image tag; switching recreates the container (volumes persist).
// Limits are written as a durable conf.d drop-in (bind-mounted), editable below.
const PhpTab = ({ siteId }) => {
    const toast = useToast();
    const [php, setPhp] = useState(null);
    const [loading, setLoading] = useState(true);
    const [switching, setSwitching] = useState(false);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);

    const load = React.useCallback(async () => {
        setLoading(true);
        try {
            const data = await wordpressApi.getPhpInfo(siteId);
            const info = data.php || data;
            setPhp(info);
            // Seed the edit form from live values for the editable directives.
            const lim = info?.limits || {};
            const seed = {};
            (info?.editable_limits || []).forEach(k => { seed[k] = lim[k] || ''; });
            setForm(seed);
        } catch (err) {
            toast.error(err.message || 'Failed to load PHP info');
        } finally {
            setLoading(false);
        }
    }, [siteId, toast]);

    useEffect(() => { load(); }, [load]);

    async function handleSwitch(version) {
        if (!window.confirm(`Switch this site to PHP ${version}? This pulls the wordpress:php${version}-apache image and recreates the container (brief downtime; database and files are preserved).`)) return;
        setSwitching(true);
        toast.info(`Switching to PHP ${version}...`, { duration: 4000 });
        try {
            const res = await wordpressApi.setPhpVersion(siteId, version);
            if (res.success === false) { toast.error(res.error || 'Failed to switch PHP version'); return; }
            toast.success(res.message || `Switched to PHP ${version}`);
            await load();
        } catch (err) {
            toast.error(err.message || 'Failed to switch PHP version');
        } finally {
            setSwitching(false);
        }
    }

    async function handleSaveLimits() {
        // Send only the directives that changed from the live value (partial update).
        const live = php?.limits || {};
        const changed = {};
        Object.entries(form).forEach(([k, v]) => {
            const val = (v ?? '').toString().trim();
            if (val && val !== (live[k] || '')) changed[k] = val;
        });
        if (Object.keys(changed).length === 0) { toast.info('No changes to save'); return; }
        if (!window.confirm('Apply these PHP limits? The container reloads (brief downtime; database and files are preserved).')) return;
        setSaving(true);
        try {
            const res = await wordpressApi.setPhpLimits(siteId, changed);
            if (res.success === false) { toast.error(res.error || 'Failed to update PHP limits'); return; }
            toast.success(res.message || 'PHP limits updated');
            await load();
        } catch (err) {
            toast.error(err.message || 'Failed to update PHP limits');
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="tab-loading"><p className="hint">Loading PHP info...</p></div>;

    const limits = php?.limits || {};
    const current = php?.php_version || 'Unknown';
    const versions = php?.available_versions || [];
    const editableKeys = php?.editable_limits || [];

    return (
        <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="app-panel">
                    <div className="app-panel-header">PHP</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item">
                                <span className="app-info-label">PHP Version</span>
                                <span className="app-info-value">{current}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Memory Limit</span>
                                <span className="app-info-value">{limits.memory_limit || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Upload Max Filesize</span>
                                <span className="app-info-value">{limits.upload_max_filesize || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Post Max Size</span>
                                <span className="app-info-value">{limits.post_max_size || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Max Execution Time</span>
                                <span className="app-info-value">{limits.max_execution_time || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Max Input Time</span>
                                <span className="app-info-value">{limits.max_input_time || '-'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {versions.length > 0 && (
                    <div className="app-panel">
                        <div className="app-panel-header">Change PHP Version</div>
                        <div className="app-panel-body">
                            <p className="hint">Switching rebuilds the container from the official wordpress php-apache image. The database and uploaded files are preserved.</p>
                            <div className="app-detail-actions">
                                {versions.map(v => (
                                    <Button key={v} variant="outline" size="sm" disabled={switching || current.startsWith(v)} onClick={() => handleSwitch(v)}>
                                        {current.startsWith(v) ? `PHP ${v} (current)` : `PHP ${v}`}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {editableKeys.length > 0 && (
                    <div className="app-panel">
                        <div className="app-panel-header">Edit PHP Limits</div>
                        <div className="app-panel-body">
                            <p className="hint">Saved as a durable conf.d drop-in bind-mounted into the container, so limits survive a container recreate. Saving reloads the container (brief downtime).</p>
                            {editableKeys.map(k => (
                                <div className="form-group" key={k}>
                                    <Label>{PHP_LIMIT_LABELS[k] || k}</Label>
                                    <Input value={form[k] ?? ''} placeholder={limits[k] || ''} disabled={saving}
                                        onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                                </div>
                            ))}
                            <div className="app-detail-actions">
                                <Button size="sm" onClick={handleSaveLimits} disabled={saving}>{saving ? 'Saving…' : 'Save limits'}</Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Uptime Tab — per-site health + uptime % via a bound status-page component (#26).
// Health is polled server-side every 5 min; outages auto-open incidents and alert
// the configured notification channels.
const UptimeTab = ({ siteId }) => {
    const toast = useToast();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pageId, setPageId] = useState('');
    const [busy, setBusy] = useState(false);

    const load = React.useCallback(async () => {
        setLoading(true);
        try {
            const res = await wordpressApi.getSiteStatusPage(siteId);
            setData(res);
        } catch (err) {
            toast.error(err.message || 'Failed to load uptime info');
        } finally {
            setLoading(false);
        }
    }, [siteId, toast]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (data?.pages?.length) setPageId(prev => prev || String(data.pages[0].id));
    }, [data]);

    async function handleAttach() {
        if (!pageId) { toast.error('Choose a status page'); return; }
        setBusy(true);
        try {
            await wordpressApi.attachStatusPage(siteId, Number(pageId));
            toast.success('Added to status page');
            await load();
        } catch (err) {
            toast.error(err.message || 'Failed to add to status page');
        } finally { setBusy(false); }
    }

    async function handleDetach() {
        if (!window.confirm('Remove this site from its status page? Its uptime history and component will be deleted.')) return;
        setBusy(true);
        try {
            await wordpressApi.detachStatusPage(siteId);
            toast.success('Removed from status page');
            await load();
        } catch (err) {
            toast.error(err.message || 'Failed to remove from status page');
        } finally { setBusy(false); }
    }

    if (loading) return <div className="tab-loading"><p className="hint">Loading uptime info...</p></div>;

    const comp = data?.component;
    const pages = data?.pages || [];
    const pct = (v) => (v != null ? `${v.toFixed(2)}%` : '—');

    return (
        <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="app-panel">
                    <div className="app-panel-header">Health</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item">
                                <span className="app-info-label">Current Status</span>
                                <span className="app-info-value">
                                    <HealthDot status={data?.health_status} /> {data?.health_status || 'unknown'}
                                </span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Last Checked</span>
                                <span className="app-info-value">{data?.last_health_check ? new Date(data.last_health_check).toLocaleString() : 'Never'}</span>
                            </div>
                        </div>
                        <p className="hint">Health is polled automatically every 5 minutes. Outages and recoveries alert your configured notification channels.</p>
                    </div>
                </div>

                {comp ? (
                    <div className="app-panel">
                        <div className="app-panel-header">Uptime</div>
                        <div className="app-panel-body">
                            {comp.last_check_at ? (
                                <div className="wp-kpis">
                                    <MetricCard icon={<Activity size={16} />} tone="green" value={pct(comp.uptime_24h)} label="Uptime · 24 hours" />
                                    <MetricCard icon={<Activity size={16} />} tone="green" value={pct(comp.uptime_7d)} label="Uptime · 7 days" />
                                    <MetricCard icon={<Activity size={16} />} tone="cyan" value={pct(comp.uptime_30d)} label="Uptime · 30 days" />
                                    <MetricCard icon={<Activity size={16} />} tone="cyan" value={pct(comp.uptime_90d)} label="Uptime · 90 days" />
                                </div>
                            ) : (
                                <p className="hint">Awaiting the first health check (runs within 5 minutes).</p>
                            )}
                            <p className="hint">Uptime accrues from the 5-minute health checks; only fully-healthy checks count, so degraded periods reduce it. This site appears on its status page and auto-opens an incident on an outage (auto-resolved on recovery).</p>
                            <div className="app-detail-actions">
                                <Button variant="outline" size="sm" disabled={busy} onClick={handleDetach}>Remove from status page</Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="app-panel">
                        <div className="app-panel-header">Add to status page</div>
                        <div className="app-panel-body">
                            {pages.length === 0 ? (
                                <p className="hint">No status pages exist yet. Create one under Status Pages first, then add this site to track its uptime and auto-open incidents on outages.</p>
                            ) : (
                                <>
                                    <p className="hint">Track uptime for this site on a status page. It accrues a real uptime % and auto-opens/resolves incidents on outages.</p>
                                    <div className="form-group">
                                        <Label>Status Page</Label>
                                        <select value={pageId} onChange={e => setPageId(e.target.value)} disabled={busy}>
                                            {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="app-detail-actions">
                                        <Button size="sm" disabled={busy} onClick={handleAttach}>Add to status page</Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Updates Tab — safe update manager (#29): snapshot -> update -> health-check ->
// auto-rollback, plus a per-site schedule and a run-history report.
const UPDATE_SCHEDULES = [
    { label: 'Off', value: '' },
    { label: 'Weekly (Sun 3am)', value: '0 3 * * 0' },
    { label: 'Daily (3am)', value: '0 3 * * *' },
];

const UpdatesTab = ({ siteId }) => {
    const toast = useToast();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [schedule, setSchedule] = useState('');
    const [excludeText, setExcludeText] = useState('');

    const load = React.useCallback(async () => {
        try {
            const res = await wordpressApi.getUpdates(siteId);
            setData(res);
            setSchedule(res.schedule || '');
            setExcludeText((res.exclude || []).join(', '));
        } catch (err) {
            toast.error(err.message || 'Failed to load updates');
        } finally {
            setLoading(false);
        }
    }, [siteId, toast]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!data?.running) return undefined;
        const t = setTimeout(() => { wordpressApi.getUpdates(siteId).then(setData).catch(() => {}); }, 3000);
        return () => clearTimeout(t);
    }, [data, siteId]);

    const toList = (s) => s.split(',').map(x => x.trim()).filter(Boolean);

    async function runUpdate() {
        if (!window.confirm('Run a safe update now? A database snapshot is taken first and the site auto-rolls-back if the update breaks it.')) return;
        setBusy(true);
        try {
            await wordpressApi.runUpdates(siteId, { exclude: toList(excludeText) });
            toast.info('Safe update started…');
            setData(await wordpressApi.getUpdates(siteId));
        } catch (err) { toast.error(err.message || 'Failed to start update'); }
        finally { setBusy(false); }
    }
    async function saveSchedule() {
        setBusy(true);
        try {
            await wordpressApi.setUpdateSchedule(siteId, { schedule, exclude: toList(excludeText) });
            toast.success('Schedule saved');
            await load();
        } catch (err) { toast.error(err.message || 'Failed to save schedule'); }
        finally { setBusy(false); }
    }

    if (loading) return <div className="tab-loading"><p className="hint">Loading updates...</p></div>;

    const runs = data?.runs || [];
    const running = data?.running;
    const statusPill = (s) => ({ completed: 'green', rolled_back: 'amber', failed: 'red', running: 'cyan' }[s] || 'gray');

    return (
        <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="app-panel">
                    <div className="app-panel-header">Safe update</div>
                    <div className="app-panel-body">
                        <p className="hint">Snapshots the database, updates core + plugins + themes, health-checks the site, and automatically rolls back (version-pin + DB restore) if the update breaks it.</p>
                        <div className="form-group">
                            <Label>Exclude (skip) plugins/themes</Label>
                            <Input value={excludeText} onChange={e => setExcludeText(e.target.value)} placeholder="e.g. woocommerce, my-custom-plugin" />
                            <span className="form-hint">Comma-separated slugs to never auto-update.</span>
                        </div>
                        <div className="app-detail-actions">
                            <Button size="sm" onClick={runUpdate} disabled={busy || running}>{running ? 'Updating…' : 'Run safe update now'}</Button>
                        </div>
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">Schedule</div>
                    <div className="app-panel-body">
                        <div className="form-group">
                            <Label>Automatic safe updates</Label>
                            <select value={schedule} onChange={e => setSchedule(e.target.value)} disabled={busy}>
                                {UPDATE_SCHEDULES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                {schedule && !UPDATE_SCHEDULES.some(s => s.value === schedule) && <option value={schedule}>{schedule}</option>}
                            </select>
                            <span className="form-hint">Runs the same safe update (with auto-rollback) on a schedule.</span>
                        </div>
                        <div className="app-detail-actions">
                            <Button variant="outline" size="sm" onClick={saveSchedule} disabled={busy}>Save schedule</Button>
                        </div>
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">Update history</div>
                    <div className="app-panel-body">
                        {runs.length === 0 ? (
                            <p className="hint">No updates have run yet.</p>
                        ) : runs.map(r => {
                            const d = r.details || {};
                            const n = (d.updated || []).length;
                            return (
                                <div className="wp-run-row" key={r.id}>
                                    <div className="wp-run-row-head">
                                        <Pill kind={statusPill(r.status)}>{r.status.replace('_', ' ')}</Pill>
                                        <span className="wp-run-row-meta">{r.started_at ? new Date(r.started_at).toLocaleString() : ''} · {r.trigger}</span>
                                    </div>
                                    <span className="form-hint">
                                        {n === 0 ? 'No components needed updating' : `${n} component${n === 1 ? '' : 's'} updated`}
                                        {d.rolled_back ? ' · auto-rolled back (update regressed the site)' : ''}
                                        {r.error ? ` · ${r.error}` : ''}
                                    </span>
                                    {d.warning && <span className="form-hint">⚠ {d.warning}</span>}
                                    {(d.updated || []).slice(0, 10).map((u, i) => (
                                        <span className="form-hint wp-run-component" key={i}>{u.type} {u.slug}: {u.from} → {u.to}</span>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

// Security Tab — per-site security depth (#30): file-integrity verification,
// WP_DEBUG toggle, and WP-Cron management, all via the Docker-aware WP-CLI bridge.
const SecurityTab = ({ siteId }) => {
    const toast = useToast();
    const [integrity, setIntegrity] = useState(null);
    const [debug, setDebug] = useState(null);
    const [cron, setCron] = useState(null);
    const [vulns, setVulns] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const loadAll = React.useCallback(async () => {
        try {
            const [i, d, c, v] = await Promise.all([
                wordpressApi.getIntegrity(siteId).catch(() => null),
                wordpressApi.getDebug(siteId).catch(() => null),
                wordpressApi.getCron(siteId).catch(() => null),
                wordpressApi.getVulnerabilities(siteId).catch(() => null),
            ]);
            setIntegrity(i); setDebug(d); setCron(c); setVulns(v);
        } finally {
            setLoading(false);
        }
    }, [siteId]);

    useEffect(() => { loadAll(); }, [loadAll]);
    useEffect(() => {
        if (integrity?.status !== 'running') return undefined;
        const t = setTimeout(() => {
            wordpressApi.getIntegrity(siteId).then(setIntegrity).catch(() => {});
        }, 2500);
        return () => clearTimeout(t);
    }, [integrity, siteId]);

    async function runIntegrity() {
        try {
            await wordpressApi.scanIntegrity(siteId);
            setIntegrity(await wordpressApi.getIntegrity(siteId));
        } catch (err) { toast.error(err.message || 'Failed to start check'); }
    }
    async function toggleDebug() {
        setBusy(true);
        try {
            const res = await wordpressApi.setDebug(siteId, !debug?.enabled);
            if (res.success === false) { toast.error(res.error || 'Failed to update debug setting'); return; }
            setDebug(res);
            toast.success('Debug setting updated');
        } catch (err) { toast.error(err.message || 'Failed to update debug setting'); }
        finally { setBusy(false); }
    }
    async function runCron() {
        setBusy(true);
        try {
            const r = await wordpressApi.runCron(siteId);
            toast[r.success ? 'success' : 'error'](r.success ? 'Ran due events' : (r.error || 'Failed to run cron'));
            setCron(await wordpressApi.getCron(siteId));
        } catch (err) { toast.error(err.message || 'Failed to run cron'); }
        finally { setBusy(false); }
    }
    async function toggleCron() {
        setBusy(true);
        try { setCron(await wordpressApi.setCronDisabled(siteId, !cron?.disabled)); }
        catch (err) { toast.error(err.message || 'Failed to update WP-Cron'); }
        finally { setBusy(false); }
    }

    if (loading) return <div className="tab-loading"><p className="hint">Loading security tools...</p></div>;

    const intRunning = integrity?.status === 'running';
    const issues = integrity?.issues || [];

    // Posture checks — real signals only; checks that haven't run yet stay out
    // of the score (demo's posture ring, computed client-side).
    const vsum = vulns?.summary || {};
    const checks = [
        {
            label: 'Core & plugin files verified',
            state: integrity?.status === 'completed' ? (issues.length === 0 ? 'pass' : 'fail') : 'unknown',
            detail: integrity?.status === 'completed'
                ? (issues.length === 0 ? 'checksums clean' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`)
                : 'not checked yet',
        },
        {
            label: 'WP_DEBUG disabled',
            state: debug ? (debug.debug?.WP_DEBUG ? 'fail' : 'pass') : 'unknown',
            detail: debug ? (debug.debug?.WP_DEBUG ? 'debug is on' : 'off') : 'unavailable',
        },
        {
            label: 'No critical / high vulnerabilities',
            state: vulns?.scanned_at ? (((vsum.critical ?? 0) + (vsum.high ?? 0)) === 0 ? 'pass' : 'fail') : 'unknown',
            detail: vulns?.scanned_at
                ? `${(vsum.critical ?? 0) + (vsum.high ?? 0)} found`
                : 'no scan yet',
        },
    ];
    const scored = checks.filter(c => c.state !== 'unknown');
    const score = scored.length ? Math.round(scored.filter(c => c.state === 'pass').length / scored.length * 100) : null;
    const scoreColor = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)';
    const CHECK_PILL = { pass: 'green', fail: 'red', unknown: 'gray' };

    return (
        <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="app-panel">
                    <div className="app-panel-header">Security posture</div>
                    <div className="app-panel-body wp-posture">
                        {score !== null ? (
                            <ScoreGauge value={score} size={110} stroke={9} color={scoreColor} label="posture" />
                        ) : (
                            <p className="hint">Run the checks below to compute a posture score.</p>
                        )}
                        <div className="wp-posture__checks">
                            {checks.map(c => (
                                <div key={c.label} className="wp-posture__check">
                                    <span className="wp-posture__label">{c.label}</span>
                                    <span className="wp-posture__detail">{c.detail}</span>
                                    <Pill kind={CHECK_PILL[c.state]}>{c.state === 'unknown' ? 'pending' : c.state}</Pill>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">File integrity</div>
                    <div className="app-panel-body">
                        <div className="app-detail-actions">
                            <Button size="sm" onClick={runIntegrity} disabled={intRunning}>{intRunning ? 'Checking…' : 'Verify checksums'}</Button>
                        </div>
                        {(!integrity || integrity.status === 'idle') && <p className="hint">Verifies WordPress core and wordpress.org plugins against official checksums to detect tampered or unexpected files.</p>}
                        {integrity?.status === 'error' && <p className="hint">Check failed: {integrity.error}</p>}
                        {integrity?.status === 'completed' && (
                            issues.length === 0
                                ? <p className="hint">All core and plugin files verify against official checksums.</p>
                                : <>
                                    <div className="app-detail-actions"><Pill kind="red">{issues.length} issue{issues.length === 1 ? '' : 's'}</Pill></div>
                                    <div className="wp-code-list">
                                        {issues.slice(0, 50).map((line, i) => <div key={i}>{line}</div>)}
                                    </div>
                                </>
                        )}
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">Debug mode</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item"><span className="app-info-label">WP_DEBUG</span><span className="app-info-value"><Pill kind={debug?.debug?.WP_DEBUG ? 'amber' : 'gray'}>{debug?.debug?.WP_DEBUG ? 'on' : 'off'}</Pill></span></div>
                            <div className="app-info-item"><span className="app-info-label">Debug log</span><span className="app-info-value">{debug?.debug?.WP_DEBUG_LOG ? 'on' : 'off'}</span></div>
                            <div className="app-info-item"><span className="app-info-label">Script debug</span><span className="app-info-value">{debug?.debug?.SCRIPT_DEBUG ? 'on' : 'off'}</span></div>
                        </div>
                        <div className="app-detail-actions">
                            <Button variant="outline" size="sm" onClick={toggleDebug} disabled={busy}>{debug?.enabled ? 'Disable debugging' : 'Enable debugging'}</Button>
                        </div>
                        <p className="hint">Logs errors to a private file outside the web root (never to the page or a public URL). Enable to capture PHP fatals; disable in production.</p>
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">WP-Cron</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item"><span className="app-info-label">Pseudo-cron</span><span className="app-info-value">{cron?.disabled ? 'disabled' : 'enabled'}</span></div>
                            <div className="app-info-item"><span className="app-info-label">Scheduled events</span><span className="app-info-value">{(cron?.events || []).length}</span></div>
                        </div>
                        <div className="app-detail-actions">
                            <Button variant="outline" size="sm" onClick={runCron} disabled={busy}>Run due events</Button>
                            <Button variant="outline" size="sm" onClick={toggleCron} disabled={busy}>{cron?.disabled ? 'Enable WP-Cron' : 'Disable WP-Cron'}</Button>
                        </div>
                        <p className="hint">Disable WP-Cron only if a real system cron hits wp-cron.php — otherwise scheduled tasks (publishing, updates) will not run.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Vulnerabilities Tab — cross-references plugin/theme/core versions against the
// keyless WPVulnerability community feed (#28). On-demand background scan + poll.
const VulnerabilitiesTab = ({ siteId }) => {
    const toast = useToast();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);

    const load = React.useCallback(async () => {
        try {
            const res = await wordpressApi.getVulnerabilities(siteId);
            setData(res);
        } catch (err) {
            toast.error(err.message || 'Failed to load vulnerabilities');
        } finally {
            setLoading(false);
        }
    }, [siteId, toast]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (data?.scan_status !== 'running') return undefined;
        const t = setTimeout(() => { load(); }, 2500);
        return () => clearTimeout(t);
    }, [data, load]);

    async function handleScan() {
        setScanning(true);
        try {
            await wordpressApi.scanVulnerabilities(siteId);
            toast.info('Vulnerability scan started…');
            await load();
        } catch (err) {
            toast.error(err.message || 'Failed to start scan');
        } finally {
            setScanning(false);
        }
    }

    if (loading) return <div className="tab-loading"><p className="hint">Loading vulnerabilities...</p></div>;

    const running = data?.scan_status === 'running';
    const summary = data?.summary || {};
    const vulns = data?.vulnerabilities || [];

    return (
        <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="app-panel">
                    <div className="app-panel-header">Vulnerability scan</div>
                    <div className="app-panel-body">
                        <div className="app-detail-actions">
                            <Button size="sm" onClick={handleScan} disabled={scanning || running}>
                                {running ? 'Scanning…' : 'Run scan'}
                            </Button>
                        </div>
                        <div className="app-info-grid">
                            <div className="app-info-item"><span className="app-info-label">Last scan</span><span className="app-info-value">{data?.scanned_at ? new Date(data.scanned_at).toLocaleString() : 'Never'}</span></div>
                            <div className="app-info-item"><span className="app-info-label">Findings</span><span className="app-info-value">{summary.total ?? 0}</span></div>
                        </div>
                        {data?.scan_error && <p className="hint">Last scan error: {data.scan_error}</p>}
                        <p className="hint">Cross-references installed plugin, theme, and core versions against the WPVulnerability community database. Re-run after updating.</p>
                    </div>
                </div>

                {data?.scanned_at && (
                    <div className="wp-kpis">
                        <MetricCard icon={<AlertTriangle size={16} />} tone="red" value={summary.critical ?? 0} label="Critical" />
                        <MetricCard icon={<AlertTriangle size={16} />} tone="red" value={summary.high ?? 0} label="High" />
                        <MetricCard icon={<AlertTriangle size={16} />} tone="amber" value={summary.medium ?? 0} label="Medium" />
                        <MetricCard icon={<AlertTriangle size={16} />} tone="cyan" value={summary.low ?? 0} label="Low" />
                        {summary.unknown > 0 && (
                            <MetricCard icon={<AlertTriangle size={16} />} tone="violet" value={summary.unknown} label="Unrated" />
                        )}
                    </div>
                )}

                {vulns.length === 0 ? (
                    <div className="app-panel">
                        <div className="app-panel-body">
                            <p className="hint">{data?.scanned_at ? 'No known vulnerabilities found.' : 'No scan has run yet — click Run scan to check this site.'}</p>
                        </div>
                    </div>
                ) : (
                    <div className="app-panel">
                        <div className="app-panel-header">Findings</div>
                        <table className="sk-dtable wp-vuln-table">
                            <thead>
                                <tr>
                                    <th>Severity</th>
                                    <th>Component</th>
                                    <th>Issue</th>
                                    <th>Installed</th>
                                    <th>Fixed in</th>
                                    <th>Advisory</th>
                                </tr>
                            </thead>
                            <tbody>
                                {vulns.map(v => (
                                    <tr key={v.id}>
                                        <td><span className={`wp-sev wp-sev--${v.severity || 'unknown'}`}><span className="d" />{v.severity || 'unrated'}</span></td>
                                        <td>
                                            <div className="sk-cell-name">{v.name}</div>
                                            <div className="sk-cell-sub">{v.source}{v.slug ? ` · ${v.slug}` : ''}</div>
                                        </td>
                                        <td className="wp-vuln-title">{v.title || '—'}</td>
                                        <td><span className="sk-cell-mono">{v.installed_version}</span></td>
                                        <td>
                                            {v.fixed_in
                                                ? <span className="wp-fix-chip">{v.fixed_in}</span>
                                                : <span className="wp-no-fix">no fix yet</span>}
                                        </td>
                                        <td>
                                            {v.reference_url
                                                ? <a className="wp-advisory-link" href={v.reference_url} target="_blank" rel="noopener noreferrer">{v.advisory_id || 'advisory'} ↗</a>
                                                : <span className="sk-cell-mono">{v.advisory_id || '—'}</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

// Analytics Tab — per-site traffic + error analytics (#25), parsed on-demand from
// the apache container access log. PHP fatals, response time, and cache hit ratio
// are not in the default access log (deferred to #30 / #22-#23).
const ANALYTICS_PERIODS = [{ label: '24h', hours: 24 }, { label: '7d', hours: 168 }];

const AnalyticsTab = ({ siteId }) => {
    const toast = useToast();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [hours, setHours] = useState(24);

    const load = React.useCallback(async () => {
        setLoading(true);
        try {
            const res = await wordpressApi.getSiteAnalytics(siteId, hours);
            setData(res);
        } catch (err) {
            toast.error(err.message || 'Failed to load analytics');
        } finally {
            setLoading(false);
        }
    }, [siteId, hours, toast]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <div className="tab-loading"><p className="hint">Loading analytics...</p></div>;

    const fmtHour = (iso) => {
        const d = new Date(iso);
        return hours <= 24
            ? d.toLocaleTimeString([], { hour: '2-digit', hour12: false })
            : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    const clip = (p) => (p && p.length > 48 ? `${p.slice(0, 48)}…` : p);
    const clipMsg = (m) => (m && m.length > 80 ? `${m.slice(0, 80)}…` : m);
    const s = data?.status || {};
    const phpErr = data?.php_errors;

    return (
        <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="wp-analytics-head">
                    <h3 className="wp-eyebrow">Traffic · {hours <= 24 ? 'last 24 hours' : 'last 7 days'}</h3>
                    <SegControl
                        options={ANALYTICS_PERIODS.map(p => ({ value: p.hours, label: p.label }))}
                        value={hours}
                        onChange={setHours}
                    />
                </div>
                {data?.note && <p className="hint">{data.note}</p>}
                <div className="wp-kpis">
                    <MetricCard icon={<BarChart3 size={16} />} tone="accent" value={(data?.requests ?? 0).toLocaleString()} label="Requests" />
                    <MetricCard icon={<Globe size={16} />} tone="cyan" value={(data?.unique_visitors ?? 0).toLocaleString()} label="Unique visitors" />
                    <MetricCard icon={<HardDrive size={16} />} tone="violet" value={data?.bytes_human || '0 B'} label="Bandwidth" />
                    <MetricCard icon={<AlertTriangle size={16} />} tone={(data?.error_rate ?? 0) > 5 ? 'red' : 'amber'} value={`${data?.error_rate ?? 0}%`} label="Error rate" />
                    <MetricCard icon={<Activity size={16} />} tone="green" value={`${data?.bot_pct ?? 0}%`} label="Bot traffic" />
                    <MetricCard icon={<FileText size={16} />} tone="red" value={(data?.not_found ?? 0).toLocaleString()} label="404s" />
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">Requests over time</div>
                    <div className="app-panel-body">
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={data?.series || []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="wpReq" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6d7cff" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#6d7cff" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="wpErr" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#fb6f6f" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#fb6f6f" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#888" strokeOpacity={0.15} />
                                <XAxis dataKey="hour" tickFormatter={fmtHour} tick={{ fontSize: 11, fill: '#888' }} minTickGap={24} axisLine={false} tickLine={false} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#888' }} width={36} axisLine={false} tickLine={false} />
                                <Tooltip labelFormatter={fmtHour} />
                                <Area type="monotone" dataKey="requests" name="Requests" stroke="#8b93ff" fill="url(#wpReq)" strokeWidth={2} />
                                <Area type="monotone" dataKey="errors" name="Errors" stroke="#fb6f6f" fill="url(#wpErr)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">Status codes</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item"><span className="app-info-label">2xx</span><span className="app-info-value">{(s['2xx'] ?? 0).toLocaleString()}</span></div>
                            <div className="app-info-item"><span className="app-info-label">3xx</span><span className="app-info-value">{(s['3xx'] ?? 0).toLocaleString()}</span></div>
                            <div className="app-info-item"><span className="app-info-label">4xx</span><span className="app-info-value">{(s['4xx'] ?? 0).toLocaleString()}</span></div>
                            <div className="app-info-item"><span className="app-info-label">5xx</span><span className="app-info-value">{(s['5xx'] ?? 0).toLocaleString()}</span></div>
                        </div>
                    </div>
                </div>

                {data?.top_paths?.length > 0 && (
                    <div className="app-panel">
                        <div className="app-panel-header">Top URLs</div>
                        <div className="app-panel-body">
                            <div className="app-info-grid">
                                {data.top_paths.map((row, i) => (
                                    <div className="app-info-item" key={i}>
                                        <span className="app-info-label" title={row.path}>{clip(row.path)}</span>
                                        <span className="app-info-value">{row.count.toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="hint">Read live from the container access log; response-time metrics are not captured by the default log.</p>
                        </div>
                    </div>
                )}

                {phpErr && (
                    <div className="app-panel">
                        <div className="app-panel-header">PHP errors</div>
                        <div className="app-panel-body">
                            {!phpErr.available ? (
                                <p className="hint">{phpErr.note || 'PHP error logging is off.'}</p>
                            ) : (
                                <>
                                    <div className="app-info-grid">
                                        <div className="app-info-item"><span className="app-info-label">Fatal</span><span className="app-info-value">{(phpErr.counts?.fatal ?? 0).toLocaleString()}</span></div>
                                        <div className="app-info-item"><span className="app-info-label">Warning</span><span className="app-info-value">{(phpErr.counts?.warning ?? 0).toLocaleString()}</span></div>
                                        <div className="app-info-item"><span className="app-info-label">Notice</span><span className="app-info-value">{(phpErr.counts?.notice ?? 0).toLocaleString()}</span></div>
                                        <div className="app-info-item"><span className="app-info-label">Deprecated</span><span className="app-info-value">{(phpErr.counts?.deprecated ?? 0).toLocaleString()}</span></div>
                                    </div>
                                    {phpErr.recent?.length > 0 ? (
                                        <div className="app-info-grid">
                                            {phpErr.recent.map((e, i) => (
                                                <div className="app-info-item" key={i}>
                                                    <span className="app-info-label" title={e.message}>{e.level}: {clipMsg(e.message)}</span>
                                                    <span className="app-info-value">{e.time}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="hint">{phpErr.note || 'No PHP errors recorded.'}</p>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Reports Tab — monthly client reports (#33 agency slice). Aggregates the
// per-site signals that already accrue (uptime/incidents #26, update runs #29,
// backups, vulnerability posture #28) into a persisted, printable monthly report.
const ReportsTab = ({ siteId }) => {
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const [reports, setReports] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    // Last 12 months (current first) as {value:'YYYY-MM', label, year, month}.
    const monthOptions = React.useMemo(() => {
        const opts = [];
        const d = new Date();
        d.setDate(1);
        for (let i = 0; i < 12; i++) {
            const year = d.getFullYear();
            const month = d.getMonth() + 1;
            opts.push({
                value: `${year}-${String(month).padStart(2, '0')}`,
                label: d.toLocaleString([], { month: 'long', year: 'numeric' }),
                year, month,
            });
            d.setMonth(d.getMonth() - 1);
        }
        return opts;
    }, []);
    const [genMonth, setGenMonth] = useState(monthOptions[0].value);

    const load = React.useCallback(async (preferLabel) => {
        try {
            const res = await wordpressApi.getReports(siteId);
            const list = res.reports || [];
            setReports(list);
            setSelectedId(prev => {
                if (preferLabel) {
                    const match = list.find(r => r.period_label === preferLabel);
                    if (match) return match.id;
                }
                if (prev && list.some(r => r.id === prev)) return prev;
                return list.length ? list[0].id : null;
            });
        } catch (err) {
            toast.error(err.message || 'Failed to load reports');
        } finally {
            setLoading(false);
        }
    }, [siteId, toast]);

    useEffect(() => { load(); }, [load]);

    async function handleGenerate() {
        const opt = monthOptions.find(o => o.value === genMonth) || monthOptions[0];
        setBusy(true);
        try {
            // The API client throws on a non-2xx (e.g. the future-month guard's 400),
            // so a resolved call means success; failures surface via catch.
            await wordpressApi.generateReport(siteId, { year: opt.year, month: opt.month });
            toast.success(`Report generated for ${opt.label}`);
            await load(opt.value);
        } catch (err) {
            toast.error(err.message || 'Failed to generate report');
        } finally {
            setBusy(false);
        }
    }

    async function handleDelete(report) {
        const ok = await confirm({
            title: 'Delete report',
            message: `Delete the report for ${report.data?.period?.month_name || report.period_label}? This cannot be undone.`,
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await wordpressApi.deleteReport(siteId, report.id);
            toast.success('Report deleted');
            await load();
        } catch (err) {
            toast.error(err.message || 'Failed to delete report');
        }
    }

    function handleDownload(report) {
        const blob = new Blob([JSON.stringify(report.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wp-report-${siteId}-${report.period_label}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function handlePrint() {
        document.body.classList.add('wp-report-printing');
        // Clean up on whichever signal fires first: `afterprint` (most engines) or
        // the window regaining focus when the dialog closes (fallback for webviews
        // that don't dispatch afterprint). cleanup is idempotent.
        const cleanup = () => {
            document.body.classList.remove('wp-report-printing');
            window.removeEventListener('afterprint', cleanup);
            window.removeEventListener('focus', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.addEventListener('focus', cleanup, { once: true });
        window.print();
    }

    if (loading) return <div className="tab-loading"><p className="hint">Loading reports...</p></div>;

    const selected = reports.find(r => r.id === selectedId) || null;

    return (
        <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="app-panel wp-report-no-print">
                    <div className="app-panel-header">Generate monthly report</div>
                    <div className="app-panel-body">
                        <p className="hint">Snapshots this site&apos;s uptime, incidents, update runs, backups, and current security posture for a calendar month into a printable client report.</p>
                        <div className="app-detail-actions">
                            <select value={genMonth} onChange={e => setGenMonth(e.target.value)} disabled={busy}>
                                {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <Button size="sm" onClick={handleGenerate} disabled={busy}>
                                {busy ? 'Generating…' : 'Generate'}
                            </Button>
                        </div>
                        {reports.length > 0 && (
                            <div className="app-detail-actions wp-report-month-list">
                                {reports.map(r => (
                                    <Button
                                        key={r.id}
                                        variant={r.id === selectedId ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setSelectedId(r.id)}
                                    >
                                        {r.data?.period?.month_name || r.period_label}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {!selected ? (
                    <div className="app-panel wp-report-no-print">
                        <div className="app-panel-body">
                            <p className="hint">No reports yet — pick a month above and click Generate.</p>
                        </div>
                    </div>
                ) : (
                    <ReportView report={selected} onPrint={handlePrint} onDownload={() => handleDownload(selected)} onDelete={() => handleDelete(selected)} />
                )}
            </div>
            <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
        </div>
    );
};

// The printable rendering of a single monthly report. Wrapped in
// .wp-report-printable so the print stylesheet can isolate it from the app chrome.
const ReportView = ({ report, onPrint, onDownload, onDelete }) => {
    const d = report.data || {};
    const period = d.period || {};
    const site = d.site || {};
    const uptime = d.uptime || {};
    const updates = d.updates || {};
    const backups = d.backups || {};
    const vulns = d.vulnerabilities || {};
    const health = d.health || {};
    const sev = vulns.by_severity || {};
    const sevTone = (s) => ({ critical: 'red', high: 'red', medium: 'amber', low: 'cyan' }[s] || 'gray');
    const impactTone = (i) => ({ critical: 'red', major: 'red', minor: 'amber' }[i] || 'gray');
    const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
    const fmtDay = (key) => {
        if (!key) return '';
        const parts = key.split('-');
        return parts.length === 3 ? Number(parts[2]).toString() : key;
    };
    const dailyHasData = (d.uptime_daily || []).some(x => x.percent !== null);

    return (
        <div className="wp-report-printable">
            <div className="app-panel">
                <div className="app-panel-header">
                    Report — {period.month_name || report.period_label}
                    <span className="wp-report-actions wp-report-no-print">
                        <Button variant="outline" size="sm" onClick={onPrint}><Printer size={14} /> Print</Button>
                        <Button variant="outline" size="sm" onClick={onDownload}><Download size={14} /> JSON</Button>
                        <Button variant="outline" size="sm" onClick={onDelete}><Trash2 size={14} /> Delete</Button>
                    </span>
                </div>
                <div className="app-panel-body">
                    <div className="app-info-grid">
                        <div className="app-info-item"><span className="app-info-label">Site</span><span className="app-info-value">{site.name || '—'}</span></div>
                        {site.client && <div className="app-info-item"><span className="app-info-label">Client</span><span className="app-info-value">{site.client}</span></div>}
                        <div className="app-info-item"><span className="app-info-label">URL</span><span className="app-info-value">{site.url ? <a href={site.url} target="_blank" rel="noopener noreferrer">{site.url}</a> : '—'}</span></div>
                        <div className="app-info-item"><span className="app-info-label">WordPress</span><span className="app-info-value">{site.wp_version || '—'}{site.multisite ? ' · multisite' : ''}</span></div>
                        <div className="app-info-item"><span className="app-info-label">Generated</span><span className="app-info-value">{fmt(d.generated_at)}</span></div>
                    </div>
                </div>
            </div>

            <div className="app-panel">
                <div className="app-panel-header">Summary</div>
                <div className="app-panel-body">
                    <div className="app-info-grid">
                        <div className="app-info-item"><span className="app-info-label">Uptime</span><span className="app-info-value">{uptime.percent !== null && uptime.percent !== undefined ? `${uptime.percent}%` : 'N/A'}</span></div>
                        <div className="app-info-item"><span className="app-info-label">Incidents</span><span className="app-info-value">{d.incident_count ?? 0}</span></div>
                        <div className="app-info-item"><span className="app-info-label">Update runs</span><span className="app-info-value">{updates.total_runs ?? 0}</span></div>
                        <div className="app-info-item"><span className="app-info-label">Components updated</span><span className="app-info-value">{updates.components_updated ?? 0}</span></div>
                        <div className="app-info-item"><span className="app-info-label">Backups</span><span className="app-info-value">{backups.count ?? 0}{backups.count ? ` · ${backups.total_bytes_human}` : ''}</span></div>
                        <div className="app-info-item"><span className="app-info-label">Open vulnerabilities</span><span className="app-info-value">{vulns.total ?? 0}</span></div>
                        <div className="app-info-item"><span className="app-info-label">Current health</span><span className="app-info-value">{health.status || 'unknown'}</span></div>
                        <div className="app-info-item"><span className="app-info-label">Disk usage</span><span className="app-info-value">{health.disk_usage_human || '—'}</span></div>
                    </div>
                    {(updates.rolled_back > 0 || updates.failed > 0) && (
                        <div className="app-detail-actions">
                            {updates.completed > 0 && <Pill kind="green">{updates.completed} completed</Pill>}
                            {updates.rolled_back > 0 && <Pill kind="amber">{updates.rolled_back} rolled back</Pill>}
                            {updates.failed > 0 && <Pill kind="red">{updates.failed} failed</Pill>}
                        </div>
                    )}
                </div>
            </div>

            {uptime.bound && dailyHasData && (
                <div className="app-panel">
                    <div className="app-panel-header">Daily uptime</div>
                    <div className="app-panel-body">
                        <ResponsiveContainer width="100%" height={200}>
                            <AreaChart data={d.uptime_daily || []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="wpUptime" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3ddc97" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#3ddc97" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#888" strokeOpacity={0.15} />
                                <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: '#888' }} minTickGap={16} axisLine={false} tickLine={false} />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#888' }} width={36} axisLine={false} tickLine={false} />
                                <Tooltip formatter={(v) => (v === null ? 'no data' : `${v}%`)} />
                                <Area connectNulls type="monotone" dataKey="percent" name="Uptime %" stroke="#3ddc97" fill="url(#wpUptime)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                        <p className="hint">Uptime recomputed from recorded health-check samples ({uptime.samples} this month). Rolling 30-day: {uptime.rolling_30d ?? '—'}%.</p>
                    </div>
                </div>
            )}

            {(d.incidents || []).length > 0 && (
                <div className="app-panel">
                    <div className="app-panel-header">Incidents</div>
                    <div className="app-panel-body">
                        {d.incidents.map(inc => (
                            <div className="wp-run-row" key={inc.id}>
                                <div className="wp-run-row-head">
                                    <Pill kind={impactTone(inc.impact)}>{inc.impact}</Pill>
                                    <strong>{inc.title}</strong>
                                </div>
                                <span className="form-hint">
                                    {fmt(inc.created_at)} → {inc.ongoing ? 'ongoing' : fmt(inc.resolved_at)} · {inc.duration_minutes} min · {inc.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {(updates.runs || []).length > 0 && (
                <div className="app-panel">
                    <div className="app-panel-header">Update runs</div>
                    <div className="app-panel-body">
                        {updates.runs.map(r => {
                            const n = (r.updated || []).length;
                            const kind = ({ completed: 'green', rolled_back: 'amber', failed: 'red', running: 'cyan' }[r.status] || 'gray');
                            return (
                                <div className="wp-run-row" key={r.id}>
                                    <div className="wp-run-row-head">
                                        <Pill kind={kind}>{r.status.replace('_', ' ')}</Pill>
                                        <span className="wp-run-row-meta">{fmt(r.started_at)} · {r.trigger}</span>
                                    </div>
                                    <span className="form-hint">
                                        {n === 0 ? 'No components needed updating' : `${n} component${n === 1 ? '' : 's'} updated`}
                                        {r.rolled_back ? ' · auto-rolled back' : ''}
                                        {r.error ? ` · ${r.error}` : ''}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {(backups.snapshots || []).length > 0 && (
                <div className="app-panel">
                    <div className="app-panel-header">Backups</div>
                    <div className="app-panel-body">
                        {backups.snapshots.map(s => (
                            <div className="app-info-item" key={s.id}>
                                <span className="app-info-label">{fmt(s.created_at)}{s.tag ? ` · ${s.tag}` : ''}</span>
                                <span className="app-info-value">{s.size_human} · {s.status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="app-panel">
                <div className="app-panel-header">Security posture {vulns.as_of ? `(as of ${fmt(vulns.as_of)})` : ''}</div>
                <div className="app-panel-body">
                    {vulns.total > 0 ? (
                        <>
                            <div className="app-detail-actions">
                                {sev.critical > 0 && <Pill kind="red">{sev.critical} critical</Pill>}
                                {sev.high > 0 && <Pill kind="red">{sev.high} high</Pill>}
                                {sev.medium > 0 && <Pill kind="amber">{sev.medium} medium</Pill>}
                                {sev.low > 0 && <Pill kind="cyan">{sev.low} low</Pill>}
                                {sev.unknown > 0 && <Pill kind="gray">{sev.unknown} unrated</Pill>}
                            </div>
                            {(vulns.items || []).map((v, i) => (
                                <div className="wp-run-row" key={i}>
                                    <div className="wp-run-row-head"><Pill kind={sevTone(v.severity)}>{v.severity}</Pill><strong>{v.name}</strong></div>
                                    <span className="form-hint">
                                        {v.source}{v.slug ? ` · ${v.slug}` : ''} · installed {v.installed_version}
                                        {v.fixed_in ? ` · fixed in ${v.fixed_in}` : ' · no fix yet'}
                                        {v.advisory_id ? ` · ${v.advisory_id}` : ''}
                                    </span>
                                </div>
                            ))}
                        </>
                    ) : (
                        <p className="hint">{vulns.as_of ? 'No known vulnerabilities at last scan.' : 'No vulnerability scan has run for this site yet.'}</p>
                    )}
                </div>
            </div>

            {(d.notes || []).length > 0 && (
                <div className="app-panel">
                    <div className="app-panel-body">
                        {d.notes.map((n, i) => <p className="hint" key={i}>{n}</p>)}
                    </div>
                </div>
            )}
        </div>
    );
};

// Overview Tab
const OverviewTab = ({ site, onUpdate }) => {
    const toast = useToast();
    const navigate = useNavigate();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const [wpInfo, setWpInfo] = useState(null);
    const [updatingCore, setUpdatingCore] = useState(false);
    const [archiving, setArchiving] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [creatingSnapshot, setCreatingSnapshot] = useState(false);
    const [showEnvModal, setShowEnvModal] = useState(false);
    const [syncingAll, setSyncingAll] = useState(false);
    const [flushingCache, setFlushingCache] = useState(false);
    const [hardening, setHardening] = useState(false);
    const [pageCacheActive, setPageCacheActive] = useState(false);
    const [togglingPageCache, setTogglingPageCache] = useState(false);
    const [objectCache, setObjectCache] = useState(null);
    const [togglingCache, setTogglingCache] = useState(false);
    const [showSearchReplace, setShowSearchReplace] = useState(false);
    const [health, setHealth] = useState(null);
    const [diskUsage, setDiskUsage] = useState(null);
    const [healthLoading, setHealthLoading] = useState(true);
    const [healthError, setHealthError] = useState(false);

    // Live WP-CLI info (core version + update availability) — best-effort.
    useEffect(() => {
        let active = true;
        wordpressApi.getWordPressInfo(site.id)
            .then(data => { if (active) setWpInfo(data.info || data); })
            .catch(() => { /* info is best-effort; the badge just won't show */ });
        return () => { active = false; };
    }, [site.id]);

    // Site health + disk usage (both can be slow / unavailable; non-fatal).
    useEffect(() => {
        let cancelled = false;
        setHealthLoading(true);
        setHealthError(false);
        (async () => {
            try {
                const [healthRes, diskRes] = await Promise.all([
                    wordpressApi.getProjectHealth(site.id).catch(() => null),
                    wordpressApi.getProjectDiskUsage(site.id).catch(() => null),
                ]);
                if (cancelled) return;
                const ownHealth = healthRes?.success
                    ? (healthRes.environments?.[site.id] || healthRes.environments?.[String(site.id)] || null)
                    : null;
                setHealth(ownHealth);
                const ownDisk = diskRes?.success
                    ? (diskRes.environments?.[site.id] || diskRes.environments?.[String(site.id)] || null)
                    : null;
                setDiskUsage(ownDisk?.usage || null);
                if (!healthRes && !diskRes) setHealthError(true);
            } catch {
                if (!cancelled) setHealthError(true);
            } finally {
                if (!cancelled) setHealthLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [site.id]);

    async function handleUpdateCore() {
        setUpdatingCore(true);
        toast.info('Updating WordPress core...', { duration: 4000 });
        try {
            const res = await wordpressApi.updateCore(site.id);
            if (res.success === false) {
                toast.error(res.error || 'Core update failed');
                return;
            }
            toast.success(res.message || 'WordPress core updated');
            const fresh = await wordpressApi.getWordPressInfo(site.id);
            setWpInfo(fresh.info || fresh);
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Core update failed');
        } finally {
            setUpdatingCore(false);
        }
    }

    async function handleQuickSnapshot() {
        setCreatingSnapshot(true);
        toast.info('Creating snapshot...', { duration: 2000 });
        try {
            await wordpressApi.createSnapshot(site.id, {
                name: `Quick Snapshot ${new Date().toLocaleDateString()}`,
                tag: 'quick',
                description: 'Created from Overview quick action'
            });
            toast.success('Snapshot created successfully');
        } catch (err) {
            toast.error(err.message || 'Failed to create snapshot');
        } finally {
            setCreatingSnapshot(false);
        }
    }

    async function handleSyncAll() {
        if (!site.environments?.length) return;
        setSyncingAll(true);
        toast.info(`Syncing ${site.environments.length} environment(s)...`, { duration: 3000 });
        try {
            // Sync each environment sequentially
            for (let i = 0; i < site.environments.length; i++) {
                const env = site.environments[i];
                await wordpressApi.syncEnvironment(site.id, { environment_id: env.id });
            }
            toast.success(`Synced ${site.environments.length} environment(s) from production`);
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Failed to sync environments');
        } finally {
            setSyncingAll(false);
        }
    }

    async function handleCreateEnvironment(data) {
        toast.info('Creating environment... This may take a moment.', { duration: 5000 });
        try {
            await wordpressApi.createEnvironment(site.id, data);
            toast.success('Environment created successfully');
            setShowEnvModal(false);
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Failed to create environment');
        }
    }

    useEffect(() => {
        let active = true;
        wordpressApi.getPageCache(site.id)
            .then(r => { if (active) setPageCacheActive(Boolean(r?.active)); })
            .catch(() => { /* best-effort; control just shows Enable */ });
        wordpressApi.getObjectCacheStatus(site.id)
            .then(s => { if (active) setObjectCache(s); })
            .catch(() => {});
        return () => { active = false; };
    }, [site.id]);

    async function handleTogglePageCache() {
        setTogglingPageCache(true);
        const enabling = !pageCacheActive;
        toast.info(enabling ? 'Enabling page cache...' : 'Disabling page cache...', { duration: 4000 });
        try {
            const res = enabling
                ? await wordpressApi.enablePageCache(site.id)
                : await wordpressApi.disablePageCache(site.id);
            if (res.success === false) {
                toast.error(res.error || 'Page cache change failed');
            } else {
                toast.success(res.message || (enabling ? 'Page cache enabled' : 'Page cache disabled'));
                setPageCacheActive(enabling);
            }
        } catch (err) {
            toast.error(err.message || 'Page cache change failed');
        } finally {
            setTogglingPageCache(false);
        }
    }

    async function handleToggleObjectCache() {
        setTogglingCache(true);
        const enabling = !objectCache?.enabled;
        toast.info(enabling ? 'Enabling Redis object cache...' : 'Disabling object cache...', { duration: 4000 });
        try {
            const res = enabling
                ? await wordpressApi.enableObjectCache(site.id)
                : await wordpressApi.disableObjectCache(site.id);
            if (res.success === false) {
                toast.error(res.error || 'Object cache change failed');
            } else {
                toast.success(res.message || (enabling ? 'Object cache enabled' : 'Object cache disabled'));
                const fresh = await wordpressApi.getObjectCacheStatus(site.id).catch(() => null);
                if (fresh) setObjectCache(fresh);
            }
        } catch (err) {
            toast.error(err.message || 'Object cache change failed');
        } finally {
            setTogglingCache(false);
        }
    }

    async function handleFlushCache() {
        setFlushingCache(true);
        toast.info('Flushing cache...', { duration: 2000 });
        try {
            const res = await wordpressApi.flushCache(site.id);
            toast.success(res.message || 'Cache flushed');
        } catch (err) {
            toast.error(err.message || 'Failed to flush cache');
        } finally {
            setFlushingCache(false);
        }
    }

    async function handleHarden() {
        if (!window.confirm('Apply security hardening? This disables file editing, the XML-RPC endpoint, forces SSL on wp-admin, tightens file permissions, and regenerates security keys (logs users out).')) {
            return;
        }
        setHardening(true);
        toast.info('Applying security hardening...', { duration: 4000 });
        try {
            const res = await wordpressApi.harden(site.id);
            toast.success(res.message || 'Security hardening applied');
        } catch (err) {
            toast.error(err.message || 'Failed to harden site');
        } finally {
            setHardening(false);
        }
    }

    async function handleArchive() {
        const ok = await confirm({
            title: 'Archive Site',
            message: `Stop and archive "${site.name}"? Containers are stopped but all files and the database are kept. You can unarchive it later.`,
            confirmText: 'Archive',
            variant: 'warning',
        });
        if (!ok) return;
        setArchiving(true);
        toast.info('Archiving site...', { duration: 3000 });
        try {
            await wordpressApi.archiveSite(site.id);
            toast.success('Site archived');
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Failed to archive site');
        } finally {
            setArchiving(false);
        }
    }

    async function handleUnarchive() {
        setArchiving(true);
        toast.info('Unarchiving site...', { duration: 3000 });
        try {
            await wordpressApi.unarchiveSite(site.id);
            toast.success('Site unarchived');
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Failed to unarchive site');
        } finally {
            setArchiving(false);
        }
    }

    async function handleDelete(createBackup) {
        toast.info(createBackup ? 'Creating final backup and deleting site...' : 'Deleting site...', { duration: 5000 });
        try {
            await wordpressApi.deleteSite(site.id, { createBackup });
            toast.success('Site deleted');
            setShowDeleteModal(false);
            navigate('/wordpress');
        } catch (err) {
            toast.error(err.message || 'Failed to delete site');
        }
    }

    async function handleSearchReplace(data) {
        // data = { search, replace, dry_run }
        toast.info(data.dry_run ? 'Running search-replace preview...' : 'Running search-replace...', { duration: 3000 });
        try {
            const res = await wordpressApi.searchReplace(site.id, data);
            if (res.success === false) {
                toast.error(res.error || res.message || 'Search-replace failed');
                return;
            }
            toast.success(data.dry_run ? 'Dry run complete - no changes written' : 'Search-replace complete');
            if (!data.dry_run) setShowSearchReplace(false);
        } catch (err) {
            toast.error(err.message || 'Search-replace failed');
        }
    }

    const statusTone = site.status === 'running' ? 'green' : site.status === 'archived' ? 'violet' : 'amber';
    const statusLabel = (site.status || 'unknown').replace(/^./, c => c.toUpperCase());

    return (
        <div className="wp-overview">
            <div className="wp-kpis">
                <MetricCard icon={<Activity size={16} />} tone={statusTone} value={statusLabel} label="Status" />
                <MetricCard icon={<Globe size={16} />} tone="accent" value={wpInfo?.version || site.wp_version || '—'} label="WordPress core" />
                <MetricCard icon={<HardDrive size={16} />} tone="cyan" value={site.disk_usage_human || '—'} label="Disk usage" />
                {site.is_production && (
                    <MetricCard icon={<Layers size={16} />} tone="violet" value={1 + (site.environments || []).length} label="Environments" />
                )}
            </div>
            <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="app-panel">
                    <div className="app-panel-header">Site Information</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item">
                                <span className="app-info-label">WordPress Version</span>
                                <span className="app-info-value">
                                    {wpInfo?.version || site.wp_version || 'Unknown'}
                                    {wpInfo?.update_available && (
                                        <>
                                            <span className="wp-update-badge">
                                                Update available{wpInfo.latest_version ? `: ${wpInfo.latest_version}` : ''}
                                            </span>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleUpdateCore}
                                                disabled={updatingCore}
                                            >
                                                {updatingCore ? 'Updating...' : 'Update'}
                                            </Button>
                                        </>
                                    )}
                                </span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Multisite</span>
                                <span className="app-info-value">{site.multisite ? 'Yes' : 'No'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Admin User</span>
                                <span className="app-info-value">{site.admin_user || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Admin Email</span>
                                <span className="app-info-value">{site.admin_email || '-'}</span>
                            </div>
                            <div className="app-info-item full-width">
                                <span className="app-info-label">Site URL</span>
                                <span className="app-info-value">
                                    {site.url ? (
                                        <a href={site.url} target="_blank" rel="noopener noreferrer">
                                            {site.url}
                                        </a>
                                    ) : '-'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">Database Configuration</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item">
                                <span className="app-info-label">Database Name</span>
                                <span className="app-info-value mono">{site.db_name || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Database User</span>
                                <span className="app-info-value mono">{site.db_user || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Database Host</span>
                                <span className="app-info-value mono">{site.db_host || 'localhost'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Table Prefix</span>
                                <span className="app-info-value mono">{site.db_prefix || 'wp_'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">Site Health</div>
                    <div className="app-panel-body">
                        {healthLoading ? (
                            <p className="hint">Checking site health...</p>
                        ) : (
                            <>
                                <div className="app-info-grid">
                                    <div className="app-info-item">
                                        <span className="app-info-label">Status</span>
                                        <span className="app-info-value app-health-stat">
                                            <HealthDot status={health?.overall_status || site.health_status || 'unknown'} size={10} />
                                            {(health?.overall_status || site.health_status || 'unknown').replace(/^./, c => c.toUpperCase())}
                                        </span>
                                    </div>
                                    <div className="app-info-item">
                                        <span className="app-info-label">WordPress Version</span>
                                        <span className="app-info-value">{wpInfo?.version || site.wp_version || 'Unknown'}</span>
                                    </div>
                                    {site.application?.php_version && (
                                        <div className="app-info-item">
                                            <span className="app-info-label">PHP Version</span>
                                            <span className="app-info-value">{site.application.php_version}</span>
                                        </div>
                                    )}
                                    <div className="app-info-item">
                                        <span className="app-info-label">Container</span>
                                        <span className="app-info-value app-health-stat">
                                            <HealthDot status={health?.checks?.container?.status || 'unknown'} size={8} />
                                            {health?.checks?.container?.message || (site.status === 'running' ? 'Running' : 'Stopped')}
                                        </span>
                                    </div>
                                    <div className="app-info-item">
                                        <span className="app-info-label">Database</span>
                                        <span className="app-info-value app-health-stat">
                                            <HealthDot status={health?.checks?.mysql?.status || 'unknown'} size={8} />
                                            {health?.checks?.mysql?.message || '-'}
                                        </span>
                                    </div>
                                    <div className="app-info-item">
                                        <span className="app-info-label">HTTP</span>
                                        <span className="app-info-value app-health-stat">
                                            <HealthDot status={health?.checks?.wordpress?.status || 'unknown'} size={8} />
                                            {health?.checks?.wordpress?.message || '-'}
                                        </span>
                                    </div>
                                </div>

                                {diskUsage ? (
                                    <div className="app-health-disk">
                                        <span className="app-info-label">Disk Usage</span>
                                        <DiskUsageBar usage={diskUsage} />
                                    </div>
                                ) : (
                                    <p className="hint">Disk usage unavailable.</p>
                                )}

                                {healthError && !health && (
                                    <p className="hint">Live health checks unavailable for this site.</p>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {site.git_repo_url && (
                    <div className="app-panel">
                        <div className="app-panel-header">Git Integration</div>
                        <div className="app-panel-body">
                            <div className="app-info-grid">
                                <div className="app-info-item full-width">
                                    <span className="app-info-label">Repository</span>
                                    <span className="app-info-value mono">{site.git_repo_url}</span>
                                </div>
                                <div className="app-info-item">
                                    <span className="app-info-label">Branch</span>
                                    <span className="app-info-value">{site.git_branch || 'main'}</span>
                                </div>
                                <div className="app-info-item">
                                    <span className="app-info-label">Auto Deploy</span>
                                    <span className="app-info-value">{site.auto_deploy ? 'Enabled' : 'Disabled'}</span>
                                </div>
                                {site.last_deploy_commit && (
                                    <div className="app-info-item">
                                        <span className="app-info-label">Last Deploy</span>
                                        <span className="app-info-value mono">{site.last_deploy_commit.substring(0, 7)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                <SiteSSLPanel site={site} />

                <div className="app-panel">
                    <div className="app-panel-header">Danger Zone</div>
                    <div className="app-panel-body">
                        {site.status === 'archived' ? (
                            <DangerZone
                                title="Unarchive Site"
                                description="Restart this site's containers and bring it back online."
                                action={(
                                    <Button variant="outline" onClick={handleUnarchive} disabled={archiving}>
                                        <Archive size={16} />
                                        {archiving ? 'Unarchiving...' : 'Unarchive'}
                                    </Button>
                                )}
                            />
                        ) : (
                            <DangerZone
                                title="Archive Site"
                                description="Stop the containers but keep all files and the database. Reversible."
                                action={(
                                    <Button variant="outline" onClick={handleArchive} disabled={archiving}>
                                        <Archive size={16} />
                                        {archiving ? 'Archiving...' : 'Archive'}
                                    </Button>
                                )}
                            />
                        )}
                        <DangerZone
                            title="Delete Site"
                            description="Permanently remove this site, all environments, files and databases. A final backup is taken by default."
                            action={(
                                <Button variant="destructive" onClick={() => setShowDeleteModal(true)}>
                                    <Trash2 size={16} />
                                    Delete Site
                                </Button>
                            )}
                        />
                    </div>
                </div>
            </div>

            <div className="app-overview-right">
                <div className="app-panel">
                    <div className="app-panel-header">Quick Actions</div>
                    <div className="app-panel-body">
                        <div className="quick-actions-grid">
                            {site.url && (
                                <>
                                    <a
                                        href={site.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="quick-action-btn"
                                    >
                                        <ExternalLink size={16} />
                                        Visit Site
                                    </a>
                                    <a
                                        href={`${site.url}/wp-admin`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="quick-action-btn"
                                    >
                                        <Settings size={16} />
                                        WP Admin
                                    </a>
                                </>
                            )}
                            {site.is_production && (site.environments || []).length < 2 && (
                                <button
                                    className="quick-action-btn"
                                    onClick={() => setShowEnvModal(true)}
                                >
                                    <Plus size={16} />
                                    Create Environment
                                </button>
                            )}
                            <button
                                className="quick-action-btn"
                                onClick={handleQuickSnapshot}
                                disabled={creatingSnapshot}
                            >
                                <Database size={16} />
                                {creatingSnapshot ? 'Creating...' : 'Create Snapshot'}
                            </button>
                            {site.environments?.length > 0 && (
                                <button
                                    className="quick-action-btn"
                                    onClick={handleSyncAll}
                                    disabled={syncingAll}
                                >
                                    <RefreshCw size={16} className={syncingAll ? 'spinning' : ''} />
                                    {syncingAll ? 'Syncing...' : 'Sync All Envs'}
                                </button>
                            )}
                            <button
                                className="quick-action-btn"
                                onClick={handleFlushCache}
                                disabled={flushingCache}
                            >
                                <Trash2 size={16} />
                                {flushingCache ? 'Flushing...' : 'Purge Cache'}
                            </button>
                            <button
                                className="quick-action-btn"
                                onClick={handleTogglePageCache}
                                disabled={togglingPageCache}
                                title={pageCacheActive ? 'Full-page cache is active' : 'Enable a full-page cache for this site'}
                            >
                                <Zap size={16} />
                                {togglingPageCache
                                    ? 'Working...'
                                    : (pageCacheActive ? 'Page Cache: On' : 'Enable Page Cache')}
                            </button>
                            <button
                                className="quick-action-btn"
                                onClick={() => setShowSearchReplace(true)}
                            >
                                <Replace size={16} />
                                Search &amp; Replace
                            </button>
                            <button
                                className="quick-action-btn"
                                onClick={handleHarden}
                                disabled={hardening}
                            >
                                <ShieldCheck size={16} />
                                {hardening ? 'Hardening...' : 'Harden'}
                            </button>
                            <button
                                className="quick-action-btn"
                                onClick={handleToggleObjectCache}
                                disabled={togglingCache}
                                title={objectCache?.enabled ? 'Redis object cache is active' : 'Enable a Redis object cache for this site'}
                            >
                                <Database size={16} />
                                {togglingCache
                                    ? (objectCache?.enabled ? 'Disabling...' : 'Enabling...')
                                    : (objectCache?.enabled ? 'Object Cache: On' : 'Enable Object Cache')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {showEnvModal && (() => {
                const envs = site.environments || [];
                const modalHasStaging = envs.some(e => e.environment_type === 'staging');
                const modalHasDev = envs.some(e => e.environment_type === 'development');
                return (
                    <CreateEnvironmentModal
                        onClose={() => setShowEnvModal(false)}
                        onCreate={handleCreateEnvironment}
                        productionDomain={site.url}
                        hasStaging={modalHasStaging}
                        hasDev={modalHasDev}
                    />
                );
            })()}

            {showSearchReplace && (
                <SearchReplaceModal
                    onClose={() => setShowSearchReplace(false)}
                    onSubmit={handleSearchReplace}
                />
            )}

            {showDeleteModal && (
                <DeleteSiteModal
                    siteName={site.name}
                    onClose={() => setShowDeleteModal(false)}
                    onConfirm={handleDelete}
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
        </div>
    );
};

// SSL Certificate panel — live status + issuance for the site's primary domain
const SiteSSLPanel = ({ site }) => {
    const toast = useToast();
    const domains = site.application?.domains || [];
    const primaryDomain = (domains.find(d => d.is_primary) || domains[0])?.name || null;
    // localhost / private-IP / no-domain sites cannot get a public certificate.
    const isPublicDomain = !!primaryDomain
        && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(primaryDomain)
        && primaryDomain.includes('.');
    const [health, setHealth] = useState(null);
    const [checking, setChecking] = useState(true);
    const [issuing, setIssuing] = useState(false);

    useEffect(() => {
        if (!primaryDomain) { setChecking(false); return; }
        let cancelled = false;
        (async () => {
            setChecking(true);
            try {
                const res = await api.getSSLHealth(primaryDomain);
                if (!cancelled) setHealth(res);
            } catch (err) {
                if (!cancelled) setHealth({ valid: false, error: err.message });
            } finally {
                if (!cancelled) setChecking(false);
            }
        })();
        return () => { cancelled = true; };
    }, [primaryDomain]);

    async function handleEnableSSL() {
        if (!primaryDomain || !site.admin_email) return;
        setIssuing(true);
        toast.info(`Requesting certificate for ${primaryDomain}...`, { duration: 4000 });
        try {
            const res = await api.obtainCertificate({ domains: [primaryDomain], email: site.admin_email, use_nginx: true });
            if (res.success) {
                toast.success(res.message || 'Certificate issued');
                const updated = await api.getSSLHealth(primaryDomain);
                setHealth(updated);
            } else {
                toast.error(res.error || 'Certificate request failed');
            }
        } catch (err) {
            toast.error(err.message || 'Certificate request failed');
        } finally {
            setIssuing(false);
        }
    }

    const issued = health?.valid;
    return (
        <div className="app-panel">
            <div className="app-panel-header"><Lock size={16} /> SSL Certificate</div>
            <div className="app-panel-body">
                <div className="app-info-grid">
                    <div className="app-info-item">
                        <span className="app-info-label">Primary Domain</span>
                        <span className="app-info-value mono">{primaryDomain || 'None configured'}</span>
                    </div>
                    <div className="app-info-item">
                        <span className="app-info-label">Status</span>
                        <span className="app-info-value">
                            <Pill kind={checking ? 'gray' : issued ? 'green' : 'amber'}>
                                {checking ? 'Checking...' : issued ? `Active (${health.grade})` : 'Not Secured'}
                            </Pill>
                        </span>
                    </div>
                    {issued && health.expires_at && (
                        <div className="app-info-item">
                            <span className="app-info-label">Expires</span>
                            <span className="app-info-value">
                                {new Date(health.expires_at).toLocaleDateString()}
                                {typeof health.days_remaining === 'number' ? ` (${health.days_remaining}d)` : ''}
                            </span>
                        </div>
                    )}
                    {issued && health.issuer && (
                        <div className="app-info-item">
                            <span className="app-info-label">Issuer</span>
                            <span className="app-info-value">{health.issuer}</span>
                        </div>
                    )}
                </div>
                {!isPublicDomain ? (
                    <p className="hint">SSL requires a public domain pointed at this server. This site is on <code>{primaryDomain || 'localhost'}</code>, so a certificate cannot be issued here. Map a public domain to the site first.</p>
                ) : !site.admin_email ? (
                    <p className="hint">Set an admin email on the site before requesting a certificate.</p>
                ) : (
                    <Button onClick={handleEnableSSL} disabled={issuing} className="ssl-action-btn">
                        <Lock size={14} /> {issuing ? 'Requesting...' : issued ? 'Re-issue Certificate' : 'Enable SSL'}
                    </Button>
                )}
            </div>
        </div>
    );
};

// Search & Replace Modal (DB string replacement, guarded by dry-run)
const SearchReplaceModal = ({ onClose, onSubmit }) => {
    const [search, setSearch] = useState('');
    const [replace, setReplace] = useState('');
    const [loading, setLoading] = useState(false);

    async function run(dryRun) {
        if (!search.trim() || !replace.trim()) return;
        setLoading(true);
        try {
            await onSubmit({ search: search.trim(), replace: replace.trim(), dry_run: dryRun });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Search &amp; Replace</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); run(false); }}>
                    <p className="hint">Replaces a string across all database tables (e.g. an old domain). Always preview with a dry run first.</p>

                    <div className="form-group">
                        <Label>Search for *</Label>
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="https://old-domain.com"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <Label>Replace with *</Label>
                        <Input
                            type="text"
                            value={replace}
                            onChange={(e) => setReplace(e.target.value)}
                            placeholder="https://new-domain.com"
                            required
                        />
                    </div>

                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="button" variant="outline" onClick={() => run(true)} disabled={loading || !search.trim() || !replace.trim()}>
                            {loading ? 'Running...' : 'Dry Run'}
                        </Button>
                        <Button type="submit" disabled={loading || !search.trim() || !replace.trim()}>
                            {loading ? 'Running...' : 'Run Replace'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Delete Site Modal (typed confirmation + optional final backup)
const DeleteSiteModal = ({ siteName, onClose, onConfirm }) => {
    const [createBackup, setCreateBackup] = useState(true);
    const [typed, setTyped] = useState('');
    const [loading, setLoading] = useState(false);
    const canDelete = typed.trim() === siteName;

    async function handleSubmit(e) {
        e.preventDefault();
        if (!canDelete) return;
        setLoading(true);
        try {
            await onConfirm(createBackup);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Delete Site</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <p className="hint">This permanently deletes <strong>{siteName}</strong>, all its environments, files and databases. This cannot be undone.</p>
                    <div className="form-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={createBackup}
                                onChange={(e) => setCreateBackup(e.target.checked)}
                            />
                            <span>Create a final files + database backup before deleting</span>
                        </label>
                    </div>
                    <div className="form-group">
                        <Label>Type <strong>{siteName}</strong> to confirm *</Label>
                        <Input
                            type="text"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            placeholder={siteName}
                            autoFocus
                        />
                    </div>
                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="destructive" disabled={loading || !canDelete}>
                            {loading ? 'Deleting...' : 'Delete Site'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Reusable Skeleton Components for Tabs
const EnvironmentCardSkeleton = () => (
    <div className="wp-env-card-skeleton">
        <div className="wp-env-card-skeleton-header">
            <div className="wp-env-card-skeleton-badge" />
            <div className="wp-env-card-skeleton-status" />
        </div>
        <div className="wp-env-card-skeleton-body">
            <div className="wp-env-card-skeleton-url" />
            <div className="wp-env-card-skeleton-meta">
                <div className="wp-env-card-skeleton-meta-item">
                    <div className="skeleton-label" />
                    <div className="skeleton-value" />
                </div>
                <div className="wp-env-card-skeleton-meta-item">
                    <div className="skeleton-label" />
                    <div className="skeleton-value" />
                </div>
            </div>
        </div>
        <div className="wp-env-card-skeleton-footer">
            <div className="skeleton" style={{ flex: 1, height: 28, borderRadius: 4 }} />
            <div className="skeleton" style={{ flex: 1, height: 28, borderRadius: 4 }} />
        </div>
    </div>
);

const TableRowSkeleton = () => (
    <div className="skeleton-table-row">
        <div className="skeleton-cell cell-name" />
        <div className="skeleton-cell cell-tag" />
        <div className="skeleton-cell cell-size" />
        <div className="skeleton-cell cell-date" />
        <div className="skeleton-cell cell-actions" />
    </div>
);

const ListItemSkeleton = () => (
    <div className="skeleton" style={{ height: 48, borderRadius: 6, marginBottom: 8 }} />
);

// Environments Tab
const EnvironmentsTab = ({ siteId, site, onUpdate }) => {
    const toast = useToast();
    const [environments, setEnvironments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        loadEnvironments();
    }, [siteId]);

    async function loadEnvironments() {
        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.getEnvironments(siteId);
            setEnvironments(data.environments || []);
        } catch (err) {
            console.error('Failed to load environments:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateEnvironment(data) {
        toast.info('Creating environment... This may take a moment.', { duration: 5000 });
        try {
            await wordpressApi.createEnvironment(siteId, data);
            toast.success('Environment created successfully');
            loadEnvironments();
            setShowCreateModal(false);
        } catch (err) {
            toast.error(err.message || 'Failed to create environment');
        }
    }

    async function handleSync(envId) {
        toast.info('Syncing from production...', { duration: 3000 });
        try {
            await wordpressApi.syncEnvironment(siteId, { environment_id: envId });
            toast.success('Environment synced from production');
            loadEnvironments();
        } catch (err) {
            toast.error(err.message || 'Failed to sync environment');
        }
    }

    async function handleDelete(envId) {
        toast.info('Deleting environment...', { duration: 2000 });
        try {
            await wordpressApi.deleteEnvironment(siteId, envId);
            toast.success('Environment deleted');
            loadEnvironments();
        } catch (err) {
            toast.error(err.message || 'Failed to delete environment');
        }
    }

    if (loading) {
        return (
            <div className="environments-tab">
                <div className="section-header">
                    <div className="skeleton" style={{ width: 120, height: 24 }} />
                    <div className="skeleton" style={{ width: 160, height: 36, borderRadius: 6 }} />
                </div>
                <div className="environments-grid">
                    <EnvironmentCardSkeleton />
                    <EnvironmentCardSkeleton />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load environments"
                error={error}
                onRetry={loadEnvironments}
            />
        );
    }

    // Filter out production from the environments list (it's shown separately)
    const childEnvs = environments.filter(e => e.id !== site.id && !e.is_production);
    const hasStaging = childEnvs.some(e => e.environment_type === 'staging');
    const hasDev = childEnvs.some(e => e.environment_type === 'development');
    const canCreateMore = site.is_production && (!hasStaging || !hasDev);

    return (
        <div className="environments-tab">
            <div className="section-header">
                <h3>Environments</h3>
                {canCreateMore && (
                    <Button onClick={() => setShowCreateModal(true)}>
                        <Plus size={14} /> Create Environment
                    </Button>
                )}
            </div>

            <div className="environments-grid">
                {/* Production environment (the current site) */}
                <EnvironmentCard
                    environment={{
                        id: site.id,
                        name: site.name,
                        url: site.url,
                        status: site.status,
                        db_name: site.db_name,
                        type: 'production'
                    }}
                    isProduction={true}
                />

                {/* Dev/staging environments */}
                {childEnvs.map(env => (
                    <EnvironmentCard
                        key={env.id}
                        environment={env}
                        productionUrl={site.url}
                        onSync={handleSync}
                        onDelete={handleDelete}
                    />
                ))}

                {/* Add-environment tile — sits inline next to the existing
                    environments instead of a full-width "empty" block. */}
                {canCreateMore && (
                    <button
                        type="button"
                        className="wp-env-add-tile"
                        onClick={() => setShowCreateModal(true)}
                    >
                        <span className="wp-env-add-tile__icon"><Plus size={22} /></span>
                        <span className="wp-env-add-tile__title">Create environment</span>
                        <span className="wp-env-add-tile__hint">
                            {childEnvs.length === 0
                                ? 'Spin up a dev or staging copy to test changes safely before deploying to production.'
                                : 'Add another dev or staging copy.'}
                        </span>
                    </button>
                )}
            </div>

            {showCreateModal && (
                <CreateEnvironmentModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleCreateEnvironment}
                    productionDomain={site.url}
                    hasStaging={hasStaging}
                    hasDev={hasDev}
                />
            )}
        </div>
    );
};

// Create Environment Modal
const CreateEnvironmentModal = ({ onClose, onCreate, productionDomain, hasStaging = false, hasDev = false }) => {
    // Default to whichever type is still available
    const defaultType = !hasDev ? 'development' : !hasStaging ? 'staging' : 'development';
    const [formData, setFormData] = useState({
        type: defaultType,
        name: '',
        domain: '',
        cloneDb: true,
        syncSchedule: ''
    });
    const [loading, setLoading] = useState(false);

    // Generate suggested domain based on production domain
    function getSuggestedDomain() {
        if (!productionDomain) return '';
        try {
            const url = new URL(productionDomain);
            const prefix = formData.type === 'staging' ? 'staging' : 'dev';
            return `${prefix}.${url.hostname}`;
        } catch {
            return '';
        }
    }

    const suggestedDomain = getSuggestedDomain();
    const displayDomain = formData.domain || suggestedDomain;

    function handleChange(e) {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        try {
            await onCreate({
                type: formData.type,
                name: formData.name,
                domain: formData.domain || suggestedDomain,
                clone_db: formData.cloneDb,
                sync_schedule: formData.syncSchedule || null
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Environment</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <Label>Environment Type</Label>
                        <select name="type" value={formData.type} onChange={handleChange}>
                            {!hasDev && <option value="development">Development</option>}
                            {!hasStaging && <option value="staging">Staging</option>}
                        </select>
                    </div>

                    <div className="form-group">
                        <Label>Environment Name *</Label>
                        <Input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="My Site Dev"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <Label>Domain</Label>
                        <Input
                            type="text"
                            name="domain"
                            value={formData.domain}
                            onChange={handleChange}
                            placeholder={suggestedDomain || 'dev.example.com'}
                        />
                        {suggestedDomain && !formData.domain && (
                            <span className="form-hint form-hint-domain">
                                Will use: <code>{suggestedDomain}</code>
                            </span>
                        )}
                        {!suggestedDomain && !formData.domain && (
                            <span className="form-hint">Enter a domain or leave empty to auto-generate</span>
                        )}
                    </div>

                    {displayDomain && (
                        <div className="env-preview-url">
                            <span className="preview-label">Environment URL:</span>
                            <span className="preview-url">https://{displayDomain}</span>
                        </div>
                    )}

                    <div className="form-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                name="cloneDb"
                                checked={formData.cloneDb}
                                onChange={handleChange}
                            />
                            <span>Clone production database</span>
                        </label>
                    </div>

                    <div className="form-group">
                        <Label>Sync Schedule (optional)</Label>
                        <select name="syncSchedule" value={formData.syncSchedule} onChange={handleChange}>
                            <option value="">No automatic sync</option>
                            <option value="0 3 * * 0">Weekly (Sunday 3am)</option>
                            <option value="0 3 * * *">Daily (3am)</option>
                        </select>
                        <span className="form-hint">Automatically sync database from production</span>
                    </div>

                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Environment'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Database Tab
const DatabaseTab = ({ siteId, site }) => {
    const toast = useToast();
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        loadSnapshots();
    }, [siteId]);

    async function loadSnapshots() {
        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.getSnapshots(siteId);
            setSnapshots(data.snapshots || []);
        } catch (err) {
            console.error('Failed to load snapshots:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateSnapshot(data) {
        toast.info('Creating snapshot...', { duration: 3000 });
        try {
            await wordpressApi.createSnapshot(siteId, data);
            toast.success('Snapshot created successfully');
            loadSnapshots();
            setShowCreateModal(false);
        } catch (err) {
            toast.error(err.message || 'Failed to create snapshot');
        }
    }

    async function handleRestore(snapId) {
        toast.info('Restoring database... This may take a moment.', { duration: 5000 });
        try {
            await wordpressApi.restoreSnapshot(siteId, snapId);
            toast.success('Database restored from snapshot');
        } catch (err) {
            toast.error(err.message || 'Failed to restore snapshot');
        }
    }

    async function handleDelete(snapId) {
        try {
            await wordpressApi.deleteSnapshot(siteId, snapId);
            toast.success('Snapshot deleted');
            loadSnapshots();
        } catch (err) {
            toast.error(err.message || 'Failed to delete snapshot');
        }
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load snapshots"
                error={error}
                onRetry={loadSnapshots}
            />
        );
    }

    return (
        <div className="database-tab">
            {/* Database Connection Info */}
            <div className="app-panel">
                <div className="app-panel-header">
                    <Database size={16} />
                    Database Connection
                </div>
                <div className="app-panel-body">
                    <div className="app-info-grid">
                        <div className="app-info-item">
                            <span className="app-info-label">Database Name</span>
                            <span className="app-info-value mono">{site?.db_name || 'wordpress'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Database User</span>
                            <span className="app-info-value mono">{site?.db_user || 'wordpress'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Database Host</span>
                            <span className="app-info-value mono">{site?.db_host || 'db'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Table Prefix</span>
                            <span className="app-info-value mono">{site?.db_prefix || 'wp_'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Container</span>
                            <span className="app-info-value mono">{site?.compose_project_name ? `${site.compose_project_name}-db` : '-'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Engine</span>
                            <span className="app-info-value">MySQL 8.0</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Snapshots */}
            <div className="section-header mt-6">
                <h3>Database Snapshots</h3>
                <Button onClick={() => setShowCreateModal(true)}>
                    <Plus size={14} /> Create Snapshot
                </Button>
            </div>

            <SnapshotTable
                snapshots={snapshots}
                loading={loading}
                onRestore={handleRestore}
                onDelete={handleDelete}
            />

            {showCreateModal && (
                <CreateSnapshotModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleCreateSnapshot}
                />
            )}
        </div>
    );
};

// Create Snapshot Modal
const CreateSnapshotModal = ({ onClose, onCreate }) => {
    const [formData, setFormData] = useState({
        name: `Snapshot ${new Date().toLocaleDateString()}`,
        description: '',
        tag: ''
    });
    const [loading, setLoading] = useState(false);

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        try {
            await onCreate(formData);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Snapshot</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <Label>Snapshot Name *</Label>
                        <Input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <Label>Description</Label>
                        <Textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            placeholder="Optional description..."
                            rows={3}
                        />
                    </div>

                    <div className="form-group">
                        <Label>Tag</Label>
                        <Input
                            type="text"
                            name="tag"
                            value={formData.tag}
                            onChange={handleChange}
                            placeholder="e.g., v1.0.0, before-update"
                        />
                    </div>

                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Snapshot'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Plugins Tab
const PluginsTab = ({ siteId }) => {
    const toast = useToast();
    const [plugins, setPlugins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [updating, setUpdating] = useState(null); // plugin name being updated, or 'all'
    const [newPlugin, setNewPlugin] = useState('');
    const [toggling, setToggling] = useState(null); // plugin name being activated/deactivated

    useEffect(() => {
        loadPlugins();
    }, [siteId]);

    async function loadPlugins() {
        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.getPlugins(siteId);
            setPlugins(data.plugins || []);
        } catch (err) {
            console.error('Failed to load plugins:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleInstall(e) {
        e.preventDefault();
        if (!newPlugin.trim()) return;

        setInstalling(true);
        try {
            await wordpressApi.installPlugin(siteId, { slug: newPlugin.trim() });
            toast.success('Plugin installed successfully');
            setNewPlugin('');
            loadPlugins();
        } catch (err) {
            toast.error(err.message || 'Failed to install plugin');
        } finally {
            setInstalling(false);
        }
    }

    async function handleUpdate(pluginName) {
        setUpdating(pluginName || 'all');
        toast.info(pluginName ? `Updating ${pluginName}...` : 'Updating all plugins...', { duration: 4000 });
        try {
            const res = await wordpressApi.updatePlugins(siteId, pluginName ? [pluginName] : undefined);
            if (res.success === false) {
                toast.error(res.error || 'Plugin update failed');
                return;
            }
            toast.success(res.message || 'Plugins updated');
            loadPlugins();
        } catch (err) {
            toast.error(err.message || 'Plugin update failed');
        } finally {
            setUpdating(null);
        }
    }

    async function handleToggle(plugin) {
        const activating = plugin.status !== 'active';
        setToggling(plugin.name);
        try {
            const res = activating
                ? await wordpressApi.activatePlugin(siteId, plugin.name)
                : await wordpressApi.deactivatePlugin(siteId, plugin.name);
            if (res && res.success === false) {
                toast.error(res.error || `Failed to ${activating ? 'activate' : 'deactivate'} ${plugin.name}`);
                return;
            }
            toast.success(`${plugin.title || plugin.name} ${activating ? 'activated' : 'deactivated'}`);
            loadPlugins();
        } catch (err) {
            toast.error(err.message || `Failed to ${activating ? 'activate' : 'deactivate'} plugin`);
        } finally {
            setToggling(null);
        }
    }

    if (loading) {
        return (
            <div className="plugins-tab">
                <div className="section-header">
                    <div className="skeleton" style={{ width: 80, height: 24 }} />
                </div>
                <div className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 16 }} />
                <div className="plugins-list">
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load plugins"
                error={error}
                onRetry={loadPlugins}
            />
        );
    }

    return (
        <div className="plugins-tab">
            <div className="section-header">
                <h3>Plugins</h3>
            </div>

            <form className="install-form" onSubmit={handleInstall}>
                <Input
                    type="text"
                    value={newPlugin}
                    onChange={(e) => setNewPlugin(e.target.value)}
                    placeholder="Plugin slug (e.g., akismet, woocommerce)"
                />
                <Button type="submit" disabled={installing}>
                    {installing ? 'Installing...' : 'Install Plugin'}
                </Button>
            </form>

            {plugins.some(p => p.update === 'available') && (
                <div className="bulk-update-bar">
                    <span>{plugins.filter(p => p.update === 'available').length} plugin update(s) available</span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUpdate(null)}
                        disabled={updating !== null}
                    >
                        {updating === 'all' ? 'Updating...' : 'Update all'}
                    </Button>
                </div>
            )}

            {plugins.length === 0 ? (
                <EmptyState icon={Package} title="No plugins installed" description="Install a plugin by entering its slug above." />
            ) : (
                <div className="wp-asset-grid">
                    {plugins.map(plugin => {
                        const isActive = plugin.status === 'active';
                        return (
                            <div className={`wp-asset-card ${isActive ? 'is-active' : ''}`} key={plugin.name}>
                                <ServiceTile name={plugin.title || plugin.name} size={42} />
                                <div className="wp-asset-card__body">
                                    <div className="wp-asset-card__name">{plugin.title || plugin.name}</div>
                                    <div className="wp-asset-card__sub">{plugin.name}</div>
                                    <div className="wp-asset-card__foot">
                                        <span className="wp-asset-card__ver">v{plugin.version}</span>
                                        {plugin.update === 'available' && (
                                            <button
                                                type="button"
                                                className="wp-update-flag"
                                                onClick={() => handleUpdate(plugin.name)}
                                                disabled={updating !== null}
                                            >
                                                <Download size={11} />
                                                {updating === plugin.name ? 'Updating…' : `Update${plugin.update_version ? ` ${plugin.update_version}` : ''}`}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="wp-asset-card__toggle">
                                    <Switch
                                        checked={isActive}
                                        disabled={toggling === plugin.name}
                                        onCheckedChange={() => handleToggle(plugin)}
                                        aria-label={isActive ? `Deactivate ${plugin.name}` : `Activate ${plugin.name}`}
                                    />
                                    <span className={`wp-asset-card__state ${isActive ? 'is-on' : ''}`}>
                                        {isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// Themes Tab
const ThemesTab = ({ siteId }) => {
    const toast = useToast();
    const [themes, setThemes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [updating, setUpdating] = useState(null); // theme name being updated, or 'all'
    const [newTheme, setNewTheme] = useState('');
    const [activating, setActivating] = useState(null); // theme name being activated

    useEffect(() => {
        loadThemes();
    }, [siteId]);

    async function loadThemes() {
        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.getThemes(siteId);
            setThemes(data.themes || []);
        } catch (err) {
            console.error('Failed to load themes:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleInstall(e) {
        e.preventDefault();
        if (!newTheme.trim()) return;

        setInstalling(true);
        try {
            await wordpressApi.installTheme(siteId, { slug: newTheme.trim() });
            toast.success('Theme installed successfully');
            setNewTheme('');
            loadThemes();
        } catch (err) {
            toast.error(err.message || 'Failed to install theme');
        } finally {
            setInstalling(false);
        }
    }

    async function handleUpdate(themeName) {
        setUpdating(themeName || 'all');
        toast.info(themeName ? `Updating ${themeName}...` : 'Updating all themes...', { duration: 4000 });
        try {
            const res = await wordpressApi.updateThemes(siteId, themeName ? [themeName] : undefined);
            if (res.success === false) {
                toast.error(res.error || 'Theme update failed');
                return;
            }
            toast.success(res.message || 'Themes updated');
            loadThemes();
        } catch (err) {
            toast.error(err.message || 'Theme update failed');
        } finally {
            setUpdating(null);
        }
    }

    async function handleActivate(theme) {
        setActivating(theme.name);
        try {
            const res = await wordpressApi.activateTheme(siteId, theme.name);
            if (res && res.success === false) {
                toast.error(res.error || `Failed to activate ${theme.name}`);
                return;
            }
            toast.success(`${theme.title || theme.name} activated`);
            loadThemes();
        } catch (err) {
            toast.error(err.message || 'Failed to activate theme');
        } finally {
            setActivating(null);
        }
    }

    if (loading) {
        return (
            <div className="themes-tab">
                <div className="section-header">
                    <div className="skeleton" style={{ width: 80, height: 24 }} />
                </div>
                <div className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 16 }} />
                <div className="themes-list">
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load themes"
                error={error}
                onRetry={loadThemes}
            />
        );
    }

    return (
        <div className="themes-tab">
            <div className="section-header">
                <h3>Themes</h3>
            </div>

            <form className="install-form" onSubmit={handleInstall}>
                <Input
                    type="text"
                    value={newTheme}
                    onChange={(e) => setNewTheme(e.target.value)}
                    placeholder="Theme slug (e.g., twentytwentyfour)"
                />
                <Button type="submit" disabled={installing}>
                    {installing ? 'Installing...' : 'Install Theme'}
                </Button>
            </form>

            {themes.some(t => t.update === 'available') && (
                <div className="bulk-update-bar">
                    <span>{themes.filter(t => t.update === 'available').length} theme update(s) available</span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUpdate(null)}
                        disabled={updating !== null}
                    >
                        {updating === 'all' ? 'Updating...' : 'Update all'}
                    </Button>
                </div>
            )}

            {themes.length === 0 ? (
                <EmptyState icon={Palette} title="No themes installed" description="Install a theme by entering its slug above." />
            ) : (
                <div className="wp-theme-grid">
                    {themes.map(theme => {
                        const isActive = theme.status === 'active';
                        return (
                            <div className={`wp-theme-card ${isActive ? 'is-active' : ''}`} key={theme.name}>
                                <div className="wp-theme-card__shot">
                                    <Palette size={26} />
                                    {isActive && <Pill kind="green">Active</Pill>}
                                </div>
                                <div className="wp-theme-card__meta">
                                    <div className="wp-theme-card__name">{theme.title || theme.name}</div>
                                    <div className="wp-theme-card__sub">{theme.name} · v{theme.version}</div>
                                    <div className="wp-theme-card__actions">
                                        {isActive ? (
                                            <span className="wp-theme-card__current">Current theme</span>
                                        ) : (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleActivate(theme)}
                                                disabled={activating === theme.name}
                                            >
                                                {activating === theme.name ? 'Activating…' : 'Activate'}
                                            </Button>
                                        )}
                                        {theme.update === 'available' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleUpdate(theme.name)}
                                                disabled={updating !== null}
                                            >
                                                {updating === theme.name ? 'Updating…' : 'Update'}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// Git Tab
const GitTab = ({ siteId, site, onUpdate }) => {
    const toast = useToast();
    const [gitStatus, setGitStatus] = useState(null);
    const [commits, setCommits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadGitData();
    }, [siteId]);

    async function loadGitData() {
        setLoading(true);
        setError(null);
        try {
            const statusData = await wordpressApi.getGitStatus(siteId);
            setGitStatus(statusData);

            if (statusData.connected) {
                const commitsData = await wordpressApi.getCommits(siteId);
                setCommits(commitsData.commits || []);
            }
        } catch (err) {
            console.error('Failed to load git data:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleConnect(data) {
        await wordpressApi.connectRepo(siteId, data);
        toast.success('Repository connected');
        loadGitData();
        onUpdate?.();
    }

    async function handleDisconnect() {
        await wordpressApi.disconnectRepo(siteId);
        toast.success('Repository disconnected');
        loadGitData();
        onUpdate?.();
    }

    async function handleDeploy(data) {
        try {
            await wordpressApi.deployCommit(siteId, data);
            toast.success('Deployment completed');
            loadGitData();
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Deployment failed');
        }
    }

    async function handleCreateDev(data) {
        try {
            await wordpressApi.createDevFromCommit(siteId, data);
            toast.success('Development environment created');
        } catch (err) {
            toast.error(err.message || 'Failed to create environment');
        }
    }

    if (loading) {
        return (
            <div className="git-tab">
                <div className="git-connect git-connect--card">
                    <div className="skeleton" style={{ width: 200, height: 24, marginBottom: 16 }} />
                    <div className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 12 }} />
                    <div className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 12 }} />
                    <div className="skeleton" style={{ width: 140, height: 36, borderRadius: 6 }} />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load Git information"
                error={error}
                onRetry={loadGitData}
            />
        );
    }

    return (
        <div className="git-tab">
            <GitConnectForm
                gitStatus={gitStatus}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
            />

            {gitStatus?.connected && (
                <div className="git-commits-section">
                    <div className="section-header">
                        <h3>Recent Commits</h3>
                        <Button variant="outline" size="sm" onClick={loadGitData}>
                            <RefreshCw size={14} /> Refresh
                        </Button>
                    </div>

                    <CommitList
                        commits={commits}
                        currentCommit={site.last_deploy_commit}
                        onDeploy={handleDeploy}
                        onCreateDev={handleCreateDev}
                    />
                </div>
            )}
        </div>
    );
};

// Backups Tab
const BackupsTab = ({ siteId }) => {
    const toast = useToast();
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSnapshots();
    }, [siteId]);

    async function loadSnapshots() {
        try {
            const data = await wordpressApi.getSnapshots(siteId);
            // Filter for backup-tagged snapshots
            setSnapshots((data.snapshots || []).filter(s => s.tag?.includes('backup')));
        } catch (err) {
            console.error('Failed to load backups:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateBackup() {
        try {
            await wordpressApi.createSnapshot(siteId, {
                name: `Backup ${new Date().toISOString().split('T')[0]}`,
                tag: 'backup',
                description: 'Full site backup'
            });
            toast.success('Backup created');
            loadSnapshots();
        } catch (err) {
            toast.error(err.message || 'Failed to create backup');
        }
    }

    async function handleRestore(snapId) {
        try {
            await wordpressApi.restoreSnapshot(siteId, snapId);
            toast.success('Backup restored');
        } catch (err) {
            toast.error(err.message || 'Failed to restore backup');
        }
    }

    async function handleDelete(snapId) {
        try {
            await wordpressApi.deleteSnapshot(siteId, snapId);
            toast.success('Backup deleted');
            loadSnapshots();
        } catch (err) {
            toast.error(err.message || 'Failed to delete backup');
        }
    }

    return (
        <div className="backups-tab">
            <div className="section-header">
                <h3>Backups</h3>
                <Button onClick={handleCreateBackup}>
                    <Plus size={14} /> Create Backup
                </Button>
            </div>

            {snapshots.length === 0 && !loading ? (
                <EmptyState
                    icon={Archive}
                    title="No backups yet"
                    description="Create a backup to protect your site files and database."
                />
            ) : (
                <SnapshotTable
                    snapshots={snapshots}
                    loading={loading}
                    onRestore={handleRestore}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
};

export default WordPressDetail;
