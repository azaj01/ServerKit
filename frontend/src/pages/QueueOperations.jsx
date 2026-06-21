import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Layers, List, Inbox, Send, Trash2, RefreshCw, Plus
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageTopbar, MetricCard, Pill } from '@/components/ds';

const STATUS_KINDS = {
    pending: 'blue',
    in_flight: 'yellow',
    completed: 'green',
    failed: 'red',
    dead_letter: 'gray',
};

const POLL_INTERVAL = 3000;

const QueueOperations = () => {
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();

    const [activeTab, setActiveTab] = useState('overview');
    const [loading, setLoading] = useState(true);
    const [groups, setGroups] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('');
    const [selectedQueue, setSelectedQueue] = useState('');
    const [queues, setQueues] = useState([]);
    const [messages, setMessages] = useState([]);
    const [stats, setStats] = useState(null);
    const [messageFilter, setMessageFilter] = useState('all');

    const [showGroupModal, setShowGroupModal] = useState(false);
    const [groupForm, setGroupForm] = useState({ slug: '', name: '', description: '' });

    const [showQueueModal, setShowQueueModal] = useState(false);
    const [queueForm, setQueueForm] = useState({ slug: '', name: '', description: '', config: '{}' });

    const [sendForm, setSendForm] = useState({ payload: '{}', priority: 0, delay_ms: 0 });

    const [selectedMessage, setSelectedMessage] = useState(null);

    const pollRef = useRef(null);

    const loadData = useCallback(async () => {
        try {
            const [groupsRes, statsRes] = await Promise.all([
                api.getQueueGroups(),
                api.getGlobalQueueStats(),
            ]);
            setGroups(groupsRes.groups || []);
            setStats(statsRes);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    const loadQueues = useCallback(async (groupSlug) => {
        if (!groupSlug) return;
        try {
            const res = await api.getQueues(groupSlug);
            setQueues(res.queues || []);
        } catch (err) {
            toast.error(err.message);
        }
    }, [toast]);

    const loadMessages = useCallback(async (groupSlug, queueSlug) => {
        if (!groupSlug || !queueSlug) return;
        try {
            const status = messageFilter === 'all' ? undefined : messageFilter;
            const res = await api.getMessages(groupSlug, queueSlug, { status, limit: 100 });
            setMessages(res.messages || []);
        } catch (err) {
            toast.error(err.message);
        }
    }, [toast, messageFilter]);

    useEffect(() => {
        loadData();
        pollRef.current = setInterval(() => {
            loadData();
            if (selectedGroup) loadQueues(selectedGroup);
            if (selectedGroup && selectedQueue) loadMessages(selectedGroup, selectedQueue);
        }, POLL_INTERVAL);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [selectedGroup, selectedQueue, loadData, loadQueues, loadMessages]);

    const handleCreateGroup = async (e) => {
        e.preventDefault();
        try {
            await api.createQueueGroup(groupForm);
            toast.success('Queue group created');
            setShowGroupModal(false);
            setGroupForm({ slug: '', name: '', description: '' });
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteGroup = async (slug) => {
        const confirmed = await confirm({
            title: 'Delete Queue Group',
            message: `Are you sure you want to delete "${slug}" and all its queues and messages?`,
            variant: 'danger',
        });
        if (!confirmed) return;
        try {
            await api.deleteQueueGroup(slug);
            toast.success('Queue group deleted');
            if (selectedGroup === slug) {
                setSelectedGroup('');
                setSelectedQueue('');
                setQueues([]);
                setMessages([]);
            }
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleCreateQueue = async (e) => {
        e.preventDefault();
        try {
            let config = {};
            try {
                config = JSON.parse(queueForm.config);
            } catch {
                toast.error('Config must be valid JSON');
                return;
            }
            await api.createQueue(selectedGroup, {
                slug: queueForm.slug,
                name: queueForm.name,
                description: queueForm.description,
                config,
            });
            toast.success('Queue created');
            setShowQueueModal(false);
            setQueueForm({ slug: '', name: '', description: '', config: '{}' });
            loadQueues(selectedGroup);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteQueue = async (groupSlug, queueSlug) => {
        const confirmed = await confirm({
            title: 'Delete Queue',
            message: `Are you sure you want to delete "${queueSlug}" and all its messages?`,
            variant: 'danger',
        });
        if (!confirmed) return;
        try {
            await api.deleteQueue(groupSlug, queueSlug);
            toast.success('Queue deleted');
            if (selectedQueue === queueSlug) {
                setSelectedQueue('');
                setMessages([]);
            }
            loadQueues(groupSlug);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        try {
            let payload = {};
            try {
                payload = JSON.parse(sendForm.payload);
            } catch {
                toast.error('Payload must be valid JSON');
                return;
            }
            await api.sendMessage(selectedGroup, selectedQueue, payload, {
                priority: parseInt(sendForm.priority, 10) || 0,
                delay_ms: parseInt(sendForm.delay_ms, 10) || 0,
            });
            toast.success('Message sent');
            setActiveTab('messages');
            setSendForm({ payload: '{}', priority: 0, delay_ms: 0 });
            loadMessages(selectedGroup, selectedQueue);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRequeueMessage = async (msg) => {
        try {
            await api.requeueMessage(msg.group_slug, msg.queue_slug, msg.id);
            toast.success('Message requeued');
            loadMessages(selectedGroup, selectedQueue);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteMessage = async (msg) => {
        const confirmed = await confirm({
            title: 'Delete Message',
            message: 'Permanently delete this message?',
            variant: 'danger',
        });
        if (!confirmed) return;
        try {
            await api.deleteMessage(msg.group_slug, msg.queue_slug, msg.id);
            toast.success('Message deleted');
            loadMessages(selectedGroup, selectedQueue);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const totalMessages = stats ? Object.values(stats.messages || {}).reduce((a, b) => a + b, 0) : 0;

    if (loading) {
        return (
            <div className="page-container queue-operations-page">
                <EmptyState loading size="lg" title="Loading queue bus..." />
            </div>
        );
    }

    return (
        <div className="page-container queue-operations-page">
            <PageTopbar
                icon={<Layers size={18} />}
                title="Queue Bus"
                actions={(
                    <Button variant="outline" size="sm" onClick={loadData}>
                        <RefreshCw size={14} className="mr-2" /> Refresh
                    </Button>
                )}
            />

            <div className="queue-kpis">
                <MetricCard label="Groups" value={groups.length} />
                <MetricCard label="Queues" value={groups.reduce((acc, g) => acc + (g.stats?.queues || 0), 0)} />
                <MetricCard label="Total Messages" value={totalMessages} />
                <MetricCard label="Dead Letter" value={stats?.messages?.dead_letter || 0} kind="danger" />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="queue-tabs">
                <TabsList>
                    <TabsTrigger value="overview"><Layers size={14} className="mr-2" /> Overview</TabsTrigger>
                    <TabsTrigger value="groups"><List size={14} className="mr-2" /> Groups</TabsTrigger>
                    <TabsTrigger value="messages"><Inbox size={14} className="mr-2" /> Messages</TabsTrigger>
                    <TabsTrigger value="send"><Send size={14} className="mr-2" /> Send Message</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="queue-tab-content">
                    {groups.length === 0 ? (
                        <EmptyState
                            icon={Layers}
                            title="No Queue Groups"
                            description="Create a group to start using the queue bus."
                            action={<Button onClick={() => setShowGroupModal(true)}><Plus size={14} className="mr-2" /> Create Group</Button>}
                        />
                    ) : (
                        <div className="queue-group-tree">
                            {groups.map(group => (
                                <div key={group.id} className="queue-group-card">
                                    <div className="queue-group-header">
                                        <span className="queue-group-name">{group.name}</span>
                                        <span className="queue-group-slug">/{group.slug}</span>
                                        <span className="queue-group-meta">{group.stats?.queues || 0} queues</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setSelectedGroup(group.slug);
                                                setActiveTab('messages');
                                                loadQueues(group.slug);
                                            }}
                                        >
                                            View Queues
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="groups" className="queue-tab-content">
                    <div className="queue-listhead">
                        <h2>Queue Groups</h2>
                        <Button size="sm" onClick={() => setShowGroupModal(true)}><Plus size={14} className="mr-2" /> Create Group</Button>
                    </div>
                    {groups.length === 0 ? (
                        <EmptyState
                            icon={Layers}
                            title="No Groups"
                            description="Create your first queue group."
                        />
                    ) : (
                        <table className="sk-dtable queue-table">
                            <thead>
                                <tr>
                                    <th>Group</th>
                                    <th>Slug</th>
                                    <th>Queues</th>
                                    <th>Owner</th>
                                    <th aria-label="Actions" />
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map(group => (
                                    <tr key={group.id}>
                                        <td>{group.name}</td>
                                        <td><code>{group.slug}</code></td>
                                        <td>{group.stats?.queues || 0}</td>
                                        <td>{group.owner_type}{group.owner_id ? `:${group.owner_id}` : ''}</td>
                                        <td>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setSelectedGroup(group.slug);
                                                    setActiveTab('messages');
                                                    loadQueues(group.slug);
                                                }}
                                            >
                                                View
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDeleteGroup(group.slug)}
                                            >
                                                <Trash2 size={14} />
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </TabsContent>

                <TabsContent value="messages" className="queue-tab-content">
                    <div className="queue-messages-toolbar">
                        <div className="queue-messages-selects">
                            <select
                                className="queue-select"
                                value={selectedGroup}
                                onChange={(e) => {
                                    setSelectedGroup(e.target.value);
                                    setSelectedQueue('');
                                    setQueues([]);
                                    setMessages([]);
                                    loadQueues(e.target.value);
                                }}
                            >
                                <option value="">Select group</option>
                                {groups.map(g => <option key={g.id} value={g.slug}>{g.name}</option>)}
                            </select>
                            <select
                                className="queue-select"
                                value={selectedQueue}
                                onChange={(e) => {
                                    setSelectedQueue(e.target.value);
                                    loadMessages(selectedGroup, e.target.value);
                                }}
                                disabled={!selectedGroup}
                            >
                                <option value="">Select queue</option>
                                {queues.map(q => <option key={q.id} value={q.slug}>{q.name}</option>)}
                            </select>
                            <select
                                className="queue-select"
                                value={messageFilter}
                                onChange={(e) => setMessageFilter(e.target.value)}
                            >
                                <option value="all">All statuses</option>
                                <option value="pending">Pending</option>
                                <option value="in_flight">In Flight</option>
                                <option value="completed">Completed</option>
                                <option value="failed">Failed</option>
                                <option value="dead_letter">Dead Letter</option>
                            </select>
                            {selectedGroup && selectedQueue && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteQueue(selectedGroup, selectedQueue)}
                                    title="Delete queue"
                                >
                                    <Trash2 size={14} />
                                </Button>
                            )}
                        </div>
                        <div className="queue-messages-actions">
                            <Button
                                size="sm"
                                disabled={!selectedGroup}
                                onClick={() => setShowQueueModal(true)}
                            >
                                <Plus size={14} className="mr-2" /> Create Queue
                            </Button>
                            <Button
                                size="sm"
                                disabled={!selectedGroup || !selectedQueue}
                                onClick={() => setActiveTab('send')}
                            >
                                <Send size={14} className="mr-2" /> Send Message
                            </Button>
                        </div>
                    </div>

                    {!selectedGroup || !selectedQueue ? (
                        <EmptyState icon={Inbox} title="Select a Queue" description="Choose a group and queue to browse messages." />
                    ) : messages.length === 0 ? (
                        <EmptyState icon={Inbox} title="No Messages" description="This queue is empty. Send a message to get started." />
                    ) : (
                        <table className="sk-dtable queue-table">
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Payload</th>
                                    <th>Attempts</th>
                                    <th>Created</th>
                                    <th aria-label="Actions" />
                                </tr>
                            </thead>
                            <tbody>
                                {messages.map(msg => (
                                    <tr key={msg.id} className="is-clickable" onClick={() => setSelectedMessage(msg)}>
                                        <td><Pill kind={STATUS_KINDS[msg.status] || 'gray'}>{msg.status}</Pill></td>
                                        <td><code className="queue-payload-preview">{JSON.stringify(msg.payload).slice(0, 80)}</code></td>
                                        <td>{msg.attempts} / {msg.max_attempts}</td>
                                        <td>{new Date(msg.created_at).toLocaleString()}</td>
                                        <td onClick={e => e.stopPropagation()}>
                                            <div className="queue-actions">
                                                {(msg.status === 'failed' || msg.status === 'dead_letter') && (
                                                    <Button variant="ghost" size="sm" onClick={() => handleRequeueMessage(msg)}>
                                                        <RefreshCw size={14} />
                                                    </Button>
                                                )}
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteMessage(msg)}>
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </TabsContent>

                <TabsContent value="send" className="queue-tab-content">
                    <div className="queue-send-card">
                        <div className="queue-messages-toolbar">
                            <div className="queue-messages-selects">
                                <select
                                    className="queue-select"
                                    value={selectedGroup}
                                    onChange={(e) => {
                                        setSelectedGroup(e.target.value);
                                        setSelectedQueue('');
                                        loadQueues(e.target.value);
                                    }}
                                >
                                    <option value="">Select group</option>
                                    {groups.map(g => <option key={g.id} value={g.slug}>{g.name}</option>)}
                                </select>
                                <select
                                    className="queue-select"
                                    value={selectedQueue}
                                    onChange={(e) => setSelectedQueue(e.target.value)}
                                    disabled={!selectedGroup}
                                >
                                    <option value="">Select queue</option>
                                    {queues.map(q => <option key={q.id} value={q.slug}>{q.name}</option>)}
                                </select>
                            </div>
                        </div>
                        {(!selectedGroup || !selectedQueue) ? (
                            <EmptyState icon={Send} title="Select a Queue" description="Choose a destination group and queue first." />
                        ) : (
                            <form onSubmit={handleSendMessage} className="queue-send-form">
                                <div className="form-group">
                                    <Label htmlFor="payload">Payload (JSON)</Label>
                                    <Textarea
                                        id="payload"
                                        value={sendForm.payload}
                                        onChange={(e) => setSendForm({ ...sendForm, payload: e.target.value })}
                                        rows={6}
                                        required
                                    />
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <Label htmlFor="priority">Priority</Label>
                                        <Input
                                            id="priority"
                                            type="number"
                                            value={sendForm.priority}
                                            onChange={(e) => setSendForm({ ...sendForm, priority: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <Label htmlFor="delay_ms">Delay (ms)</Label>
                                        <Input
                                            id="delay_ms"
                                            type="number"
                                            value={sendForm.delay_ms}
                                            onChange={(e) => setSendForm({ ...sendForm, delay_ms: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="form-actions">
                                    <Button type="submit"><Send size={14} className="mr-2" /> Send Message</Button>
                                </div>
                            </form>
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Create Group Modal */}
            {showGroupModal && (
                <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create Queue Group</h2>
                            <button className="modal-close" onClick={() => setShowGroupModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleCreateGroup}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <Label htmlFor="group-slug">Slug</Label>
                                    <Input id="group-slug" value={groupForm.slug} onChange={(e) => setGroupForm({ ...groupForm, slug: e.target.value })} required />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="group-name">Name</Label>
                                    <Input id="group-name" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} required />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="group-description">Description</Label>
                                    <Input id="group-description" value={groupForm.description} onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })} />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <Button type="button" variant="outline" onClick={() => setShowGroupModal(false)}>Cancel</Button>
                                <Button type="submit">Create Group</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Create Queue Modal */}
            {showQueueModal && (
                <div className="modal-overlay" onClick={() => setShowQueueModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create Queue</h2>
                            <button className="modal-close" onClick={() => setShowQueueModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleCreateQueue}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <Label htmlFor="queue-slug">Slug</Label>
                                    <Input id="queue-slug" value={queueForm.slug} onChange={(e) => setQueueForm({ ...queueForm, slug: e.target.value })} required />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="queue-name">Name</Label>
                                    <Input id="queue-name" value={queueForm.name} onChange={(e) => setQueueForm({ ...queueForm, name: e.target.value })} required />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="queue-description">Description</Label>
                                    <Input id="queue-description" value={queueForm.description} onChange={(e) => setQueueForm({ ...queueForm, description: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="queue-config">Config (JSON)</Label>
                                    <Textarea id="queue-config" value={queueForm.config} onChange={(e) => setQueueForm({ ...queueForm, config: e.target.value })} rows={4} />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <Button type="button" variant="outline" onClick={() => setShowQueueModal(false)}>Cancel</Button>
                                <Button type="submit">Create Queue</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Message Detail Modal */}
            {selectedMessage && (
                <div className="modal-overlay" onClick={() => setSelectedMessage(null)}>
                    <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Message Detail</h2>
                            <button className="modal-close" onClick={() => setSelectedMessage(null)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="queue-message-detail">
                                <div><strong>ID:</strong> <code>{selectedMessage.id}</code></div>
                                <div><strong>Status:</strong> <Pill kind={STATUS_KINDS[selectedMessage.status] || 'gray'}>{selectedMessage.status}</Pill></div>
                                <div><strong>Attempts:</strong> {selectedMessage.attempts} / {selectedMessage.max_attempts}</div>
                                <div><strong>Created:</strong> {new Date(selectedMessage.created_at).toLocaleString()}</div>
                                {selectedMessage.error_message && (
                                    <div className="queue-message-error"><strong>Error:</strong> {selectedMessage.error_message}</div>
                                )}
                                <div className="queue-message-section"><strong>Payload:</strong>
                                    <pre>{JSON.stringify(selectedMessage.payload, null, 2)}</pre>
                                </div>
                                {selectedMessage.result && (
                                    <div className="queue-message-section"><strong>Result:</strong>
                                        <pre>{JSON.stringify(selectedMessage.result, null, 2)}</pre>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button type="button" variant="outline" onClick={() => setSelectedMessage(null)}>Close</Button>
                            {(selectedMessage.status === 'failed' || selectedMessage.status === 'dead_letter') && (
                                <Button onClick={() => { handleRequeueMessage(selectedMessage); setSelectedMessage(null); }}>Requeue</Button>
                            )}
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

export default QueueOperations;
