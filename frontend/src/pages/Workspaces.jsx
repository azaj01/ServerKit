import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

const Workspaces = () => {
    const toast = useToast();
    const { user } = useAuth();
    const [workspaces, setWorkspaces] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showMembersModal, setShowMembersModal] = useState(null);
    const [members, setMembers] = useState([]);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [allUsers, setAllUsers] = useState([]);
    const [form, setForm] = useState({ name: '', description: '', max_servers: 0, max_users: 0, primary_color: '#6366f1' });

    const loadWorkspaces = useCallback(async () => {
        try {
            const data = await api.getWorkspaces();
            setWorkspaces(data.workspaces || []);
        } catch (err) {
            toast.error('Failed to load workspaces');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

    const handleCreate = async () => {
        try {
            await api.createWorkspace(form);
            toast.success('Workspace created');
            setShowCreateModal(false);
            setForm({ name: '', description: '', max_servers: 0, max_users: 0, primary_color: '#6366f1' });
            loadWorkspaces();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDelete = async (id) => {
        try {
            await api.deleteWorkspace(id);
            toast.success('Workspace deleted');
            setDeleteConfirm(null);
            loadWorkspaces();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleArchive = async (id) => {
        try {
            await api.archiveWorkspace(id);
            toast.success('Workspace archived');
            loadWorkspaces();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const loadMembers = async (wsId) => {
        try {
            const [mData, uData] = await Promise.all([
                api.getWorkspaceMembers(wsId),
                api.getUsers().catch(() => ({ users: [] }))
            ]);
            setMembers(mData.members || []);
            setAllUsers(uData.users || []);
            setShowMembersModal(wsId);
        } catch (err) {
            toast.error('Failed to load members');
        }
    };

    const handleAddMember = async (wsId, userId) => {
        try {
            await api.addWorkspaceMember(wsId, userId);
            toast.success('Member added');
            loadMembers(wsId);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRemoveMember = async (memberId) => {
        try {
            await api.removeWorkspaceMember(memberId);
            toast.success('Member removed');
            if (showMembersModal) loadMembers(showMembersModal);
        } catch (err) {
            toast.error(err.message);
        }
    };

    if (loading) return <Spinner />;

    return (
        <div className="page-container workspaces-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Workspaces</h1>
                    <p className="page-description">{workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="page-header-actions">
                    <Button onClick={() => setShowCreateModal(true)}>
                        Create Workspace
                    </Button>
                </div>
            </div>

            <div className="workspaces-grid">
                {workspaces.map(ws => (
                    <div key={ws.id} className="workspace-card card">
                        <div className="workspace-card__header">
                            <div className="workspace-card__title">
                                {ws.primary_color && (
                                    <span className="workspace-card__color" style={{ backgroundColor: ws.primary_color }} />
                                )}
                                <h3>{ws.name}</h3>
                            </div>
                            <Badge variant={ws.status === 'active' ? 'success' : 'warning'}>
                                {ws.status}
                            </Badge>
                        </div>
                        {ws.description && <p className="workspace-card__desc">{ws.description}</p>}
                        <div className="workspace-card__meta">
                            <span>{ws.member_count} member{ws.member_count !== 1 ? 's' : ''}</span>
                            <span className="text-muted">/{ws.slug}</span>
                        </div>
                        {(ws.max_servers > 0 || ws.max_users > 0) && (
                            <div className="workspace-card__quotas">
                                {ws.max_servers > 0 && <span>Max {ws.max_servers} servers</span>}
                                {ws.max_users > 0 && <span>Max {ws.max_users} users</span>}
                            </div>
                        )}
                        <div className="workspace-card__actions">
                            <Button size="sm" variant="outline" onClick={() => loadMembers(ws.id)}>Members</Button>
                            {ws.status === 'active' && (
                                <Button size="sm" variant="secondary" onClick={() => handleArchive(ws.id)}>Archive</Button>
                            )}
                            {user?.is_admin && (
                                <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(ws)}>Delete</Button>
                            )}
                        </div>
                    </div>
                ))}
                {workspaces.length === 0 && (
                    <EmptyState
                        icon={LayoutGrid}
                        title="No workspaces yet"
                        description="Create one to isolate servers by team or project."
                    />
                )}
            </div>

            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create Workspace</h2>
                            <button className="modal-close" onClick={() => setShowCreateModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Name</label>
                                <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="My Team" />
                            </div>
                            <div className="form-group">
                                <label>Description</label>
                                <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Max Servers (0 = unlimited)</label>
                                    <Input type="number" value={form.max_servers} onChange={e => setForm({...form, max_servers: parseInt(e.target.value) || 0})} />
                                </div>
                                <div className="form-group">
                                    <label>Max Users (0 = unlimited)</label>
                                    <Input type="number" value={form.max_users} onChange={e => setForm({...form, max_users: parseInt(e.target.value) || 0})} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Brand Color</label>
                                <input
                                    type="color"
                                    className="workspace-color-input"
                                    value={form.primary_color}
                                    onChange={e => setForm({...form, primary_color: e.target.value})}
                                    aria-label="Workspace brand color"
                                />
                                <span className="form-hint">Recolors the panel for anyone viewing this workspace. Leave the default for no custom branding.</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
                            <Button onClick={handleCreate} disabled={!form.name}>Create</Button>
                        </div>
                    </div>
                </div>
            )}

            {showMembersModal && (
                <div className="modal-overlay" onClick={() => setShowMembersModal(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Workspace Members</h2>
                            <button className="modal-close" onClick={() => setShowMembersModal(null)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="members-list">
                                {members.map(m => (
                                    <div key={m.id} className="member-row">
                                        <div>
                                            <strong>{m.username || m.email}</strong>
                                            <Badge variant="outline" className="ml-2">{m.role}</Badge>
                                        </div>
                                        {m.role !== 'owner' && (
                                            <Button size="sm" variant="destructive" onClick={() => handleRemoveMember(m.id)}>Remove</Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <hr />
                            <h4>Add Member</h4>
                            <div className="server-select-list">
                                {allUsers.filter(u => !members.find(m => m.user_id === u.id)).map(u => (
                                    <div key={u.id} className="server-select-item" onClick={() => handleAddMember(showMembersModal, u.id)}>
                                        <span>{u.username || u.email}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <ConfirmDialog
                    title="Delete Workspace"
                    message={`Delete "${deleteConfirm.name}"? All data will be lost.`}
                    onConfirm={() => handleDelete(deleteConfirm.id)}
                    onCancel={() => setDeleteConfirm(null)}
                    variant="danger"
                />
            )}
        </div>
    );
};

export default Workspaces;
