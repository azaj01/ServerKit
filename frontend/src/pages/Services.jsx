import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { getServiceType, getStatusConfig, formatRelativeTime } from '../utils/serviceTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

const SERVICE_TYPE_OPTIONS = ['all', 'docker', 'flask', 'django', 'php', 'static', 'wordpress'];
const STATUS_OPTIONS = ['all', 'running', 'stopped'];
const SORT_OPTIONS = [
    { value: 'name-asc', label: 'Name A-Z' },
    { value: 'name-desc', label: 'Name Z-A' },
    { value: 'status', label: 'Status' },
    { value: 'type', label: 'Type' },
    { value: 'recent', label: 'Recently deployed' },
    { value: 'created', label: 'Recently created' },
];

const Services = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortBy, setSortBy] = useState('status');
    const [actionLoading, setActionLoading] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

    useEffect(() => {
        loadApps();
    }, []);

    async function loadApps() {
        try {
            const data = await api.getApps();
            setApps(data.apps || []);
        } catch (err) {
            toast.error('Failed to load services');
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(e, appId, action) {
        e.stopPropagation();
        setActionLoading(`${appId}-${action}`);
        try {
            if (action === 'start') await api.startApp(appId);
            else if (action === 'stop') await api.stopApp(appId);
            else if (action === 'restart') await api.restartApp(appId);
            await loadApps();
        } catch (err) {
            toast.error(`Failed to ${action} service`);
        } finally {
            setActionLoading(null);
        }
    }

    async function handleBulkAction(action) {
        if (selectedIds.size === 0) return;
        setBulkLoading(true);
        try {
            const promises = [...selectedIds].map(id => {
                if (action === 'start') return api.startApp(id);
                if (action === 'stop') return api.stopApp(id);
                if (action === 'restart') return api.restartApp(id);
                return Promise.resolve();
            });
            await Promise.allSettled(promises);
            toast.success(`${action} sent to ${selectedIds.size} service(s)`);
            setSelectedIds(new Set());
            await loadApps();
        } catch (err) {
            toast.error(`Bulk ${action} failed`);
        } finally {
            setBulkLoading(false);
        }
    }

    function toggleSelectAll() {
        if (selectedIds.size === filteredApps.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredApps.map(a => a.id)));
        }
    }

    const filteredApps = useMemo(() => {
        let result = apps.filter(app => {
            if (searchTerm && !app.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            if (typeFilter !== 'all' && app.app_type !== typeFilter) return false;
            if (statusFilter !== 'all' && (statusFilter === 'running' ? app.status !== 'running' : app.status === 'running')) return false;
            return true;
        });

        result.sort((a, b) => {
            switch (sortBy) {
                case 'name-asc': return a.name.localeCompare(b.name);
                case 'name-desc': return b.name.localeCompare(a.name);
                case 'status': {
                    const order = { running: 0, deploying: 1, building: 2, stopped: 3, failed: 4 };
                    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
                }
                case 'type': return (a.app_type || '').localeCompare(b.app_type || '');
                case 'recent': return new Date(b.last_deploy_at || 0) - new Date(a.last_deploy_at || 0);
                case 'created': return new Date(b.created_at || 0) - new Date(a.created_at || 0);
                default: return 0;
            }
        });

        return result;
    }, [apps, searchTerm, typeFilter, statusFilter, sortBy]);

    const stats = useMemo(() => {
        const running = apps.filter(a => a.status === 'running').length;
        const stopped = apps.filter(a => a.status !== 'running').length;
        const types = {};
        apps.forEach(a => { types[a.app_type] = (types[a.app_type] || 0) + 1; });
        const topType = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
        const recentDeploy = apps
            .filter(a => a.last_deploy_at)
            .sort((a, b) => new Date(b.last_deploy_at) - new Date(a.last_deploy_at))[0];

        return { total: apps.length, running, stopped, topType, recentDeploy };
    }, [apps]);

    if (loading) {
        return <div className="loading">Loading services...</div>;
    }

    return (
        <div className="page-container services-page">
            <div className="services-page__header">
                <div>
                    <h1>Services</h1>
                    <p className="services-page__subtitle">
                        {stats.total} services &middot; {stats.running} live
                    </p>
                </div>
                <Button asChild>
                    <Link to="/templates">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        New Service
                    </Link>
                </Button>
            </div>

            {/* Summary Cards */}
            {apps.length > 0 && (
                <div className="services-page__summary">
                    <div className="services-page__summary-card">
                        <div className="services-page__summary-icon services-page__summary-icon--live">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                            </svg>
                        </div>
                        <div className="services-page__summary-info">
                            <span className="services-page__summary-value">{stats.running}</span>
                            <span className="services-page__summary-label">Running</span>
                        </div>
                    </div>
                    <div className="services-page__summary-card">
                        <div className="services-page__summary-icon services-page__summary-icon--stopped">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="15" y1="9" x2="9" y2="15"/>
                                <line x1="9" y1="9" x2="15" y2="15"/>
                            </svg>
                        </div>
                        <div className="services-page__summary-info">
                            <span className="services-page__summary-value">{stats.stopped}</span>
                            <span className="services-page__summary-label">Stopped</span>
                        </div>
                    </div>
                    <div className="services-page__summary-card">
                        <div className="services-page__summary-icon services-page__summary-icon--type">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                            </svg>
                        </div>
                        <div className="services-page__summary-info">
                            <span className="services-page__summary-value">{stats.total}</span>
                            <span className="services-page__summary-label">
                                Total{stats.topType ? ` (${stats.topType[1]} ${stats.topType[0]})` : ''}
                            </span>
                        </div>
                    </div>
                    <div className="services-page__summary-card">
                        <div className="services-page__summary-icon services-page__summary-icon--deploy">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="23 4 23 10 17 10"/>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                        </div>
                        <div className="services-page__summary-info">
                            <span className="services-page__summary-value">
                                {stats.recentDeploy ? formatRelativeTime(stats.recentDeploy.last_deploy_at) : 'N/A'}
                            </span>
                            <span className="services-page__summary-label">
                                Last Deploy{stats.recentDeploy ? ` (${stats.recentDeploy.name})` : ''}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Filters + Sort */}
            <div className="services-page__filters">
                <div className="services-page__search">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <Input
                        type="text"
                        placeholder="Search services..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="services-page__filter-select"
                >
                    {SERVICE_TYPE_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>
                            {opt === 'all' ? 'All Types' : getServiceType(opt).label}
                        </option>
                    ))}
                </select>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="services-page__filter-select"
                >
                    {STATUS_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>
                            {opt === 'all' ? 'All Status' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                        </option>
                    ))}
                </select>
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="services-page__filter-select"
                >
                    {SORT_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>

            {/* Bulk Actions Bar */}
            {selectedIds.size > 0 && (
                <div className="services-page__bulk-bar">
                    <span>{selectedIds.size} selected</span>
                    <div className="services-page__bulk-actions">
                        <Button variant="outline" size="sm" onClick={() => handleBulkAction('restart')} disabled={bulkLoading}>
                            Restart All
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleBulkAction('stop')} disabled={bulkLoading}>
                            Stop All
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleBulkAction('start')} disabled={bulkLoading}>
                            Start All
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                            Clear
                        </Button>
                    </div>
                </div>
            )}

            {filteredApps.length === 0 ? (
                <div className="services-page__empty">
                    <div className="services-page__empty-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                        </svg>
                    </div>
                    <h3>No services found</h3>
                    <p>{searchTerm || typeFilter !== 'all' || statusFilter !== 'all'
                        ? 'Try adjusting your filters'
                        : 'Deploy your first service to get started'}</p>
                    {!searchTerm && typeFilter === 'all' && statusFilter === 'all' && (
                        <Button asChild>
                            <Link to="/templates">Create Service</Link>
                        </Button>
                    )}
                </div>
            ) : (
                <div className="services-page__list">
                    {/* List Header */}
                    <div className="services-page__list-header">
                        <div className="services-page__list-header-left">
                            <Checkbox
                                checked={selectedIds.size === filteredApps.length && filteredApps.length > 0}
                                onCheckedChange={toggleSelectAll}
                                className="services-page__checkbox"
                            />
                            <span>Service</span>
                        </div>
                        <div className="services-page__list-header-right">
                            <span>Status</span>
                            <span>Last Deploy</span>
                            <span>Actions</span>
                        </div>
                    </div>

                    {filteredApps.map(app => {
                        const typeInfo = getServiceType(app.app_type);
                        const statusInfo = getStatusConfig(app.status);
                        const isRunning = app.status === 'running';

                        return (
                            <div
                                key={app.id}
                                className={`services-page__row ${selectedIds.has(app.id) ? 'services-page__row--selected' : ''}`}
                                onClick={() => {
                                    if (app.app_type === 'wordpress') {
                                        navigate(`/wordpress/${app.id}`);
                                    } else {
                                        navigate(`/services/${app.id}`);
                                    }
                                }}
                            >
                                <div className="services-page__row-main">
                                    <Checkbox
                                        checked={selectedIds.has(app.id)}
                                        onCheckedChange={(checked) => {
                                            setSelectedIds(prev => {
                                                const next = new Set(prev);
                                                if (checked) next.add(app.id);
                                                else next.delete(app.id);
                                                return next;
                                            });
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="services-page__checkbox"
                                    />
                                    <div
                                        className="services-page__type-icon"
                                        style={{ backgroundColor: typeInfo.bgColor, color: typeInfo.color }}
                                    >
                                        <ServiceTypeIcon type={app.app_type} />
                                    </div>
                                    <div className="services-page__row-info">
                                        <div className="services-page__row-name">
                                            {app.name}
                                        </div>
                                        <div className="services-page__row-meta">
                                            <span
                                                className="services-page__type-badge"
                                                style={{ backgroundColor: typeInfo.bgColor, color: typeInfo.color, borderColor: typeInfo.borderColor }}
                                            >
                                                {typeInfo.label}
                                            </span>
                                            {app.domain && (
                                                <span className="services-page__domain">{app.domain}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="services-page__row-right">
                                    <div className={`services-page__status services-page__status--${statusInfo.dotClass}`}>
                                        <span className="services-page__status-dot" />
                                        {statusInfo.label}
                                    </div>

                                    {app.deploy_repo_url && (
                                        <div className="services-page__repo-pill">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="18" cy="18" r="3"/>
                                                <circle cx="6" cy="6" r="3"/>
                                                <path d="M6 21V9a9 9 0 0 0 9 9"/>
                                            </svg>
                                            {extractRepoName(app.deploy_repo_url)}
                                        </div>
                                    )}

                                    {app.last_deploy_at && (
                                        <span className="services-page__last-deploy">
                                            {formatRelativeTime(app.last_deploy_at)}
                                        </span>
                                    )}

                                    <div className="services-page__actions" onClick={e => e.stopPropagation()}>
                                        {isRunning ? (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => handleAction(e, app.id, 'restart')}
                                                    disabled={actionLoading === `${app.id}-restart`}
                                                    title="Restart"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <polyline points="23 4 23 10 17 10"/>
                                                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                                    </svg>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => handleAction(e, app.id, 'stop')}
                                                    disabled={actionLoading === `${app.id}-stop`}
                                                    title="Stop"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                        <rect x="6" y="6" width="12" height="12" rx="1"/>
                                                    </svg>
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={(e) => handleAction(e, app.id, 'start')}
                                                disabled={actionLoading === `${app.id}-start`}
                                                title="Start"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                                </svg>
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

function ServiceTypeIcon({ type }) {
    switch (type) {
        case 'docker':
            return (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z"/>
                </svg>
            );
        case 'flask':
        case 'django':
            return (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
            );
        case 'php':
            return <span className="text-xs font-bold">PHP</span>;
        case 'static':
            return (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                    <polyline points="13 2 13 9 20 9"/>
                </svg>
            );
        case 'wordpress':
            return (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2z"/>
                </svg>
            );
        default:
            return <span className="text-xs font-bold">{type?.charAt(0).toUpperCase()}</span>;
    }
}

function extractRepoName(url) {
    if (!url) return '';
    try {
        const cleaned = url.replace(/\.git$/, '');
        const parts = cleaned.split('/');
        return parts.slice(-2).join('/');
    } catch {
        return url;
    }
}

export default Services;
