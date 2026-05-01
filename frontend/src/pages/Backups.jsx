import { useState, useEffect } from 'react';
import useTabParam from '../hooks/useTabParam';
import { Upload, Download, Check, AlertTriangle, Clock, Database, Package, FolderArchive, HardDrive, Cloud, CloudOff, RefreshCw, Trash2, Plus, CheckCircle, XCircle, FileArchive } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatCard, StatsGrid } from '../components/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const VALID_TABS = ['backups', 'schedules', 'storage', 'settings'];

const Backups = () => {
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const [backups, setBackups] = useState([]);
    const [stats, setStats] = useState(null);
    const [schedules, setSchedules] = useState([]);
    const [config, setConfig] = useState(null);
    const [storageConfig, setStorageConfig] = useState(null);
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useTabParam('/backups', VALID_TABS);
    const [filterType, setFilterType] = useState('all');

    // Modal states
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [selectedBackup, setSelectedBackup] = useState(null);
    const [uploadingBackup, setUploadingBackup] = useState(null);
    const [testingConnection, setTestingConnection] = useState(false);

    // Backup form state
    const [backupForm, setBackupForm] = useState({
        type: 'application',
        applicationId: '',
        includeDb: false,
        dbType: 'mysql',
        dbName: '',
        dbUser: '',
        dbPassword: '',
        dbHost: 'localhost',
        filePaths: '',
        fileName: ''
    });

    // Schedule form state
    const [scheduleForm, setScheduleForm] = useState({
        name: '',
        backupType: 'application',
        target: '',
        scheduleTime: '02:00',
        days: ['daily'],
        uploadRemote: false
    });

    // Config form state
    const [configForm, setConfigForm] = useState({
        enabled: false,
        retention_days: 30
    });

    // Storage config form state
    const [storageForm, setStorageForm] = useState({
        provider: 'local',
        s3: { bucket: '', region: 'us-east-1', access_key: '', secret_key: '', endpoint_url: '', path_prefix: 'serverkit-backups' },
        b2: { bucket: '', key_id: '', application_key: '', endpoint_url: '', path_prefix: 'serverkit-backups' },
        auto_upload: false,
        keep_local_copy: true
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [backupsRes, statsRes, schedulesRes, configRes, appsRes, storageRes] = await Promise.all([
                api.getBackups(),
                api.getBackupStats(),
                api.getBackupSchedules(),
                api.getBackupConfig(),
                api.getApps(),
                api.getStorageConfig().catch(() => null)
            ]);

            setBackups(backupsRes.backups || []);
            setStats(statsRes);
            setSchedules(schedulesRes.schedules || []);
            setConfig(configRes);
            setApps(appsRes.applications || []);

            if (storageRes) {
                setStorageConfig(storageRes);
                setStorageForm(storageRes);
            }

            if (configRes) {
                setConfigForm({
                    enabled: configRes.enabled || false,
                    retention_days: configRes.retention_days || 30
                });
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateBackup = async (e) => {
        e.preventDefault();
        try {
            if (backupForm.type === 'application') {
                const dbConfig = backupForm.includeDb ? {
                    type: backupForm.dbType,
                    name: backupForm.dbName,
                    user: backupForm.dbUser,
                    password: backupForm.dbPassword,
                    host: backupForm.dbHost
                } : null;
                await api.backupApplication(parseInt(backupForm.applicationId), backupForm.includeDb, dbConfig);
                toast.success('Application backup created');
            } else if (backupForm.type === 'database') {
                await api.backupDatabase(
                    backupForm.dbType,
                    backupForm.dbName,
                    backupForm.dbUser,
                    backupForm.dbPassword,
                    backupForm.dbHost
                );
                toast.success('Database backup created');
            } else if (backupForm.type === 'files') {
                const paths = backupForm.filePaths.split('\n').map(p => p.trim()).filter(Boolean);
                if (paths.length === 0) {
                    toast.error('Enter at least one file path');
                    return;
                }
                await api.backupFiles(paths, backupForm.fileName || null);
                toast.success('File backup created');
            }
            setShowBackupModal(false);
            resetBackupForm();
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteBackup = async (backupPath) => {
        const confirmed = await confirm({ title: 'Delete Backup', message: 'Are you sure you want to delete this backup?' });
        if (!confirmed) return;
        try {
            await api.deleteBackup(backupPath);
            toast.success('Backup deleted');
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleUploadToRemote = async (backup) => {
        setUploadingBackup(backup.path);
        try {
            await api.uploadBackupToRemote(backup.path);
            toast.success('Backup uploaded to remote storage');
            loadData();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setUploadingBackup(null);
        }
    };

    const handleRestore = async () => {
        if (!selectedBackup) return;
        const restoreConfirmed = await confirm({ title: 'Restore Backup', message: 'Are you sure you want to restore this backup? This may overwrite existing data.', variant: 'warning' });
        if (!restoreConfirmed) return;

        try {
            if (selectedBackup.type === 'application') {
                await api.restoreApplication(selectedBackup.path);
            } else {
                await api.restoreDatabase(
                    selectedBackup.path,
                    selectedBackup.database_type,
                    selectedBackup.database_name
                );
            }
            setShowRestoreModal(false);
            setSelectedBackup(null);
            toast.success('Backup restored successfully');
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleAddSchedule = async (e) => {
        e.preventDefault();
        try {
            await api.addBackupSchedule(
                scheduleForm.name,
                scheduleForm.backupType,
                scheduleForm.target,
                scheduleForm.scheduleTime,
                scheduleForm.days,
                scheduleForm.uploadRemote
            );
            toast.success('Schedule added');
            setShowScheduleModal(false);
            resetScheduleForm();
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleToggleSchedule = async (schedule) => {
        try {
            await api.updateBackupSchedule(schedule.id, { enabled: !schedule.enabled });
            toast.success(`Schedule ${schedule.enabled ? 'disabled' : 'enabled'}`);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRemoveSchedule = async (scheduleId) => {
        const confirmed = await confirm({ title: 'Remove Schedule', message: 'Are you sure you want to remove this schedule?' });
        if (!confirmed) return;
        try {
            await api.removeBackupSchedule(scheduleId);
            toast.success('Schedule removed');
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        try {
            await api.updateBackupConfig(configForm);
            toast.success('Settings saved');
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleSaveStorageConfig = async (e) => {
        e.preventDefault();
        try {
            await api.updateStorageConfig(storageForm);
            toast.success('Storage configuration saved');
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleTestConnection = async () => {
        setTestingConnection(true);
        try {
            const result = await api.testStorageConnection(storageForm);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.error);
            }
        } catch (err) {
            toast.error(err.message);
        } finally {
            setTestingConnection(false);
        }
    };

    const handleCleanup = async () => {
        const confirmed = await confirm({ title: 'Cleanup Backups', message: `This will delete backups older than ${configForm.retention_days} days. Continue?`, variant: 'warning' });
        if (!confirmed) return;
        try {
            const result = await api.cleanupBackups(configForm.retention_days);
            toast.success(result.message);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const resetBackupForm = () => {
        setBackupForm({
            type: 'application',
            applicationId: '',
            includeDb: false,
            dbType: 'mysql',
            dbName: '',
            dbUser: '',
            dbPassword: '',
            dbHost: 'localhost',
            filePaths: '',
            fileName: ''
        });
    };

    const resetScheduleForm = () => {
        setScheduleForm({
            name: '',
            backupType: 'application',
            target: '',
            scheduleTime: '02:00',
            days: ['daily'],
            uploadRemote: false
        });
    };

    const formatSize = (bytes) => {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unitIndex = 0;
        let size = bytes;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };

    const getBackupIcon = (type) => {
        switch (type) {
            case 'application': return <Package size={16} />;
            case 'database': return <Database size={16} />;
            case 'files': return <FolderArchive size={16} />;
            default: return <FileArchive size={16} />;
        }
    };

    const getRemoteStatusBadge = (status) => {
        switch (status) {
            case 'synced':
                return <Badge variant="success"><Cloud size={12} /> Synced</Badge>;
            case 'remote-only':
                return <Badge variant="info"><Cloud size={12} /> Remote</Badge>;
            default:
                return <Badge variant="secondary"><HardDrive size={12} /> Local</Badge>;
        }
    };

    const filteredBackups = filterType === 'all'
        ? backups
        : backups.filter(b => b.type === filterType);

    if (loading) {
        return <div className="page"><div className="loading">Loading backup data...</div></div>;
    }

    return (
        <div className="page-container backups-page">
            <div className="page-header">
                <div>
                    <h1>Backups</h1>
                    <p className="page-subtitle">Manage application, database, and file backups with local and remote storage</p>
                </div>
                <div className="page-actions">
                    <Button variant="outline" onClick={() => setShowScheduleModal(true)}>
                        <Clock size={16} />
                        Add Schedule
                    </Button>
                    <Button onClick={() => setShowBackupModal(true)}>
                        <Plus size={16} />
                        Create Backup
                    </Button>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            {/* Stats Cards */}
            <StatsGrid>
                <StatCard icon={Download} iconVariant="backups" label="Total Backups" value={stats?.total_backups || 0} />
                <StatCard icon={Package} iconVariant="apps" label="Application Backups" value={stats?.application_backups || 0} />
                <StatCard icon={Database} iconVariant="databases" label="Database Backups" value={stats?.database_backups || 0} />
                <StatCard icon={HardDrive} iconVariant="size" label="Local Size" value={stats?.total_size_human || '0 B'} />
                {storageConfig?.provider !== 'local' && (
                    <StatCard icon={Cloud} iconVariant="cloud" label="Remote Backups" value={stats?.remote_count || 0} />
                )}
            </StatsGrid>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="backups">Backups</TabsTrigger>
                    <TabsTrigger value="schedules">Schedules</TabsTrigger>
                    <TabsTrigger value="storage">Storage</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                {/* Backups Tab */}
                <TabsContent value="backups">
                    <div className="card">
                        <div className="card-header">
                            <h3>Backup List</h3>
                            <div className="card-actions">
                                <select
                                    value={filterType}
                                    onChange={(e) => setFilterType(e.target.value)}
                                    className="filter-select"
                                >
                                    <option value="all">All Types</option>
                                    <option value="application">Applications</option>
                                    <option value="database">Databases</option>
                                    <option value="files">Files</option>
                                </select>
                                <Button size="sm" variant="outline" onClick={loadData}>
                                    <RefreshCw size={14} />
                                    Refresh
                                </Button>
                            </div>
                        </div>
                        <div className="card-body">
                            {filteredBackups.length === 0 ? (
                                <div className="empty-state">
                                    <Download size={48} />
                                    <h3>No Backups</h3>
                                    <p>No backups found. Create your first backup to get started.</p>
                                    <Button onClick={() => setShowBackupModal(true)}>
                                        Create Backup
                                    </Button>
                                </div>
                            ) : (
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Type</th>
                                            <th>Size</th>
                                            <th>Storage</th>
                                            <th>Created</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredBackups.map((backup, index) => (
                                            <tr key={index}>
                                                <td>
                                                    <div className="backup-name">
                                                        {getBackupIcon(backup.type)}
                                                        <span>{backup.name || backup.app_name}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <Badge variant={backup.type === 'application' ? 'default' : backup.type === 'database' ? 'info' : 'warning'}>
                                                        {backup.type}
                                                    </Badge>
                                                </td>
                                                <td>{formatSize(backup.size)}</td>
                                                <td>{getRemoteStatusBadge(backup.remote_status)}</td>
                                                <td>{formatTimestamp(backup.timestamp)}</td>
                                                <td>
                                                    <div className="action-buttons">
                                                        {backup.type !== 'files' && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => {
                                                                    setSelectedBackup(backup);
                                                                    setShowRestoreModal(true);
                                                                }}
                                                                title="Restore"
                                                            >
                                                                <RefreshCw size={14} />
                                                            </Button>
                                                        )}
                                                        {storageConfig?.provider !== 'local' && backup.remote_status !== 'synced' && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleUploadToRemote(backup)}
                                                                disabled={uploadingBackup === backup.path}
                                                                title="Upload to Remote"
                                                            >
                                                                {uploadingBackup === backup.path ? (
                                                                    <RefreshCw size={14} className="spinning" />
                                                                ) : (
                                                                    <Upload size={14} />
                                                                )}
                                                            </Button>
                                                        )}
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            onClick={() => handleDeleteBackup(backup.path)}
                                                            title="Delete"
                                                        >
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </TabsContent>

                {/* Schedules Tab */}
                <TabsContent value="schedules">
                    <div className="card">
                        <div className="card-header">
                            <h3>Backup Schedules</h3>
                            <Button size="sm" onClick={() => setShowScheduleModal(true)}>
                                <Plus size={14} />
                                Add Schedule
                            </Button>
                        </div>
                        <div className="card-body">
                            {schedules.length === 0 ? (
                                <div className="empty-state">
                                    <Clock size={48} />
                                    <h3>No Schedules</h3>
                                    <p>No backup schedules configured. Add a schedule for automated backups.</p>
                                    <Button onClick={() => setShowScheduleModal(true)}>
                                        Add Schedule
                                    </Button>
                                </div>
                            ) : (
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Type</th>
                                            <th>Target</th>
                                            <th>Time</th>
                                            <th>Days</th>
                                            <th>Remote</th>
                                            <th>Last Run</th>
                                            <th>Status</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {schedules.map((schedule) => (
                                            <tr key={schedule.id}>
                                                <td>{schedule.name}</td>
                                                <td>
                                                    <Badge variant={schedule.backup_type === 'application' ? 'default' : schedule.backup_type === 'database' ? 'info' : 'warning'}>
                                                        {schedule.backup_type}
                                                    </Badge>
                                                </td>
                                                <td>{schedule.target}</td>
                                                <td>{schedule.schedule_time}</td>
                                                <td>{schedule.days?.join(', ') || 'daily'}</td>
                                                <td>
                                                    {schedule.upload_remote ? (
                                                        <Cloud size={16} className="text-success" />
                                                    ) : (
                                                        <CloudOff size={16} className="text-muted" />
                                                    )}
                                                </td>
                                                <td>{schedule.last_run ? formatTimestamp(schedule.last_run) : 'Never'}</td>
                                                <td>
                                                    {schedule.last_status === 'success' && (
                                                        <Badge variant="success"><CheckCircle size={12} /> Success</Badge>
                                                    )}
                                                    {schedule.last_status === 'failed' && (
                                                        <Badge variant="destructive"><XCircle size={12} /> Failed</Badge>
                                                    )}
                                                    {!schedule.last_status && (
                                                        <Badge variant={schedule.enabled ? 'success' : 'secondary'}>
                                                            {schedule.enabled ? 'Active' : 'Disabled'}
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="action-buttons">
                                                        <Button
                                                            size="sm"
                                                            variant={schedule.enabled ? 'outline' : 'default'}
                                                            onClick={() => handleToggleSchedule(schedule)}
                                                            title={schedule.enabled ? 'Disable' : 'Enable'}
                                                        >
                                                            {schedule.enabled ? <XCircle size={14} /> : <CheckCircle size={14} />}
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            onClick={() => handleRemoveSchedule(schedule.id)}
                                                            title="Remove"
                                                        >
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </TabsContent>

                {/* Storage Tab */}
                <TabsContent value="storage">
                    <div className="card">
                        <div className="card-header">
                            <h3>Remote Storage Configuration</h3>
                        </div>
                        <div className="card-body">
                            <form onSubmit={handleSaveStorageConfig}>
                                <div className="form-group">
                                    <label>Storage Provider</label>
                                    <select
                                        value={storageForm.provider}
                                        onChange={(e) => setStorageForm({...storageForm, provider: e.target.value})}
                                    >
                                        <option value="local">Local Only</option>
                                        <option value="s3">S3-Compatible (AWS S3, MinIO, Wasabi)</option>
                                        <option value="b2">Backblaze B2</option>
                                    </select>
                                </div>

                                {storageForm.provider === 's3' && (
                                    <div className="storage-provider-config">
                                        <h4>S3-Compatible Storage</h4>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Bucket Name</label>
                                                <Input
                                                    type="text"
                                                    value={storageForm.s3.bucket}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, bucket: e.target.value}})}
                                                    placeholder="my-backup-bucket"
                                                    required
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Region</label>
                                                <Input
                                                    type="text"
                                                    value={storageForm.s3.region}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, region: e.target.value}})}
                                                    placeholder="us-east-1"
                                                />
                                            </div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Access Key</label>
                                                <Input
                                                    type="text"
                                                    value={storageForm.s3.access_key}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, access_key: e.target.value}})}
                                                    placeholder="AKIA..."
                                                    required
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Secret Key</label>
                                                <Input
                                                    type="password"
                                                    value={storageForm.s3.secret_key}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, secret_key: e.target.value}})}
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Custom Endpoint URL <span className="form-help-inline">(optional, for MinIO/Wasabi)</span></label>
                                                <Input
                                                    type="text"
                                                    value={storageForm.s3.endpoint_url}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, endpoint_url: e.target.value}})}
                                                    placeholder="https://s3.example.com"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Path Prefix</label>
                                                <Input
                                                    type="text"
                                                    value={storageForm.s3.path_prefix}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, path_prefix: e.target.value}})}
                                                    placeholder="serverkit-backups"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {storageForm.provider === 'b2' && (
                                    <div className="storage-provider-config">
                                        <h4>Backblaze B2</h4>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Bucket Name</label>
                                                <Input
                                                    type="text"
                                                    value={storageForm.b2.bucket}
                                                    onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, bucket: e.target.value}})}
                                                    placeholder="my-backup-bucket"
                                                    required
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>S3-Compatible Endpoint URL</label>
                                                <Input
                                                    type="text"
                                                    value={storageForm.b2.endpoint_url}
                                                    onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, endpoint_url: e.target.value}})}
                                                    placeholder="https://s3.us-west-004.backblazeb2.com"
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Application Key ID</label>
                                                <Input
                                                    type="text"
                                                    value={storageForm.b2.key_id}
                                                    onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, key_id: e.target.value}})}
                                                    required
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Application Key</label>
                                                <Input
                                                    type="password"
                                                    value={storageForm.b2.application_key}
                                                    onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, application_key: e.target.value}})}
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label>Path Prefix</label>
                                            <Input
                                                type="text"
                                                value={storageForm.b2.path_prefix}
                                                onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, path_prefix: e.target.value}})}
                                                placeholder="serverkit-backups"
                                            />
                                        </div>
                                    </div>
                                )}

                                {storageForm.provider !== 'local' && (
                                    <>
                                        <div className="form-group">
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={storageForm.auto_upload}
                                                    onChange={(e) => setStorageForm({...storageForm, auto_upload: e.target.checked})}
                                                />
                                                <span>Auto-upload new backups to remote storage</span>
                                            </label>
                                        </div>

                                        <div className="form-group">
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={storageForm.keep_local_copy}
                                                    onChange={(e) => setStorageForm({...storageForm, keep_local_copy: e.target.checked})}
                                                />
                                                <span>Keep local copy after uploading</span>
                                            </label>
                                        </div>
                                    </>
                                )}

                                <div className="form-actions">
                                    <Button type="submit">Save Storage Config</Button>
                                    {storageForm.provider !== 'local' && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleTestConnection}
                                            disabled={testingConnection}
                                        >
                                            {testingConnection ? (
                                                <><RefreshCw size={16} className="spinning" /> Testing...</>
                                            ) : (
                                                <><Check size={16} /> Test Connection</>
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </form>
                        </div>
                    </div>
                </TabsContent>

                {/* Settings Tab */}
                <TabsContent value="settings">
                    <div className="card">
                        <div className="card-header">
                            <h3>Backup Settings</h3>
                        </div>
                        <div className="card-body">
                            <form onSubmit={handleSaveConfig}>
                                <div className="form-group">
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={configForm.enabled}
                                            onChange={(e) => setConfigForm({...configForm, enabled: e.target.checked})}
                                        />
                                        <span>Enable Scheduled Backups</span>
                                    </label>
                                </div>

                                <div className="form-group">
                                    <label>Retention Period (days)</label>
                                    <Input
                                        type="number"
                                        value={configForm.retention_days}
                                        onChange={(e) => setConfigForm({...configForm, retention_days: parseInt(e.target.value)})}
                                        min="1"
                                        max="365"
                                    />
                                    <span className="form-help">Backups older than this will be deleted during cleanup</span>
                                </div>

                                <div className="form-actions">
                                    <Button type="submit">Save Settings</Button>
                                    <Button type="button" variant="outline" onClick={handleCleanup}>
                                        <Trash2 size={16} />
                                        Run Cleanup Now
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Create Backup Modal */}
            {showBackupModal && (
                <div className="modal-overlay" onClick={() => setShowBackupModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create Backup</h2>
                            <button className="modal-close" onClick={() => setShowBackupModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleCreateBackup}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Backup Type</label>
                                    <select
                                        value={backupForm.type}
                                        onChange={(e) => setBackupForm({...backupForm, type: e.target.value})}
                                    >
                                        <option value="application">Application</option>
                                        <option value="database">Database Only</option>
                                        <option value="files">Files / Directories</option>
                                    </select>
                                </div>

                                {backupForm.type === 'application' && (
                                    <>
                                        <div className="form-group">
                                            <label>Application</label>
                                            <select
                                                value={backupForm.applicationId}
                                                onChange={(e) => setBackupForm({...backupForm, applicationId: e.target.value})}
                                                required
                                            >
                                                <option value="">Select Application</option>
                                                {apps.map(app => (
                                                    <option key={app.id} value={app.id}>{app.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={backupForm.includeDb}
                                                    onChange={(e) => setBackupForm({...backupForm, includeDb: e.target.checked})}
                                                />
                                                <span>Include Database</span>
                                            </label>
                                        </div>
                                    </>
                                )}

                                {backupForm.type === 'files' && (
                                    <>
                                        <div className="form-group">
                                            <label>Backup Name (optional)</label>
                                            <Input
                                                type="text"
                                                value={backupForm.fileName}
                                                onChange={(e) => setBackupForm({...backupForm, fileName: e.target.value})}
                                                placeholder="my-config-backup"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>File/Directory Paths (one per line)</label>
                                            <Textarea
                                                value={backupForm.filePaths}
                                                onChange={(e) => setBackupForm({...backupForm, filePaths: e.target.value})}
                                                placeholder={"/etc/nginx/nginx.conf\n/var/www/mysite/config\n/home/user/.env"}
                                                rows={5}
                                                required
                                            />
                                            <span className="form-help">Enter absolute paths to files or directories to backup</span>
                                        </div>
                                    </>
                                )}

                                {(backupForm.type === 'database' || backupForm.includeDb) && (
                                    <>
                                        <div className="form-group">
                                            <label>Database Type</label>
                                            <select
                                                value={backupForm.dbType}
                                                onChange={(e) => setBackupForm({...backupForm, dbType: e.target.value})}
                                            >
                                                <option value="mysql">MySQL</option>
                                                <option value="postgresql">PostgreSQL</option>
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label>Database Name</label>
                                            <Input
                                                type="text"
                                                value={backupForm.dbName}
                                                onChange={(e) => setBackupForm({...backupForm, dbName: e.target.value})}
                                                required
                                            />
                                        </div>

                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Username</label>
                                                <Input
                                                    type="text"
                                                    value={backupForm.dbUser}
                                                    onChange={(e) => setBackupForm({...backupForm, dbUser: e.target.value})}
                                                />
                                            </div>

                                            <div className="form-group">
                                                <label>Password</label>
                                                <Input
                                                    type="password"
                                                    value={backupForm.dbPassword}
                                                    onChange={(e) => setBackupForm({...backupForm, dbPassword: e.target.value})}
                                                />
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label>Host</label>
                                            <Input
                                                type="text"
                                                value={backupForm.dbHost}
                                                onChange={(e) => setBackupForm({...backupForm, dbHost: e.target.value})}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="modal-footer">
                                <Button type="button" variant="outline" onClick={() => setShowBackupModal(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit">Create Backup</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Schedule Modal */}
            {showScheduleModal && (
                <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add Backup Schedule</h2>
                            <button className="modal-close" onClick={() => setShowScheduleModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleAddSchedule}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Schedule Name</label>
                                    <Input
                                        type="text"
                                        value={scheduleForm.name}
                                        onChange={(e) => setScheduleForm({...scheduleForm, name: e.target.value})}
                                        placeholder="Daily App Backup"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Backup Type</label>
                                    <select
                                        value={scheduleForm.backupType}
                                        onChange={(e) => setScheduleForm({...scheduleForm, backupType: e.target.value})}
                                    >
                                        <option value="application">Application</option>
                                        <option value="database">Database</option>
                                        <option value="files">Files / Directories</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>
                                        {scheduleForm.backupType === 'files'
                                            ? 'Paths (comma-separated)'
                                            : scheduleForm.backupType === 'database'
                                            ? 'Database (format: mysql:dbname or postgresql:dbname)'
                                            : 'Application Name'
                                        }
                                    </label>
                                    <Input
                                        type="text"
                                        value={scheduleForm.target}
                                        onChange={(e) => setScheduleForm({...scheduleForm, target: e.target.value})}
                                        placeholder={
                                            scheduleForm.backupType === 'files'
                                                ? '/etc/nginx,/var/www/config'
                                                : scheduleForm.backupType === 'database'
                                                ? 'mysql:mydb'
                                                : 'my-app'
                                        }
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Time</label>
                                    <Input
                                        type="time"
                                        value={scheduleForm.scheduleTime}
                                        onChange={(e) => setScheduleForm({...scheduleForm, scheduleTime: e.target.value})}
                                        required
                                    />
                                </div>

                                {storageConfig?.provider !== 'local' && (
                                    <div className="form-group">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={scheduleForm.uploadRemote}
                                                onChange={(e) => setScheduleForm({...scheduleForm, uploadRemote: e.target.checked})}
                                            />
                                            <span>Upload to remote storage after backup</span>
                                        </label>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <Button type="button" variant="outline" onClick={() => setShowScheduleModal(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit">Add Schedule</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Restore Modal */}
            {showRestoreModal && selectedBackup && (
                <div className="modal-overlay" onClick={() => setShowRestoreModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Restore Backup</h2>
                            <button className="modal-close" onClick={() => setShowRestoreModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="restore-warning">
                                <AlertTriangle size={48} />
                                <h3>Warning</h3>
                                <p>Restoring this backup will overwrite existing data. This action cannot be undone.</p>
                            </div>
                            <div className="restore-details">
                                <div className="detail-row">
                                    <span className="detail-label">Backup Name:</span>
                                    <span className="detail-value">{selectedBackup.name || selectedBackup.app_name}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Type:</span>
                                    <span className="detail-value">{selectedBackup.type}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Created:</span>
                                    <span className="detail-value">{formatTimestamp(selectedBackup.timestamp)}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Size:</span>
                                    <span className="detail-value">{formatSize(selectedBackup.size)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowRestoreModal(false)}>
                                Cancel
                            </Button>
                            <Button variant="destructive" onClick={handleRestore}>
                                Restore Backup
                            </Button>
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

export default Backups;
