import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    Activity,
    CheckCircle2,
    XCircle,
    Clock,
    RefreshCw,
    Server,
    Loader2,
    AlertTriangle,
    GitBranch,
    PlayCircle,
} from 'lucide-react';
import api from '../services/api';
import { Button } from '@/components/ui/button';

const STATUS_COLORS = {
    pending: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8', icon: Clock },
    running: { bg: 'rgba(99,102,241,0.15)', fg: '#6366f1', icon: Loader2 },
    succeeded: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', icon: CheckCircle2 },
    failed: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', icon: XCircle },
};

const formatDuration = (seconds) => {
    if (seconds == null) return '—';
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
};

const formatTime = (iso) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
};

const StatusBadge = ({ status }) => {
    const cfg = STATUS_COLORS[status] || STATUS_COLORS.pending;
    const Icon = cfg.icon;
    const spin = status === 'running';
    return (
        <span className="deployments-page__status-badge" style={{ background: cfg.bg, color: cfg.fg }}>
            <Icon size={14} className={spin ? 'deployments-page__spin' : ''} />
            {status}
        </span>
    );
};

const Deployments = () => {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [serverFilter, setServerFilter] = useState('all');
    const [servers, setServers] = useState([]);
    const [selectedJob, setSelectedJob] = useState(null);
    const [jobDetail, setJobDetail] = useState(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const refreshRef = useRef(null);
    const detailRef = useRef(null);

    const loadJobs = async () => {
        try {
            const params = {};
            if (statusFilter !== 'all') params.status = statusFilter;
            if (serverFilter !== 'all') params.serverId = serverFilter;
            const data = await api.getDeploymentJobs(params);
            setJobs(data.jobs || []);
        } catch (err) {
            console.error('Failed to load deployment jobs', err);
        } finally {
            setLoading(false);
        }
    };

    const loadServers = async () => {
        try {
            const data = await api.getAvailableServers();
            setServers(Array.isArray(data) ? data : []);
        } catch {
            setServers([]);
        }
    };

    const loadJobDetail = async (jobId) => {
        if (!jobId) return;
        try {
            const data = await api.getDeploymentJob(jobId, true);
            setJobDetail(data.job || null);
        } catch (err) {
            console.error('Failed to load deployment job detail', err);
        }
    };

    useEffect(() => {
        loadServers();
    }, []);

    useEffect(() => {
        loadJobs();
    }, [statusFilter, serverFilter]);

    useEffect(() => {
        if (refreshRef.current) clearInterval(refreshRef.current);
        if (!autoRefresh) return undefined;
        refreshRef.current = setInterval(() => {
            loadJobs();
            if (selectedJob) loadJobDetail(selectedJob);
        }, 3000);
        return () => clearInterval(refreshRef.current);
    }, [autoRefresh, selectedJob, statusFilter, serverFilter]);

    useEffect(() => {
        if (selectedJob) loadJobDetail(selectedJob);
        else setJobDetail(null);
    }, [selectedJob]);

    useEffect(() => {
        if (detailRef.current) {
            detailRef.current.scrollTop = detailRef.current.scrollHeight;
        }
    }, [jobDetail?.logs?.length]);

    const summary = useMemo(() => {
        const counts = { running: 0, succeeded: 0, failed: 0, pending: 0 };
        jobs.forEach((j) => {
            counts[j.status] = (counts[j.status] || 0) + 1;
        });
        return counts;
    }, [jobs]);

    return (
        <div className="page-container deployments-page">
            <div className="page-header deployments-page__header">
                <div className="deployments-page__heading">
                    <h1 className="page-title">
                        <Activity size={22} />
                        Deployment Activity
                    </h1>
                    <p className="deployments-page__description">
                        Track install and deploy jobs across services and servers with status, progress, and logs.
                    </p>
                </div>
                <div className="deployments-page__actions">
                    <Button variant="outline" asChild>
                        <Link to="/services/new">
                            <GitBranch size={16} />
                            New Service
                        </Link>
                    </Button>
                    <Button
                        variant={autoRefresh ? 'default' : 'outline'}
                        onClick={() => setAutoRefresh((v) => !v)}
                        title="Auto-refresh every 3s"
                    >
                        <RefreshCw size={16} className={autoRefresh ? 'spin' : ''} />
                        {autoRefresh ? 'Live' : 'Paused'}
                    </Button>
                    <Button variant="outline" onClick={loadJobs}>
                        <RefreshCw size={16} /> Refresh
                    </Button>
                </div>
            </div>

            <div className="deployments-page__summary">
                {[
                    { label: 'Running', value: summary.running, icon: Loader2, color: '#6366f1' },
                    { label: 'Succeeded', value: summary.succeeded, icon: CheckCircle2, color: '#22c55e' },
                    { label: 'Failed', value: summary.failed, icon: XCircle, color: '#ef4444' },
                    { label: 'Pending', value: summary.pending, icon: Clock, color: '#94a3b8' },
                ].map((s) => {
                    const Icon = s.icon;
                    return (
                        <div key={s.label} className="deployments-page__stat-card">
                            <Icon size={18} style={{ color: s.color }} />
                            <div>
                                <div className="deployments-page__stat-label">{s.label}</div>
                                <div className="deployments-page__stat-value">{s.value}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="deployments-page__toolbar">
                <div className="deployments-page__filter">
                    <label>Status</label>
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="all">All</option>
                        <option value="pending">Pending</option>
                        <option value="running">Running</option>
                        <option value="succeeded">Succeeded</option>
                        <option value="failed">Failed</option>
                    </select>
                </div>
                <div className="deployments-page__filter">
                    <label>Target server</label>
                    <select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
                        <option value="all">All servers</option>
                        {servers.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name}{s.is_local ? ' (local)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="deployments-page__workspace">
                <div className="deployments-page__panel deployments-page__jobs-panel">
                    <div className="deployments-page__panel-header">
                        <div>
                            <h2>Jobs</h2>
                            <span>{jobs.length} visible</span>
                        </div>
                    </div>
                    {loading ? (
                        <div className="deployments-page__empty">Loading...</div>
                    ) : jobs.length === 0 ? (
                        <div className="deployments-page__empty">
                            <PlayCircle size={34} />
                            <strong>No deployment jobs yet</strong>
                            <span>
                                Create a service from a repository or install a template to see activity here.
                            </span>
                        </div>
                    ) : (
                        <table className="deployments-page__jobs-table">
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Kind</th>
                                    <th>Target</th>
                                    <th>App</th>
                                    <th>Progress</th>
                                    <th>Started</th>
                                </tr>
                            </thead>
                            <tbody>
                                {jobs.map((job) => (
                                    <tr
                                        key={job.id}
                                        onClick={() => setSelectedJob(job.id)}
                                        className={selectedJob === job.id ? 'is-selected' : ''}
                                    >
                                        <td><StatusBadge status={job.status} /></td>
                                        <td>{job.kind}</td>
                                        <td>
                                            <span className="deployments-page__server-cell">
                                                <Server size={12} />
                                                {job.target_server_name || 'Local server'}
                                            </span>
                                        </td>
                                        <td>{job.app_name || '—'}</td>
                                        <td>
                                            <div className="deployments-page__progress">
                                                <div
                                                    style={{
                                                        width: `${job.progress_percent || 0}%`,
                                                        background:
                                                            job.status === 'failed' ? '#ef4444' : 'var(--accent-primary)',
                                                    }}
                                                />
                                            </div>
                                            <div className="deployments-page__progress-meta">
                                                {job.current_step || 0}/{job.total_steps || 0}
                                            </div>
                                        </td>
                                        <td className="deployments-page__time-cell">{formatTime(job.started_at || job.created_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="deployments-page__panel deployments-page__detail-panel">
                    <div className="deployments-page__panel-header">
                        <div>
                            <h2>Details</h2>
                            <span>Plan and logs</span>
                        </div>
                    </div>
                    {!selectedJob ? (
                        <div className="deployments-page__empty">
                            <Activity size={34} />
                            <strong>No job selected</strong>
                            Select a job to view its plan and logs.
                        </div>
                    ) : !jobDetail ? (
                        <div className="deployments-page__empty">Loading...</div>
                    ) : (
                        <div className="deployments-page__detail-content">
                            <div className="deployments-page__detail-title">
                                <div>
                                    <h3>{jobDetail.app_name || jobDetail.kind}</h3>
                                    <div>
                                        {jobDetail.id}
                                    </div>
                                </div>
                                <StatusBadge status={jobDetail.status} />
                            </div>

                            <div className="deployments-page__detail-grid">
                                <div className="deployments-page__detail-metric">
                                    <span>Target</span>
                                    <div>{jobDetail.target_server_name}</div>
                                </div>
                                <div className="deployments-page__detail-metric">
                                    <span>Step</span>
                                    <div>{jobDetail.current_step || 0} / {jobDetail.total_steps || 0}</div>
                                </div>
                                <div className="deployments-page__detail-metric">
                                    <span>Duration</span>
                                    <div>{formatDuration(jobDetail.duration)}</div>
                                </div>
                                <div className="deployments-page__detail-metric">
                                    <span>Started</span>
                                    <div>{formatTime(jobDetail.started_at)}</div>
                                </div>
                            </div>

                            {jobDetail.current_step_name && jobDetail.status === 'running' && (
                                <div className="deployments-page__notice deployments-page__notice--running">
                                    <Loader2 size={14} className="deployments-page__spin" />
                                    {jobDetail.current_step_name}
                                </div>
                            )}

                            {jobDetail.error_message && (
                                <div className="deployments-page__notice deployments-page__notice--error">
                                    <AlertTriangle size={14} />
                                    {jobDetail.error_message}
                                </div>
                            )}

                            <h4 className="deployments-page__logs-title">Logs</h4>
                            <div
                                ref={detailRef}
                                className="deployments-page__logs"
                            >
                                {(jobDetail.logs || []).length === 0
                                    ? 'Waiting for logs…'
                                    : jobDetail.logs.map((log) => {
                                        const ts = log.created_at ? new Date(log.created_at).toLocaleTimeString() : '';
                                        const stepPrefix = log.step_index ? `[${log.step_index}] ` : '';
                                        const color =
                                            log.level === 'error'
                                                ? '#fca5a5'
                                                : log.level === 'debug'
                                                ? '#94a3b8'
                                                : '#cbd5e1';
                                        return (
                                            <div key={log.id} style={{ color }}>
                                                <span className="deployments-page__log-time">{ts}</span>{' '}
                                                <span className="deployments-page__log-level">{log.level.toUpperCase()}</span>{' '}
                                                {stepPrefix}{log.message}
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Deployments;
