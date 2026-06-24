import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layers, Plus, Square, Play, RotateCw, GitBranch, Github, FolderOpen, FileArchive, Search, FolderKanban } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { getServiceType, getStatusConfig, formatRelativeTime } from '../utils/serviceTypes';
import EmptyState from '../components/EmptyState';
import { Pill, SegControl, ServiceTile, EnvTag } from '@/components/ds';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';

const STATUS_PILL = { running: 'green', stopped: 'gray', deploying: 'amber', building: 'amber', failed: 'red' };

// Sentinels for the move-to-project Select (Radix forbids empty-string values).
const UNASSIGN = '__unassign__';
const NO_ENV = '__no_env__';

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
    const [showMoveDialog, setShowMoveDialog] = useState(false);

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
        return <EmptyState loading title="Loading services..." />;
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
                                <Button variant="outline" size="sm" onClick={() => setShowMoveDialog(true)} disabled={bulkLoading}>
                                    <FolderKanban size={14} />
                                    Move to project
                                </Button>
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
                                        <th>Project</th>
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
                                                    {app.project_name ? (
                                                        <span className="services-page__project">
                                                            <span className="services-page__project-name" title={app.project_name}>
                                                                <FolderKanban size={12} aria-hidden="true" />
                                                                {app.project_name}
                                                            </span>
                                                            {app.environment_name && (
                                                                <EnvTag env={app.environment_name}>{app.environment_name}</EnvTag>
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span className="services-page__unassigned">Unassigned</span>
                                                    )}
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

            <MoveToProjectDialog
                open={showMoveDialog}
                onOpenChange={setShowMoveDialog}
                count={selectedIds.size}
                onMove={async (projectId, environmentId) => {
                    setBulkLoading(true);
                    try {
                        await api.moveAppsToProject([...selectedIds], projectId, environmentId);
                        toast.success(
                            projectId === null
                                ? `Unassigned ${selectedIds.size} service(s)`
                                : `Moved ${selectedIds.size} service(s)`
                        );
                        setShowMoveDialog(false);
                        setSelectedIds(new Set());
                        await loadApps();
                    } catch (err) {
                        toast.error(err.message || 'Failed to move services');
                    } finally {
                        setBulkLoading(false);
                    }
                }}
            />
        </div>
    );
};

// Bulk "Move to project" modal: pick a project, then one of its environments
// (or leave unassigned). Loads the project list lazily on open; fetches the
// chosen project's environments on selection.
const MoveToProjectDialog = ({ open, onOpenChange, count, onMove }) => {
    const toast = useToast();
    const [projects, setProjects] = useState([]);
    const [environments, setEnvironments] = useState([]);
    const [projectValue, setProjectValue] = useState(UNASSIGN);
    const [envValue, setEnvValue] = useState(NO_ENV);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [loadingEnvs, setLoadingEnvs] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Reset selection each time the dialog opens.
        setProjectValue(UNASSIGN);
        setEnvValue(NO_ENV);
        setEnvironments([]);
        setLoadingProjects(true);
        api.getProjects()
            .then((data) => setProjects(Array.isArray(data?.projects) ? data.projects : []))
            .catch(() => toast.error('Failed to load projects'))
            .finally(() => setLoadingProjects(false));
    }, [open, toast]);

    async function handleProjectChange(value) {
        setProjectValue(value);
        setEnvValue(NO_ENV);
        setEnvironments([]);
        if (value === UNASSIGN) return;
        setLoadingEnvs(true);
        try {
            const data = await api.getProject(value);
            const envs = Array.isArray(data?.project?.environments) ? data.project.environments : [];
            setEnvironments(envs);
        } catch {
            toast.error('Failed to load environments');
        } finally {
            setLoadingEnvs(false);
        }
    }

    async function handleSubmit() {
        const projectId = projectValue === UNASSIGN ? null : Number(projectValue);
        const environmentId = envValue === NO_ENV ? null : Number(envValue);
        setSubmitting(true);
        try {
            await onMove(projectId, environmentId);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Move to project</DialogTitle>
                    <DialogDescription>
                        Assign {count} selected service{count === 1 ? '' : 's'} to a project and
                        environment, or leave them unassigned.
                    </DialogDescription>
                </DialogHeader>

                <div className="services-move">
                    <div className="services-move__field">
                        <Label htmlFor="move-project">Project</Label>
                        <Select value={projectValue} onValueChange={handleProjectChange} disabled={loadingProjects}>
                            <SelectTrigger id="move-project">
                                <SelectValue placeholder={loadingProjects ? 'Loading…' : 'Select a project'} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={UNASSIGN}>Unassigned</SelectItem>
                                {projects.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {projectValue !== UNASSIGN && (
                        <div className="services-move__field">
                            <Label htmlFor="move-env">Environment</Label>
                            <Select value={envValue} onValueChange={setEnvValue} disabled={loadingEnvs}>
                                <SelectTrigger id="move-env">
                                    <SelectValue placeholder={loadingEnvs ? 'Loading…' : 'No specific environment'} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_ENV}>No specific environment</SelectItem>
                                    {environments.map((e) => (
                                        <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={submitting || loadingProjects}>
                        {submitting ? 'Moving…' : (projectValue === UNASSIGN ? 'Unassign' : 'Move')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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
