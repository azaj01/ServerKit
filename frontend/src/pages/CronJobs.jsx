import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatCard, StatsGrid } from '../components/StatCard';
import { Clock, FileText, CheckCircle, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

const CronJobs = () => {
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const [status, setStatus] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [presets, setPresets] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Modal states
    const [showJobModal, setShowJobModal] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [runningJobId, setRunningJobId] = useState(null);
    const [runOutput, setRunOutput] = useState(null);

    // Form state
    const [jobForm, setJobForm] = useState({
        name: '',
        command: '',
        schedule: '',
        description: '',
        usePreset: true,
        preset: 'daily'
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [statusRes, jobsRes, presetsRes] = await Promise.all([
                api.getCronStatus(),
                api.getCronJobs(),
                api.getCronPresets()
            ]);

            setStatus(statusRes);
            setJobs(jobsRes.jobs || []);
            setPresets(presetsRes.presets || {});
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const openCreateModal = () => {
        setEditingJob(null);
        resetForm();
        setShowJobModal(true);
    };

    const openEditModal = (job) => {
        setEditingJob(job);
        const presetKey = Object.entries(presets).find(([, v]) => v === job.schedule)?.[0];
        setJobForm({
            name: job.name || '',
            command: job.command || '',
            schedule: job.schedule || '',
            description: job.description || '',
            usePreset: !!presetKey,
            preset: presetKey || 'daily'
        });
        setShowJobModal(true);
    };

    const closeJobModal = () => {
        setShowJobModal(false);
        setEditingJob(null);
        resetForm();
    };

    const handleSubmitJob = async (e) => {
        e.preventDefault();
        try {
            const schedule = jobForm.usePreset
                ? presets[jobForm.preset]
                : jobForm.schedule;

            const payload = {
                name: jobForm.name,
                command: jobForm.command,
                schedule: schedule,
                description: jobForm.description
            };

            if (editingJob) {
                await api.updateCronJob(editingJob.id, payload);
                toast.success('Cron job updated successfully');
            } else {
                await api.createCronJob(payload);
                toast.success('Cron job created successfully');
            }

            closeJobModal();
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteJob = async (jobId) => {
        const confirmed = await confirm({ title: 'Delete Cron Job', message: 'Are you sure you want to delete this cron job?' });
        if (!confirmed) return;
        try {
            await api.deleteCronJob(jobId);
            toast.success('Cron job deleted');
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleToggleJob = async (jobId, currentEnabled) => {
        try {
            await api.toggleCronJob(jobId, !currentEnabled);
            toast.success(`Cron job ${!currentEnabled ? 'enabled' : 'disabled'}`);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRunJob = async (jobId) => {
        try {
            setRunningJobId(jobId);
            const result = await api.runCronJob(jobId);
            if (result.success) {
                setRunOutput({
                    jobId,
                    jobName: jobs.find(j => j.id === jobId)?.name || jobId,
                    exitCode: result.exit_code,
                    stdout: result.stdout,
                    stderr: result.stderr
                });
            } else {
                toast.error(result.error || 'Job execution failed');
            }
        } catch (err) {
            toast.error(err.message);
        } finally {
            setRunningJobId(null);
        }
    };

    const resetForm = () => {
        setJobForm({
            name: '',
            command: '',
            schedule: '',
            description: '',
            usePreset: true,
            preset: 'daily'
        });
    };

    const getScheduleDescription = (schedule) => {
        const descriptions = {
            '* * * * *': 'Every minute',
            '0 * * * *': 'Every hour',
            '0 0 * * *': 'Daily at midnight',
            '0 0 * * 0': 'Weekly on Sunday',
            '0 0 1 * *': 'Monthly on the 1st',
            '0 0 * * 1-5': 'Weekdays at midnight',
            '0 */6 * * *': 'Every 6 hours',
            '0 */12 * * *': 'Every 12 hours',
            '*/5 * * * *': 'Every 5 minutes',
            '*/15 * * * *': 'Every 15 minutes',
            '*/30 * * * *': 'Every 30 minutes'
        };
        return descriptions[schedule] || schedule;
    };

    if (loading) {
        return <div className="page"><div className="loading">Loading cron jobs...</div></div>;
    }

    return (
        <div className="page-container cron-page">
            <div className="page-header">
                <div>
                    <h1>Cron Jobs</h1>
                    <p className="page-subtitle">Manage scheduled tasks and automated jobs</p>
                </div>
                <div className="page-header-actions">
                    <Button variant="outline" onClick={loadData}>
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                        Refresh
                    </Button>
                    <Button onClick={openCreateModal}>
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Create Job
                    </Button>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            {/* Status Cards */}
            <StatsGrid>
                <StatCard icon={Clock} iconVariant="cron" label="Cron Service" value={status?.available ? 'Available' : 'Not Available'} />
                <StatCard icon={FileText} iconVariant="jobs" label="Total Jobs" value={jobs.length} />
                <StatCard icon={CheckCircle} iconVariant="active" label="Active Jobs" value={jobs.filter(j => j.enabled).length} />
                <StatCard icon={Monitor} iconVariant="platform" label="Platform" value={status?.platform || 'Unknown'} />
            </StatsGrid>

            {/* Jobs List */}
            <div className="card">
                <div className="card-header">
                    <h3>Scheduled Jobs</h3>
                </div>
                <div className="card-body">
                    {jobs.length === 0 ? (
                        <div className="empty-state">
                            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            <h3>No Cron Jobs</h3>
                            <p>No scheduled jobs found. Create your first cron job to automate tasks.</p>
                            <Button onClick={openCreateModal}>
                                Create Job
                            </Button>
                        </div>
                    ) : (
                        <div className="cron-list">
                            {jobs.map((job) => (
                                <div
                                    key={job.id}
                                    className={`cron-item ${!job.enabled ? 'disabled' : ''}`}
                                    onClick={() => openEditModal(job)}
                                >
                                    <div className="cron-item-info">
                                        <div className="cron-item-icon">
                                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                                <circle cx="12" cy="12" r="10"/>
                                                <polyline points="12 6 12 12 16 14"/>
                                            </svg>
                                        </div>
                                        <div className="cron-item-details">
                                            <h3>{job.name || 'Unnamed Job'}</h3>
                                            <div className="cron-item-meta">
                                                <span className="mono" title={job.schedule}>
                                                    {getScheduleDescription(job.schedule)}
                                                </span>
                                                {job.description && (
                                                    <span className="description">{job.description}</span>
                                                )}
                                            </div>
                                            <div className="cron-item-command">
                                                <code>{job.command}</code>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="cron-item-status">
                                        <Badge variant={job.enabled ? 'success' : 'secondary'}>
                                            {job.enabled ? 'Active' : 'Disabled'}
                                        </Badge>
                                    </div>

                                    <div className="cron-item-actions" onClick={e => e.stopPropagation()}>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleRunJob(job.id)}
                                            disabled={runningJobId === job.id}
                                            title="Run now"
                                        >
                                            {runningJobId === job.id ? (
                                                <span className="spinner-inline"></span>
                                            ) : (
                                                <svg viewBox="0 0 24 24" width="14" height="14">
                                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                                </svg>
                                            )}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => openEditModal(job)}
                                            title="Edit"
                                        >
                                            <svg viewBox="0 0 24 24" width="14" height="14">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                            </svg>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleToggleJob(job.id, job.enabled)}
                                            title={job.enabled ? 'Disable' : 'Enable'}
                                        >
                                            {job.enabled ? (
                                                <svg viewBox="0 0 24 24" width="14" height="14">
                                                    <rect x="6" y="4" width="4" height="16"/>
                                                    <rect x="14" y="4" width="4" height="16"/>
                                                </svg>
                                            ) : (
                                                <svg viewBox="0 0 24 24" width="14" height="14">
                                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                                </svg>
                                            )}
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => handleDeleteJob(job.id)}
                                            title="Delete"
                                        >
                                            <svg viewBox="0 0 24 24" width="14" height="14">
                                                <polyline points="3 6 5 6 21 6"/>
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                            </svg>
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Create/Edit Job Modal */}
            {showJobModal && (
                <div className="modal-overlay" onClick={closeJobModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editingJob ? 'Edit Cron Job' : 'Create Cron Job'}</h2>
                            <button className="modal-close" onClick={closeJobModal}>&times;</button>
                        </div>
                        <form onSubmit={handleSubmitJob}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <Label htmlFor="job-name">Job Name</Label>
                                    <Input
                                        id="job-name"
                                        type="text"
                                        value={jobForm.name}
                                        onChange={(e) => setJobForm({...jobForm, name: e.target.value})}
                                        placeholder="My Backup Job"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <Label htmlFor="job-command">Command</Label>
                                    <Input
                                        id="job-command"
                                        type="text"
                                        value={jobForm.command}
                                        onChange={(e) => setJobForm({...jobForm, command: e.target.value})}
                                        placeholder="/usr/bin/backup.sh"
                                        required
                                    />
                                    <span className="form-help">The command or script to execute</span>
                                </div>

                                <div className="form-group">
                                    <label className="checkbox-label">
                                        <Checkbox
                                            checked={jobForm.usePreset}
                                            onCheckedChange={(checked) => setJobForm({...jobForm, usePreset: !!checked})}
                                        />
                                        <span>Use preset schedule</span>
                                    </label>
                                </div>

                                {jobForm.usePreset ? (
                                    <div className="form-group">
                                        <Label htmlFor="job-preset">Schedule Preset</Label>
                                        <select
                                            id="job-preset"
                                            value={jobForm.preset}
                                            onChange={(e) => setJobForm({...jobForm, preset: e.target.value})}
                                        >
                                            {Object.entries(presets).map(([key, value]) => (
                                                <option key={key} value={key}>
                                                    {key.replace(/_/g, ' ')} ({value})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div className="form-group">
                                        <Label htmlFor="job-schedule">Cron Schedule</Label>
                                        <Input
                                            id="job-schedule"
                                            type="text"
                                            value={jobForm.schedule}
                                            onChange={(e) => setJobForm({...jobForm, schedule: e.target.value})}
                                            placeholder="0 0 * * *"
                                            required={!jobForm.usePreset}
                                        />
                                        <span className="form-help">
                                            Format: minute hour day month weekday (e.g., &quot;0 0 * * *&quot; for daily at midnight)
                                        </span>
                                    </div>
                                )}

                                <div className="form-group">
                                    <Label htmlFor="job-description">Description (optional)</Label>
                                    <Textarea
                                        id="job-description"
                                        value={jobForm.description}
                                        onChange={(e) => setJobForm({...jobForm, description: e.target.value})}
                                        placeholder="What does this job do?"
                                        rows={2}
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <Button type="button" variant="outline" onClick={closeJobModal}>
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    {editingJob ? 'Save Changes' : 'Create Job'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Run Output Modal */}
            {runOutput && (
                <div className="modal-overlay" onClick={() => setRunOutput(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Run Output: {runOutput.jobName}</h2>
                            <button className="modal-close" onClick={() => setRunOutput(null)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="run-output">
                                <div className="run-output-exit">
                                    <span className="run-output-label">Exit Code</span>
                                    <Badge variant={runOutput.exitCode === 0 ? 'success' : 'destructive'}>
                                        {runOutput.exitCode}
                                    </Badge>
                                </div>
                                {runOutput.stdout && (
                                    <div className="run-output-section">
                                        <span className="run-output-label">stdout</span>
                                        <pre className="run-output-pre">{runOutput.stdout}</pre>
                                    </div>
                                )}
                                {runOutput.stderr && (
                                    <div className="run-output-section">
                                        <span className="run-output-label">stderr</span>
                                        <pre className="run-output-pre run-output-pre--error">{runOutput.stderr}</pre>
                                    </div>
                                )}
                                {!runOutput.stdout && !runOutput.stderr && (
                                    <p className="text-muted">No output produced.</p>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setRunOutput(null)}>Close</Button>
                        </div>
                    </div>
                </div>
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

export default CronJobs;
