import { useState, useEffect } from 'react';
import { FolderUp, UserPlus, Network } from 'lucide-react';
import useTabParam from '../hooks/useTabParam';
import { api } from '../services/api';
import { PageTopbar } from '@/components/ds';
import { FILE_TABS } from '../components/files/fileTabs';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { StatStrip, Stat } from '../components/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const VALID_TABS = ['overview', 'users', 'connections', 'logs'];

function FTPServer() {
    const [status, setStatus] = useState(null);
    const [users, setUsers] = useState([]);
    const [connections, setConnections] = useState([]);
    const [config, setConfig] = useState(null);
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useTabParam('/ftp', VALID_TABS);
    const [showUserModal, setShowUserModal] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [newUser, setNewUser] = useState({ username: '', password: '', homeDir: '' });
    const [passwordTarget, setPasswordTarget] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [selectedService, setSelectedService] = useState('vsftpd');
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const toast = useToast();

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            await Promise.all([
                loadStatus(),
                loadUsers(),
                loadConnections()
            ]);
        } catch (error) {
            console.error('Failed to load FTP data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStatus = async () => {
        try {
            const data = await api.getFTPStatus();
            setStatus(data);
            if (data.active_server) {
                loadConfig(data.active_server);
            }
        } catch (error) {
            console.error('Failed to load FTP status:', error);
        }
    };

    const loadConfig = async (service) => {
        try {
            const data = await api.getFTPConfig(service);
            setConfig(data);
        } catch (error) {
            console.error('Failed to load FTP config:', error);
        }
    };

    const loadUsers = async () => {
        try {
            const data = await api.getFTPUsers();
            setUsers(data.users || []);
        } catch (error) {
            console.error('Failed to load FTP users:', error);
        }
    };

    const loadConnections = async () => {
        try {
            const data = await api.getFTPConnections();
            setConnections(data.connections || []);
        } catch (error) {
            console.error('Failed to load FTP connections:', error);
        }
    };

    const loadLogs = async () => {
        try {
            const data = await api.getFTPLogs(200);
            setLogs(data.content || 'No logs available');
        } catch (error) {
            setLogs('Failed to load logs');
        }
    };

    const handleServiceAction = async (action) => {
        if (!status?.active_server) return;
        setActionLoading(true);
        try {
            await api.controlFTPService(action, status.active_server);
            toast.success(`FTP server ${action}ed successfully`);
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to ${action} FTP server: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installFTPServer(selectedService);
            toast.success(`${selectedService} installed successfully`);
            setShowInstallModal(false);
            await loadData();
        } catch (error) {
            toast.error(`Failed to install: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleCreateUser = async () => {
        if (!newUser.username.trim()) return;
        setActionLoading(true);
        try {
            const result = await api.createFTPUser(
                newUser.username,
                newUser.password || null,
                newUser.homeDir || null
            );
            toast.success(`User created. Password: ${result.password}`);
            setShowUserModal(false);
            setNewUser({ username: '', password: '', homeDir: '' });
            await loadUsers();
        } catch (error) {
            toast.error(`Failed to create user: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteUser = async (username) => {
        setConfirmDialog({
            title: 'Delete FTP User',
            message: `Are you sure you want to delete user "${username}"?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteFTPUser(username, false);
                    toast.success('User deleted successfully');
                    await loadUsers();
                } catch (error) {
                    toast.error(`Failed to delete user: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleToggleUser = async (username, currentStatus) => {
        try {
            await api.toggleFTPUser(username, !currentStatus);
            toast.success(`User ${currentStatus ? 'disabled' : 'enabled'} successfully`);
            await loadUsers();
        } catch (error) {
            toast.error(`Failed to toggle user: ${error.message}`);
        }
    };

    const handleChangePassword = async () => {
        if (!passwordTarget) return;
        setActionLoading(true);
        try {
            const result = await api.changeFTPPassword(passwordTarget, newPassword || null);
            toast.success(`Password changed. New password: ${result.password}`);
            setShowPasswordModal(false);
            setPasswordTarget(null);
            setNewPassword('');
        } catch (error) {
            toast.error(`Failed to change password: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDisconnect = async (pid) => {
        try {
            await api.disconnectFTPSession(pid);
            toast.success('Session disconnected');
            await loadConnections();
        } catch (error) {
            toast.error(`Failed to disconnect: ${error.message}`);
        }
    };

    const handleTestConnection = async () => {
        setActionLoading(true);
        try {
            const result = await api.testFTPConnection('localhost', 21);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.error);
            }
        } catch (error) {
            toast.error(`Connection test failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const openPasswordModal = (username) => {
        setPasswordTarget(username);
        setNewPassword('');
        setShowPasswordModal(true);
    };

    if (loading) {
        return (
            <div className="page-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    const isInstalled = status?.any_installed;
    const isRunning = status?.any_running;
    const activeServer = status?.active_server;

    return (
        <div className="page-container ftp-server">
            <PageTopbar
                icon={<Network size={18} />}
                title="FTP Server"
                tabs={FILE_TABS}
                actions={(
                    <>
                    {!isInstalled ? (
                        <Button onClick={() => setShowInstallModal(true)}>
                            Install FTP Server
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                onClick={handleTestConnection}
                                disabled={actionLoading}
                            >
                                Test Connection
                            </Button>
                            {isRunning ? (
                                <>
                                    <Button
                                        variant="outline"
                                        onClick={() => handleServiceAction('restart')}
                                        disabled={actionLoading}
                                    >
                                        Restart
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        onClick={() => handleServiceAction('stop')}
                                        disabled={actionLoading}
                                    >
                                        Stop
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    onClick={() => handleServiceAction('start')}
                                    disabled={actionLoading}
                                >
                                    Start
                                </Button>
                            )}
                        </>
                    )}
                    </>
                )}
            />

            {!isInstalled ? (
                <EmptyState
                    size="lg"
                    icon={FolderUp}
                    title="No FTP server installed"
                    description="Install an FTP server to enable file transfers on your server."
                    action={<Button size="lg" onClick={() => setShowInstallModal(true)}>Install FTP Server</Button>}
                />
            ) : (
                <>
                    <StatStrip ariaLabel="FTP server status">
                        <Stat
                            label="Server Status"
                            value={isRunning ? 'Running' : 'Stopped'}
                            state={isRunning ? 'success' : 'warning'}
                        />
                        <Stat label="Active Server" value={activeServer || 'None'} />
                        <Stat label="FTP Users" value={users.length} />
                        <Stat label="Active Connections" value={connections.length} />
                    </StatStrip>

                    <Tabs value={activeTab} onValueChange={(val) => {
                        setActiveTab(val);
                        if (val === 'connections') loadConnections();
                        if (val === 'logs') loadLogs();
                    }}>
                        <TabsList>
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="users">Users</TabsTrigger>
                            <TabsTrigger value="connections">Connections</TabsTrigger>
                            <TabsTrigger value="logs">Logs</TabsTrigger>
                        </TabsList>

                        <TabsContent value="overview">
                            <div className="overview-tab">
                                <div className="config-section">
                                    <h3>Server Configuration</h3>
                                    {config?.settings ? (
                                        <div className="config-grid">
                                            <div className="config-item">
                                                <span className="config-label">Port</span>
                                                <span className="config-value">{config.settings.listen_port || config.settings.port || 21}</span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">Anonymous Access</span>
                                                <span className={`config-value ${config.settings.anonymous_enable ? 'warning' : 'success'}`}>
                                                    {config.settings.anonymous_enable ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">Local Users</span>
                                                <span className="config-value">
                                                    {config.settings.local_enable ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">Write Permission</span>
                                                <span className="config-value">
                                                    {config.settings.write_enable ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">Chroot Users</span>
                                                <span className="config-value">
                                                    {config.settings.chroot_local_user ? 'Yes' : 'No'}
                                                </span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">SSL/TLS</span>
                                                <span className={`config-value ${config.settings.ssl_enable ? 'success' : 'warning'}`}>
                                                    {config.settings.ssl_enable ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-muted">Configuration not available</p>
                                    )}
                                </div>

                                <div className="info-section">
                                    <h3>Connection Information</h3>
                                    <div className="info-grid">
                                        <div className="info-item">
                                            <span className="info-label">Host</span>
                                            <code>Your server IP or domain</code>
                                        </div>
                                        <div className="info-item">
                                            <span className="info-label">Port</span>
                                            <code>21</code>
                                        </div>
                                        <div className="info-item">
                                            <span className="info-label">Protocol</span>
                                            <code>FTP{config?.settings?.ssl_enable ? 'S' : ''}</code>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="users">
                            <div className="users-tab">
                                <div className="section-header">
                                    <h3>FTP Users</h3>
                                    <Button onClick={() => setShowUserModal(true)}>
                                        Add User
                                    </Button>
                                </div>
                                {users.length === 0 ? (
                                    <EmptyState
                                        icon={UserPlus}
                                        title="No FTP users configured"
                                        action={<Button onClick={() => setShowUserModal(true)}>Create First User</Button>}
                                    />
                                ) : (
                                    <div className="users-table">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Username</th>
                                                    <th>Home Directory</th>
                                                    <th>Usage</th>
                                                    <th>Status</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {users.map((user) => (
                                                    <tr key={user.username}>
                                                        <td>
                                                            <span className="user-name">{user.username}</span>
                                                            {user.in_userlist && (
                                                                <Badge variant="info">FTP</Badge>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <code>{user.home}</code>
                                                            {!user.home_exists && (
                                                                <Badge variant="warning">Missing</Badge>
                                                            )}
                                                        </td>
                                                        <td>{user.home_size_human}</td>
                                                        <td>
                                                            <span className={`status-badge ${user.is_active ? 'active' : 'inactive'}`}>
                                                                {user.is_active ? 'Active' : 'Disabled'}
                                                            </span>
                                                        </td>
                                                        <td className="actions">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => openPasswordModal(user.username)}
                                                                title="Change Password"
                                                            >
                                                                <span className="icon">key</span>
                                                            </Button>
                                                            <Button
                                                                variant={user.is_active ? 'secondary' : 'outline'}
                                                                size="sm"
                                                                onClick={() => handleToggleUser(user.username, user.is_active)}
                                                                title={user.is_active ? 'Disable' : 'Enable'}
                                                            >
                                                                <span className="icon">{user.is_active ? 'block' : 'check'}</span>
                                                            </Button>
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                                onClick={() => handleDeleteUser(user.username)}
                                                                title="Delete"
                                                            >
                                                                <span className="icon">delete</span>
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        <TabsContent value="connections">
                            <div className="connections-tab">
                                <div className="section-header">
                                    <h3>Active Connections</h3>
                                    <Button variant="outline" onClick={loadConnections}>
                                        <span className="icon">refresh</span>
                                        Refresh
                                    </Button>
                                </div>
                                {connections.length === 0 ? (
                                    <EmptyState icon={Network} title="No active connections" />
                                ) : (
                                    <div className="connections-table">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Local Address</th>
                                                    <th>Remote Address</th>
                                                    <th>State</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {connections.map((conn, index) => (
                                                    <tr key={index}>
                                                        <td><code>{conn.local}</code></td>
                                                        <td><code>{conn.remote}</code></td>
                                                        <td>
                                                            <span className="status-badge active">{conn.state}</span>
                                                        </td>
                                                        <td>
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                                onClick={() => handleDisconnect(conn.pid)}
                                                                title="Disconnect"
                                                            >
                                                                <span className="icon">close</span>
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        <TabsContent value="logs">
                            <div className="logs-tab">
                                <div className="section-header">
                                    <h3>Server Logs</h3>
                                    <Button variant="outline" onClick={loadLogs}>
                                        <span className="icon">refresh</span>
                                        Refresh
                                    </Button>
                                </div>
                                <div className="log-viewer">
                                    <pre>{logs}</pre>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </>
            )}

            {/* Install Modal */}
            {showInstallModal && (
                <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Install FTP Server</h2>
                            <button className="btn btn-icon" onClick={() => setShowInstallModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <Label>Select FTP Server</Label>
                                <select
                                    value={selectedService}
                                    onChange={(e) => setSelectedService(e.target.value)}
                                >
                                    <option value="vsftpd">vsftpd (Recommended)</option>
                                    <option value="proftpd">ProFTPD</option>
                                </select>
                            </div>
                            <div className="install-info">
                                {selectedService === 'vsftpd' ? (
                                    <p>
                                        <strong>vsftpd</strong> is a secure, fast, and stable FTP server.
                                        It&apos;s the default choice for most Ubuntu/Debian systems.
                                    </p>
                                ) : (
                                    <p>
                                        <strong>ProFTPD</strong> is a highly configurable FTP server with
                                        advanced features and Apache-like configuration syntax.
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowInstallModal(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleInstall}
                                disabled={actionLoading}
                            >
                                {actionLoading ? 'Installing...' : 'Install'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create User Modal */}
            {showUserModal && (
                <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create FTP User</h2>
                            <button className="btn btn-icon" onClick={() => setShowUserModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <Label>Username *</Label>
                                <Input
                                    type="text"
                                    value={newUser.username}
                                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                                    placeholder="ftpuser"
                                />
                            </div>
                            <div className="form-group">
                                <Label>Password (leave empty to auto-generate)</Label>
                                <Input
                                    type="password"
                                    value={newUser.password}
                                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                    placeholder="Auto-generated if empty"
                                />
                            </div>
                            <div className="form-group">
                                <Label>Home Directory (optional)</Label>
                                <Input
                                    type="text"
                                    value={newUser.homeDir}
                                    onChange={(e) => setNewUser({ ...newUser, homeDir: e.target.value })}
                                    placeholder="/home/ftp/username"
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowUserModal(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreateUser}
                                disabled={actionLoading || !newUser.username.trim()}
                            >
                                {actionLoading ? 'Creating...' : 'Create User'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Change Password Modal */}
            {showPasswordModal && (
                <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Change Password</h2>
                            <button className="btn btn-icon" onClick={() => setShowPasswordModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Changing password for user: <strong>{passwordTarget}</strong></p>
                            <div className="form-group">
                                <Label>New Password (leave empty to auto-generate)</Label>
                                <Input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Auto-generated if empty"
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowPasswordModal(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleChangePassword}
                                disabled={actionLoading}
                            >
                                {actionLoading ? 'Changing...' : 'Change Password'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Dialog */}
            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
}

export default FTPServer;
