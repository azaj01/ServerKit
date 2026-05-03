import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useService } from '../hooks/useService';
import { getTabsForType } from '../utils/serviceTypes';
import EnvironmentVariables from '../components/EnvironmentVariables';
import EventsTab from '../components/service-detail/EventsTab';
import LogsTab from '../components/service-detail/LogsTab';
import ShellTab from '../components/service-detail/ShellTab';
import SettingsTab from '../components/service-detail/SettingsTab';
import MetricsTab from '../components/service-detail/MetricsTab';
import PackagesTab from '../components/service-detail/PackagesTab';
import GunicornTab from '../components/service-detail/GunicornTab';
import CommandsTab from '../components/service-detail/CommandsTab';
import GitConnectModal from '../components/service-detail/GitConnectModal';
import OverviewTab from '../components/service-detail/OverviewTab';
import { Button } from '@/components/ui/button';

const TAB_LABELS = {
    overview: 'Overview',
    events: 'Events',
    logs: 'Logs',
    environment: 'Environment',
    shell: 'Shell',
    metrics: 'Metrics',
    packages: 'Packages',
    gunicorn: 'Gunicorn',
    commands: 'Commands',
    settings: 'Settings',
};

const ServiceDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const { service, deployConfig, loading, error, reload, performAction, deleteService } = useService(id);
    const [activeTab, setActiveTab] = useState('overview');
    const [showDeployMenu, setShowDeployMenu] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showGitModal, setShowGitModal] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);
    const deployMenuRef = useRef(null);
    const moreMenuRef = useRef(null);

    // Redirect WordPress apps
    useEffect(() => {
        if (service && service.app_type === 'wordpress') {
            navigate(`/wordpress/${id}`, { replace: true });
        }
    }, [service, id, navigate]);

    // Close menus on outside click
    useEffect(() => {
        const handleClick = (e) => {
            if (deployMenuRef.current && !deployMenuRef.current.contains(e.target)) {
                setShowDeployMenu(false);
            }
            if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
                setShowMoreMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    async function handleAction(action) {
        setActionLoading(action);
        try {
            await performAction(action);
            toast.success(`Service ${action}ed successfully`);
        } catch (err) {
            toast.error(`Failed to ${action} service`);
        } finally {
            setActionLoading(null);
            setShowDeployMenu(false);
            setShowMoreMenu(false);
        }
    }

    async function handleDeployLatest() {
        setActionLoading('deploy-latest');
        try {
            let hasBuildConfig = false;
            try {
                const buildConfig = await api.getBuildConfig(service.id);
                hasBuildConfig = Boolean(buildConfig.configured);
            } catch {
                hasBuildConfig = false;
            }

            if (hasBuildConfig) {
                await api.deployApp(service.id);
            } else {
                await api.triggerAppDeploy(service.id, true);
            }
            toast.success('Deployment started');
            await reload();
        } catch (err) {
            toast.error(err.message || 'Failed to deploy latest commit');
        } finally {
            setActionLoading(null);
            setShowDeployMenu(false);
        }
    }

    async function handleDelete() {
        const firstConfirm = await confirm({ title: 'Delete Service', message: `Delete ${service.name}? This action cannot be undone.` });
        if (!firstConfirm) return;
        const secondConfirm = await confirm({ title: 'Confirm Deletion', message: 'Are you sure? This will permanently remove the service and all its data.' });
        if (!secondConfirm) return;

        setActionLoading('delete');
        try {
            await deleteService();
            navigate('/services');
        } catch (err) {
            toast.error('Failed to delete service');
            setActionLoading(null);
        }
    }

    if (loading) {
        return <div className="loading">Loading service...</div>;
    }

    if (error || !service) {
        return (
            <div className="empty-state">
                <h3>Service not found</h3>
                <p>{error || 'The service you are looking for does not exist.'}</p>
                <Button onClick={() => navigate('/services')}>
                    Back to Services
                </Button>
            </div>
        );
    }

    const availableTabs = getTabsForType(service.app_type);

    return (
        <div className="page-container svc-detail">
            {/* Breadcrumb */}
            <div className="svc-detail__breadcrumb">
                <Link to="/services">Services</Link>
                <span className="svc-detail__breadcrumb-sep">/</span>
                <span className="svc-detail__breadcrumb-current">{service.name}</span>
            </div>

            {/* Header */}
            <div className="svc-detail__header">
                <div className="svc-detail__header-left">
                    <div
                        className="svc-detail__icon"
                        style={{ backgroundColor: service.typeInfo.bgColor, color: service.typeInfo.color }}
                    >
                        <ServiceIcon type={service.app_type} />
                    </div>
                    <div className="svc-detail__title-block">
                        <div className="svc-detail__title-row">
                            <h1>{service.name}</h1>
                            <span className={`svc-detail__status svc-detail__status--${service.statusInfo.dotClass}`}>
                                <span className="svc-detail__status-dot" />
                                {service.statusInfo.label}
                            </span>
                            <span
                                className="svc-detail__type-badge"
                                style={{ backgroundColor: service.typeInfo.bgColor, color: service.typeInfo.color, borderColor: service.typeInfo.borderColor }}
                            >
                                {service.typeInfo.label}
                            </span>
                        </div>
                        <div className="svc-detail__subtitle">
                            {service.port && <span className="mono">Port {service.port}</span>}
                            {service.port && <span className="svc-detail__sep">&middot;</span>}
                            <span>Created {new Date(service.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>

                <div className="svc-detail__header-actions">
                    {/* Deploy dropdown */}
                    <div className="svc-detail__dropdown" ref={deployMenuRef}>
                        <Button onClick={() => setShowDeployMenu(!showDeployMenu)}>
                            Deploy
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-1">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </Button>
                        {showDeployMenu && (
                            <div className="svc-detail__dropdown-menu">
                                <button onClick={() => handleAction('restart')} disabled={actionLoading === 'restart'}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="23 4 23 10 17 10"/>
                                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                    </svg>
                                    Manual Deploy (Restart)
                                </button>
                                {deployConfig && (
                                    <button onClick={handleDeployLatest} disabled={actionLoading === 'deploy-latest'}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="18" cy="18" r="3"/>
                                            <circle cx="6" cy="6" r="3"/>
                                            <path d="M6 21V9a9 9 0 0 0 9 9"/>
                                        </svg>
                                        {actionLoading === 'deploy-latest' ? 'Deploying...' : 'Deploy Latest Commit'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Restart button */}
                    {service.isRunning && (
                        <Button
                            variant="outline"
                            onClick={() => handleAction('restart')}
                            disabled={actionLoading === 'restart'}
                        >
                            {actionLoading === 'restart' ? 'Restarting...' : 'Restart'}
                        </Button>
                    )}

                    {/* Start/Stop */}
                    {!service.isRunning && (
                        <Button
                            variant="outline"
                            onClick={() => handleAction('start')}
                            disabled={actionLoading === 'start'}
                        >
                            {actionLoading === 'start' ? 'Starting...' : 'Start'}
                        </Button>
                    )}

                    {/* Three-dot menu */}
                    <div className="svc-detail__dropdown" ref={moreMenuRef}>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowMoreMenu(!showMoreMenu)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="5" r="2"/>
                                <circle cx="12" cy="12" r="2"/>
                                <circle cx="12" cy="19" r="2"/>
                            </svg>
                        </Button>
                        {showMoreMenu && (
                            <div className="svc-detail__dropdown-menu svc-detail__dropdown-menu--right">
                                {service.isRunning && (
                                    <button onClick={() => handleAction('stop')} disabled={actionLoading === 'stop'}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                            <rect x="6" y="6" width="12" height="12"/>
                                        </svg>
                                        Suspend Service
                                    </button>
                                )}
                                {service.port && (
                                    <a
                                        href={`http://localhost:${service.port}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => setShowMoreMenu(false)}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                            <polyline points="15 3 21 3 21 9"/>
                                            <line x1="10" y1="14" x2="21" y2="3"/>
                                        </svg>
                                        Open in Browser
                                    </a>
                                )}
                                <div className="svc-detail__dropdown-divider" />
                                <button
                                    className="svc-detail__dropdown-danger"
                                    onClick={handleDelete}
                                    disabled={actionLoading === 'delete'}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="3 6 5 6 21 6"/>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    </svg>
                                    Delete Service
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Repo Connection Pill */}
            <div className="svc-detail__repo-bar">
                {deployConfig ? (
                    <div className="svc-detail__repo-pill" onClick={() => setShowGitModal(true)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="18" cy="18" r="3"/>
                            <circle cx="6" cy="6" r="3"/>
                            <path d="M6 21V9a9 9 0 0 0 9 9"/>
                        </svg>
                        <span className="svc-detail__repo-url">{extractRepoDisplay(deployConfig.repo_url)}</span>
                        <span className="svc-detail__repo-arrow">&rarr;</span>
                        <span className="svc-detail__repo-branch">{deployConfig.branch || 'main'}</span>
                        {deployConfig.auto_deploy && (
                            <span className="svc-detail__auto-deploy-badge">Auto</span>
                        )}
                    </div>
                ) : (
                    <button className="svc-detail__connect-repo" onClick={() => setShowGitModal(true)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="18" cy="18" r="3"/>
                            <circle cx="6" cy="6" r="3"/>
                            <path d="M6 21V9a9 9 0 0 0 9 9"/>
                        </svg>
                        Connect a repository
                    </button>
                )}
            </div>

            {/* Tab Bar */}
            <div className="svc-detail__tabs">
                {availableTabs.map(tab => (
                    <button
                        key={tab}
                        className={`svc-detail__tab ${activeTab === tab ? 'svc-detail__tab--active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        {TAB_LABELS[tab] || tab}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="svc-detail__content">
                {activeTab === 'overview' && <OverviewTab app={service} deployConfig={deployConfig} />}
                {activeTab === 'events' && <EventsTab appId={service.id} />}
                {activeTab === 'logs' && <LogsTab app={service} />}
                {activeTab === 'environment' && <EnvironmentVariables appId={service.id} />}
                {activeTab === 'shell' && service.isDocker && <ShellTab appId={service.id} appName={service.name} />}
                {activeTab === 'metrics' && <MetricsTab app={service} />}
                {activeTab === 'packages' && service.isPython && <PackagesTab appId={service.id} />}
                {activeTab === 'gunicorn' && service.isPython && <GunicornTab appId={service.id} />}
                {activeTab === 'commands' && service.isPython && <CommandsTab appId={service.id} appType={service.app_type} />}
                {activeTab === 'settings' && (
                    <SettingsTab
                        app={service}
                        deployConfig={deployConfig}
                        onUpdate={reload}
                        onOpenGitModal={() => setShowGitModal(true)}
                    />
                )}
            </div>

            {/* Git Connect Modal */}
            {showGitModal && (
                <GitConnectModal
                    appId={service.id}
                    deployConfig={deployConfig}
                    onClose={() => setShowGitModal(false)}
                    onSaved={() => {
                        setShowGitModal(false);
                        reload();
                    }}
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

function ServiceIcon({ type }) {
    switch (type) {
        case 'docker':
            return (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z"/>
                </svg>
            );
        case 'flask':
        case 'django':
            return (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
            );
        default:
            return <span className="text-lg font-bold">{type?.charAt(0).toUpperCase()}</span>;
    }
}

function extractRepoDisplay(url) {
    if (!url) return '';
    try {
        const cleaned = url.replace(/\.git$/, '').replace(/^https?:\/\/[^@]+@/, 'https://');
        const parts = cleaned.split(/[/:]/).filter(Boolean);
        return parts.slice(-2).join('/');
    } catch {
        return url;
    }
}

export default ServiceDetail;
