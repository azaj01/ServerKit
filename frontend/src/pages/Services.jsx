import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layers, Plus, Square, Play, RotateCw, GitBranch, Github, FolderOpen, FileArchive, Search } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { getServiceType, getStatusConfig, formatRelativeTime } from '../utils/serviceTypes';
import EmptyState from '../components/EmptyState';
import { Pill, SegControl, ServiceTile } from '@/components/ds';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

const STATUS_PILL = { running: 'green', stopped: 'gray', deploying: 'amber', building: 'amber', failed: 'red' };

const Services = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
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

    const filteredApps = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return apps
            .filter(app => {
                if (statusFilter !== 'all' && (statusFilter === 'running' ? app.status !== 'running' : app.status === 'running')) return false;
                if (q && !app.name.toLowerCase().includes(q)) return false;
                return true;
            })
            .sort((a, b) => {
                const order = { running: 0, deploying: 1, building: 2, stopped: 3, failed: 4 };
                return (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.name.localeCompare(b.name);
            });
    }, [apps, searchTerm, statusFilter]);

    const runningCount = useMemo(() => apps.filter(a => a.status === 'running').length, [apps]);

    useTopbarActions(() =>
        <Button size="sm" asChild>
            <Link to="/services/new">
                <Plus size={16} />
                New Service
            </Link>
        </Button>,
        []
    );

    if (loading) {
        return <div className="loading">Loading services...</div>;
    }

    return (
        <div className="sk-tabgroup__inner services-page">
            {apps.length === 0 ? (
                <EmptyState
                    size="lg"
                    icon={Layers}
                    title="No services found"
                    description="Connect a repository or install a template to get started"
                    action={
                        <Button asChild>
                            <Link to="/services/new">Create Service</Link>
                        </Button>
                    }
                />
            ) : (
                <div className="wp-list">
                    {/* Toolbar — same layout as the WordPress list page: status tabs on the left, search on the right. */}
                    <div className="wp-list__toolbar">
                        <SegControl
                            value={statusFilter}
                            onChange={setStatusFilter}
                            options={[
                                { value: 'all', label: 'All', count: apps.length },
                                { value: 'running', label: 'Running', count: runningCount },
                                { value: 'stopped', label: 'Stopped', count: apps.length - runningCount },
                            ]}
                        />
                        <div className="wp-list__search">
                            <Search size={15} aria-hidden="true" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                placeholder="Search services…"
                                aria-label="Search services"
                            />
                        </div>
                    </div>

                    {/* Bulk Actions Bar */}
                    {selectedIds.size > 0 && (
                        <div className="wp-list__bulkbar">
                            <span className="wp-list__bulkcount">{selectedIds.size} selected</span>
                            <div className="wp-list__bulkactions">
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
                        <EmptyState
                            icon={Layers}
                            title="No services found"
                            description="Try adjusting your search or filter"
                        />
                    ) : (
                        <div className="wp-list__card">
                            <table className="sk-dtable">
                                <thead>
                                    <tr>
                                        <th className="wp-list__ck">
                                            <Checkbox
                                                checked={filteredApps.length > 0 && filteredApps.every(a => selectedIds.has(a.id))}
                                                onCheckedChange={(checked) => {
                                                    setSelectedIds(checked ? new Set(filteredApps.map(a => a.id)) : new Set());
                                                }}
                                                aria-label="Select all services"
                                            />
                                        </th>
                                        <th>Service</th>
                                        <th>Source</th>
                                        <th>Domain</th>
                                        <th>Status</th>
                                        <th>Last Deploy</th>
                                        <th style={{ width: 70 }} />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredApps.map(app => {
                                        const typeInfo = getServiceType(app.app_type);
                                        const statusInfo = getStatusConfig(app.status);
                                        const isRunning = app.status === 'running';
                                        const isGithub = (app.deploy_repo_url || '').includes('github.com');
                                        const primaryDomain = (app.domains?.find(d => d.is_primary) || app.domains?.[0])?.name || '';

                                        return (
                                            <tr
                                                key={app.id}
                                                className={`is-clickable ${selectedIds.has(app.id) ? 'is-selected' : ''}`}
                                                onClick={() => {
                                                    if (app.app_type === 'wordpress') {
                                                        navigate(`/wordpress/${app.id}`);
                                                    } else {
                                                        navigate(`/services/${app.id}`);
                                                    }
                                                }}
                                            >
                                                <td className="wp-list__ck" onClick={(e) => e.stopPropagation()}>
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
                                                        aria-label={`Select ${app.name}`}
                                                    />
                                                </td>
                                                <td>
                                                    <div className="sk-cell-name">
                                                        <ServiceTile
                                                            name={app.name}
                                                            size={30}
                                                            className="wp-list__tile"
                                                            aria-hidden="true"
                                                        />
                                                        <span>
                                                            <div>{app.name}</div>
                                                            <div className="sk-cell-sub">{typeInfo.label}</div>
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    {app.deploy_repo_url ? (
                                                        <span className="services-page__src-badge" title={app.deploy_repo_url}>
                                                            {isGithub ? <Github size={12} /> : <GitBranch size={12} />}
                                                            {extractRepoName(app.deploy_repo_url)}
                                                        </span>
                                                    ) : app.source === 'manual' ? (
                                                        <span className="services-page__src-badge services-page__src-badge--manual" title={app.root_path || ''}>
                                                            <FolderOpen size={12} />
                                                            Local
                                                        </span>
                                                    ) : app.source === 'upload' ? (
                                                        <span className="services-page__src-badge services-page__src-badge--upload" title={app.upload_path || ''}>
                                                            <FileArchive size={12} />
                                                            Upload v{app.version || 1}
                                                        </span>
                                                    ) : (
                                                        <span className="wp-list__dash">—</span>
                                                    )}
                                                </td>
                                                <td className="sk-cell-mono">{primaryDomain || <span className="wp-list__dash">—</span>}</td>
                                                <td><Pill kind={STATUS_PILL[app.status] || 'gray'}>{statusInfo.label}</Pill></td>
                                                <td className="sk-cell-mono">
                                                    {app.last_deploy_at ? formatRelativeTime(app.last_deploy_at) : <span className="wp-list__dash">—</span>}
                                                </td>
                                                <td onClick={(e) => e.stopPropagation()}>
                                                    <div className="services-page__actions">
                                                        {isRunning ? (
                                                            <>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={(e) => handleAction(e, app.id, 'restart')}
                                                                    disabled={actionLoading === `${app.id}-restart`}
                                                                    title="Restart"
                                                                >
                                                                    <RotateCw size={14} />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={(e) => handleAction(e, app.id, 'stop')}
                                                                    disabled={actionLoading === `${app.id}-stop`}
                                                                    title="Stop"
                                                                >
                                                                    <Square size={14} />
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
                                                                <Play size={14} />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

function extractRepoName(url) {
    if (!url) return '';
    try {
        const cleaned = url.replace(/\.git$/, '').replace(/^https?:\/\/[^@]+@/, 'https://');
        const parts = cleaned.split(/[/:]/).filter(Boolean);
        return parts.slice(-2).join('/');
    } catch {
        return url;
    }
}

export default Services;
