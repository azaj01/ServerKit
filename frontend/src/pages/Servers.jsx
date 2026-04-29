import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const Servers = () => {
    const [servers, setServers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [selectedStatus, setSelectedStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const toast = useToast();

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [serversData, groupsData] = await Promise.all([
                api.getServers(),
                api.getServerGroups()
            ]);
            setServers(Array.isArray(serversData) ? serversData : []);
            setGroups(Array.isArray(groupsData) ? groupsData : []);
        } catch (err) {
            console.error('Failed to load servers:', err);
            toast.error('Failed to load servers');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    async function handlePingServer(serverId) {
        try {
            const result = await api.pingServer(serverId);
            if (result.success) {
                toast.success(`Server responded in ${result.latency}ms`);
            } else {
                toast.error('Server did not respond');
            }
            loadData();
        } catch {
            toast.error('Failed to ping server');
        }
    }

    async function handleDeleteServer() {
        if (!deleteTarget) return;
        try {
            await api.deleteServer(deleteTarget.id);
            toast.success(`${deleteTarget.name} removed from fleet`);
            setSelectedIds(prev => {
                const next = new Set(prev);
                next.delete(deleteTarget.id);
                return next;
            });
            setDeleteTarget(null);
            loadData();
        } catch (err) {
            toast.error(err.message || 'Failed to delete server');
        }
    }

    async function handleBulkDelete() {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        const results = await Promise.allSettled(ids.map(id => api.deleteServer(id)));
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed === 0) {
            toast.success(`${ids.length} server${ids.length === 1 ? '' : 's'} deleted`);
        } else {
            toast.error(`${failed} of ${ids.length} could not be deleted`);
        }
        setSelectedIds(new Set());
        setBulkDeleteOpen(false);
        loadData();
    }

    async function handleCopyInstall(server) {
        try {
            const result = await api.generateRegistrationToken(server.id);
            const token = result?.registration_token || result?.token;
            if (!token) {
                toast.error('Could not generate install command');
                return;
            }
            const script = `curl -fsSL ${window.location.origin}/api/v1/servers/install.sh | sudo bash -s -- \\\n  --server "${window.location.origin}" \\\n  --token "${token}"`;
            await navigator.clipboard.writeText(script);
            toast.success('Install command copied to clipboard');
        } catch (err) {
            toast.error(err.message || 'Failed to generate install command');
        }
    }

    function toggleSelect(id) {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    function toggleSelectAll(visibleIds) {
        setSelectedIds(prev => {
            const allSelected = visibleIds.length > 0 && visibleIds.every(id => prev.has(id));
            if (allSelected) {
                const next = new Set(prev);
                visibleIds.forEach(id => next.delete(id));
                return next;
            }
            const next = new Set(prev);
            visibleIds.forEach(id => next.add(id));
            return next;
        });
    }

    const filteredServers = servers.filter(server => {
        const matchesGroup = selectedGroup === 'all' ||
            (selectedGroup === 'ungrouped' && !server.group_id) ||
            String(server.group_id) === String(selectedGroup);
        const matchesStatus = selectedStatus === 'all' || server.status === selectedStatus;
        const matchesSearch = !searchTerm ||
            server.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            server.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            server.ip_address?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesGroup && matchesStatus && matchesSearch;
    });

    const fleetStats = {
        total: servers.length,
        online: servers.filter(s => s.status === 'online').length,
        offline: servers.filter(s => s.status === 'offline').length,
        connecting: servers.filter(s => s.status === 'connecting').length,
        pending: servers.filter(s => s.status === 'pending').length
    };
    const availability = fleetStats.total > 0 ? Math.round((fleetStats.online / fleetStats.total) * 100) : 0;
    const hasActiveFilters = selectedGroup !== 'all' || selectedStatus !== 'all' || Boolean(searchTerm);
    const statCards = [
        {
            key: 'all',
            label: 'Total',
            value: fleetStats.total,
            detail: `${groups.length} group${groups.length === 1 ? '' : 's'}`,
            icon: <ServerIcon />,
        },
        {
            key: 'online',
            label: 'Online',
            value: fleetStats.online,
            detail: `${availability}% available`,
            icon: <CheckCircleIcon />,
        },
        {
            key: 'offline',
            label: 'Offline',
            value: fleetStats.offline,
            detail: 'Needs attention',
            icon: <XCircleIcon />,
        },
        {
            key: 'connecting',
            label: 'Connecting',
            value: fleetStats.connecting,
            detail: `${fleetStats.pending} pending`,
            icon: <RefreshIcon />,
        }
    ];

    if (loading) {
        return (
            <div className="servers-page servers-page--loading">
                <div className="servers-loading-card">
                    <ServerIcon />
                    <span>Scanning fleet...</span>
                </div>
            </div>
        );
    }

    const visibleIds = filteredServers.map(s => s.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    const someVisibleSelected = visibleIds.some(id => selectedIds.has(id));

    return (
        <div className="servers-page">
            <header className="servers-header">
                <div className="servers-header__title">
                    <h1>Servers</h1>
                    <p>{servers.length} {servers.length === 1 ? 'machine' : 'machines'} · {fleetStats.online} online · {availability}% availability</p>
                </div>
                <div className="servers-header__actions">
                    <Button variant="outline" onClick={() => setShowGroupModal(true)}>
                        <FolderIcon /> Groups
                    </Button>
                    <Button onClick={() => setShowAddModal(true)}>
                        <PlusIcon /> Add Server
                    </Button>
                </div>
            </header>

            <div className="servers-stats">
                {statCards.map(stat => (
                    <button
                        key={stat.key}
                        type="button"
                        className={`stat-card stat-card--${stat.key} ${selectedStatus === stat.key ? 'active' : ''}`}
                        onClick={() => setSelectedStatus(stat.key)}
                        aria-pressed={selectedStatus === stat.key}
                    >
                        <span className={`stat-icon ${stat.key}`}>{stat.icon}</span>
                        <span className="stat-content">
                            <span className="stat-label">{stat.label}</span>
                            <span className="stat-value">{stat.value}</span>
                            <span className="stat-detail">{stat.detail}</span>
                        </span>
                    </button>
                ))}
            </div>

            <div className="servers-command-bar">
                <div className="servers-toolbar">
                    <label className="search-box">
                        <SearchIcon />
                        <Input
                            type="text"
                            placeholder="Search by name, host, or IP..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </label>
                    <div className="group-filter">
                        <span>Group</span>
                        <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
                            <option value="all">All Groups</option>
                            {groups.map(group => (
                                <option key={group.id} value={group.id}>{group.name}</option>
                            ))}
                            <option value="ungrouped">Ungrouped</option>
                        </select>
                    </div>
                </div>

                <div className="servers-results-summary">
                    <strong>{filteredServers.length}</strong>
                    <span>{filteredServers.length === 1 ? 'server' : 'servers'}</span>
                    {hasActiveFilters && (
                        <button
                            type="button"
                            className="servers-clear-filters"
                            onClick={() => {
                                setSelectedGroup('all');
                                setSelectedStatus('all');
                                setSearchTerm('');
                            }}
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            {selectedIds.size > 0 && (
                <div className="servers-bulk-bar" role="region" aria-label="Bulk actions">
                    <div className="servers-bulk-bar__info">
                        <span className="servers-bulk-bar__count">{selectedIds.size}</span>
                        <span>selected</span>
                    </div>
                    <div className="servers-bulk-bar__actions">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                            Clear selection
                        </Button>
                        <Button type="button" variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                            <TrashIcon /> Delete {selectedIds.size}
                        </Button>
                    </div>
                </div>
            )}

            {filteredServers.length === 0 ? (
                <div className="empty-state servers-empty-state">
                    <div className="servers-empty-state__icon">
                        <ServerIcon className="empty-icon" />
                    </div>
                    <h3>{servers.length === 0 ? 'No servers yet' : 'No servers match these filters'}</h3>
                    <p>
                        {servers.length === 0
                            ? 'Install a ServerKit agent on a machine to start monitoring health and managing Docker remotely.'
                            : 'Try a different status, group, or search term to bring machines back into view.'}
                    </p>
                    {servers.length === 0 ? (
                        <Button onClick={() => setShowAddModal(true)}>
                            <PlusIcon /> Add your first server
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                setSelectedGroup('all');
                                setSelectedStatus('all');
                                setSearchTerm('');
                            }}
                        >
                            Clear filters
                        </Button>
                    )}
                </div>
            ) : (
                <div className="servers-table-wrap">
                    <table className="servers-table">
                        <thead>
                            <tr>
                                <th className="col-check">
                                    <input
                                        type="checkbox"
                                        aria-label="Select all visible servers"
                                        checked={allVisibleSelected}
                                        ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                                        onChange={() => toggleSelectAll(visibleIds)}
                                    />
                                </th>
                                <th>Server</th>
                                <th>Status</th>
                                <th>Group</th>
                                <th>OS · Agent</th>
                                <th>Telemetry</th>
                                <th>Last seen</th>
                                <th className="col-actions" aria-label="Actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {filteredServers.map(server => (
                                <ServerRow
                                    key={server.id}
                                    server={server}
                                    selected={selectedIds.has(server.id)}
                                    onToggle={() => toggleSelect(server.id)}
                                    onPing={() => handlePingServer(server.id)}
                                    onDelete={() => setDeleteTarget(server)}
                                    onCopyInstall={() => handleCopyInstall(server)}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showAddModal && (
                <AddServerModal
                    groups={groups}
                    onClose={() => setShowAddModal(false)}
                    onCreated={() => {
                        setShowAddModal(false);
                        loadData();
                    }}
                />
            )}

            {showGroupModal && (
                <ManageGroupsModal
                    groups={groups}
                    onClose={() => setShowGroupModal(false)}
                    onUpdated={loadData}
                />
            )}

            <ConfirmDialog
                isOpen={Boolean(deleteTarget)}
                title={`Delete ${deleteTarget?.name || 'server'}?`}
                message="This removes the server from your fleet and revokes its agent token. The agent on the host will stop reporting."
                requireConfirmation={deleteTarget?.name}
                confirmText="Delete server"
                variant="danger"
                onConfirm={handleDeleteServer}
                onCancel={() => setDeleteTarget(null)}
            />

            <ConfirmDialog
                isOpen={bulkDeleteOpen}
                title={`Delete ${selectedIds.size} server${selectedIds.size === 1 ? '' : 's'}?`}
                message="All selected servers will be removed from the fleet and their agent tokens revoked. This cannot be undone."
                requireConfirmation="DELETE"
                confirmText={`Delete ${selectedIds.size} server${selectedIds.size === 1 ? '' : 's'}`}
                variant="danger"
                onConfirm={handleBulkDelete}
                onCancel={() => setBulkDeleteOpen(false)}
            />
        </div>
    );
};

const formatLastSeen = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
};

const clamp = (v) => Math.min(100, Math.max(0, Number(v) || 0));

const ServerRow = ({ server, selected, onToggle, onPing, onDelete, onCopyInstall }) => {
    const [menuPos, setMenuPos] = useState(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);

    const closeMenu = useCallback(() => setMenuPos(null), []);

    const openMenu = () => {
        const r = triggerRef.current?.getBoundingClientRect();
        if (!r) return;
        const menuHeight = 240;
        const menuWidth = 220;
        const flipUp = r.bottom + menuHeight + 8 > window.innerHeight;
        setMenuPos({
            top: flipUp ? r.top - menuHeight - 4 : r.bottom + 4,
            left: Math.max(8, r.right - menuWidth),
        });
    };

    useEffect(() => {
        if (!menuPos) return undefined;
        const onDocDown = (e) => {
            if (
                menuRef.current && !menuRef.current.contains(e.target) &&
                triggerRef.current && !triggerRef.current.contains(e.target)
            ) {
                closeMenu();
            }
        };
        const onScroll = () => closeMenu();
        document.addEventListener('mousedown', onDocDown);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
            document.removeEventListener('mousedown', onDocDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    }, [menuPos, closeMenu]);

    const status = server.status || 'pending';
    const displayHost = server.hostname || server.ip_address || 'Unassigned endpoint';
    const initial = (server.name || displayHost || '?').charAt(0).toUpperCase();
    const metrics = {
        cpu: clamp(server.metrics?.cpu_percent),
        memory: clamp(server.metrics?.memory_percent),
        disk: clamp(server.metrics?.disk_percent),
    };
    const hasMetrics = server.metrics && status === 'online';

    return (
        <tr className={`server-row server-row--${status} ${selected ? 'is-selected' : ''}`}>
            <td className="col-check">
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={onToggle}
                    aria-label={`Select ${server.name}`}
                />
            </td>
            <td>
                <Link to={`/servers/${server.id}`} className="server-row__name">
                    <span className={`server-row__avatar server-row__avatar--${status}`} aria-hidden="true">{initial}</span>
                    <span className="server-row__identity">
                        <span className="server-row__title">{server.name}</span>
                        <span className="server-row__sub">{displayHost}</span>
                    </span>
                </Link>
            </td>
            <td>
                <span className={`status-pill status-pill--${status}`}>
                    <span className="status-pill__dot" />
                    {status}
                </span>
            </td>
            <td>
                {server.group_name ? (
                    <span className="server-row__group">
                        <FolderIcon size={12} />
                        {server.group_name}
                    </span>
                ) : (
                    <span className="muted">—</span>
                )}
            </td>
            <td>
                <div className="server-row__stack">
                    <span>{server.os_type || 'Unknown'}</span>
                    <span className="muted">{server.agent_version ? `agent ${server.agent_version}` : 'agent not installed'}</span>
                </div>
            </td>
            <td>
                {hasMetrics ? (
                    <div className="server-row__telemetry">
                        <span title={`CPU ${metrics.cpu.toFixed(0)}%`}>
                            <em>CPU</em>
                            <span className="bar"><span className="bar-fill cpu" style={{ width: `${metrics.cpu}%` }} /></span>
                            <b>{metrics.cpu.toFixed(0)}%</b>
                        </span>
                        <span title={`RAM ${metrics.memory.toFixed(0)}%`}>
                            <em>RAM</em>
                            <span className="bar"><span className="bar-fill memory" style={{ width: `${metrics.memory}%` }} /></span>
                            <b>{metrics.memory.toFixed(0)}%</b>
                        </span>
                        <span title={`Disk ${metrics.disk.toFixed(0)}%`}>
                            <em>DSK</em>
                            <span className="bar"><span className="bar-fill disk" style={{ width: `${metrics.disk}%` }} /></span>
                            <b>{metrics.disk.toFixed(0)}%</b>
                        </span>
                    </div>
                ) : (
                    <span className="muted">{status === 'pending' ? 'Awaiting agent' : status === 'offline' ? 'Offline' : 'No data'}</span>
                )}
            </td>
            <td>
                <span className="server-row__lastseen">{formatLastSeen(server.last_seen)}</span>
            </td>
            <td className="col-actions">
                <div className="row-actions">
                    <button type="button" className="row-actions__icon" onClick={onPing} title="Ping server" aria-label={`Ping ${server.name}`}>
                        <RefreshIcon />
                    </button>
                    <Link to={`/servers/${server.id}/docker`} className="row-actions__icon" title="Open Docker" aria-label={`Open Docker for ${server.name}`}>
                        <DockerIcon />
                    </Link>
                    <button
                        ref={triggerRef}
                        type="button"
                        className="row-actions__icon"
                        onClick={() => (menuPos ? closeMenu() : openMenu())}
                        aria-haspopup="menu"
                        aria-expanded={Boolean(menuPos)}
                        title="More actions"
                    >
                        <MoreIcon />
                    </button>
                    {menuPos && (
                        <div
                            ref={menuRef}
                            className="row-menu"
                            role="menu"
                            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                        >
                            <Link to={`/servers/${server.id}`} className="row-menu__item" role="menuitem" onClick={closeMenu}>
                                <EyeIcon /> View details
                            </Link>
                            <button type="button" className="row-menu__item" role="menuitem" onClick={() => { closeMenu(); onPing(); }}>
                                <RefreshIcon /> Ping now
                            </button>
                            {status === 'pending' && (
                                <button type="button" className="row-menu__item" role="menuitem" onClick={() => { closeMenu(); onCopyInstall(); }}>
                                    <CopyIcon /> Copy install command
                                </button>
                            )}
                            <Link to={`/servers/${server.id}/docker`} className="row-menu__item" role="menuitem" onClick={closeMenu}>
                                <DockerIcon /> Manage Docker
                            </Link>
                            <div className="row-menu__divider" />
                            <button type="button" className="row-menu__item row-menu__item--danger" role="menuitem" onClick={() => { closeMenu(); onDelete(); }}>
                                <TrashIcon /> Delete server
                            </button>
                        </div>
                    )}
                </div>
            </td>
        </tr>
    );
};

const PairAgentForm = ({ groups, onClose, onClaimed }) => {
    const [pairCode, setPairCode] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [name, setName] = useState('');
    const [groupId, setGroupId] = useState('');
    const [lookupResult, setLookupResult] = useState(null);
    const [lookupError, setLookupError] = useState('');
    const [claimError, setClaimError] = useState('');
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    const formattedCode = pairCode
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .replace(/[01OIL]/g, '')
        .slice(0, 6);

    async function handleLookup() {
        setLookupError('');
        setLookupResult(null);
        if (formattedCode.length === 0) return;
        if (formattedCode.length !== 6) {
            setLookupError('Pair code must be 6 characters');
            return;
        }
        setLoading(true);
        try {
            const res = await api.lookupPairCode(formattedCode);
            setLookupResult(res);
            const suggestedName = res.system_info?.hostname;
            if (!name && suggestedName) setName(suggestedName);
        } catch (err) {
            setLookupError(err.message || 'Pair code not found');
        } finally {
            setLoading(false);
        }
    }

    async function handleClaim(e) {
        e.preventDefault();
        setClaimError('');
        if (!passphrase) {
            setClaimError('Passphrase is required');
            return;
        }
        setLoading(true);
        try {
            await api.claimPairedAgent({
                pair_code: formattedCode,
                passphrase,
                name: name || undefined,
                group_id: groupId || undefined,
                trust_fingerprint: true
            });
            toast.success('Agent paired successfully');
            onClaimed();
        } catch (err) {
            setClaimError(err.message || 'Failed to claim agent');
        } finally {
            setLoading(false);
        }
    }

    function formatDisplay(code) {
        if (!code) return '------';
        return code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
    }

    return (
        <form className="server-setup-form" onSubmit={handleClaim}>
            <div className="server-setup-form__body">
                <div className="pair-instructions">
                    <p>
                        On the target machine run <code>serverkit-agent pair</code>. It prints a&nbsp;6-character code — enter it below. Then supply the passphrase you chose when starting pairing.
                    </p>
                </div>

                <div className="form-group">
                    <label>Pair code</label>
                    <Input
                        type="text"
                        value={formatDisplay(formattedCode)}
                        onChange={(e) => {
                            setPairCode(e.target.value);
                            setLookupResult(null);
                            setLookupError('');
                        }}
                        onBlur={handleLookup}
                        placeholder="ABC-123"
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace', fontSize: '1.25rem', letterSpacing: '0.15em', textAlign: 'center' }}
                        required
                    />
                    <span className="form-hint">The code is shown in the terminal output or system tray.</span>
                    {lookupError && <div className="error-message" style={{ marginTop: '0.5rem' }}>{lookupError}</div>}
                </div>

                {lookupResult && (
                    <div className="success-banner" style={{ marginTop: '0.5rem' }}>
                        <div>
                            <strong>Agent found</strong>
                            <p className="success-subtitle">
                                Hostname: <code>{lookupResult.system_info?.hostname || 'unknown'}</code><br />
                                Fingerprint: <code style={{ fontFamily: 'monospace' }}>{lookupResult.pubkey_fpr}</code>
                            </p>
                            <p className="text-muted" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
                                Confirm this fingerprint matches the one shown by the agent before continuing.
                            </p>
                        </div>
                    </div>
                )}

                <div className="form-group">
                    <label>Passphrase *</label>
                    <Input
                        type="password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder="The passphrase set when pairing started"
                        autoComplete="new-password"
                        required
                    />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Server name</label>
                        <Input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={lookupResult?.system_info?.hostname || 'Auto-detected from agent (optional)'}
                        />
                        <span className="form-hint">Leave blank to use the agent's hostname.</span>
                    </div>
                    <div className="form-group">
                        <label>Group</label>
                        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                            <option value="">No Group</option>
                            {groups.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {claimError && <div className="error-message">{claimError}</div>}
            </div>

            <div className="modal-actions">
                <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                <Button type="submit" disabled={loading || formattedCode.length !== 6}>
                    {loading ? 'Pairing…' : 'Pair Agent'}
                </Button>
            </div>
        </form>
    );
};

const AddServerModal = ({ groups, onClose, onCreated }) => {
    const [mode, setMode] = useState('pair');
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        group_id: '',
        hostname: '',
        ip_address: '',
        permission_profile: 'deployment_runner',
        permissions: []
    });
    const [showOptional, setShowOptional] = useState(false);
    const [registrationData, setRegistrationData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const toast = useToast();

    async function handleCreateServer(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await api.createServer(formData);
            setRegistrationData(result);
            setStep(2);
        } catch (err) {
            setError(err.message || 'Failed to create server');
        } finally {
            setLoading(false);
        }
    }

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    }

    const linuxInstallScript = registrationData ? `curl -fsSL ${window.location.origin}/api/v1/servers/install.sh | sudo bash -s -- \\
  --server "${window.location.origin}" \\
  --token "${registrationData.registration_token}"` : '';

    const windowsInstallScript = registrationData ? `irm ${window.location.origin}/api/v1/servers/install.ps1 | iex
Install-ServerKitAgent -Server "${window.location.origin}" -Token "${registrationData.registration_token}"` : '';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal server-setup-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h2>{step === 1 ? 'Add Server' : (mode === 'pair' ? 'Pair Agent' : 'Install Agent')}</h2>
                        <p>
                            {step === 2 && mode !== 'pair'
                                ? 'Run one command on the target machine to bring it online.'
                                : step === 2
                                ? 'Enter the 6-char code shown on the agent and your passphrase.'
                                : 'Connect an existing agent or set up a brand-new machine.'}
                        </p>
                    </div>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {step === 1 && (
                    <div className="mode-switcher">
                        <button
                            type="button"
                            className={`mode-switcher__tab${mode === 'pair' ? ' is-active' : ''}`}
                            onClick={() => setMode('pair')}
                        >
                            Pair existing agent
                        </button>
                        <button
                            type="button"
                            className={`mode-switcher__tab${mode === 'install' ? ' is-active' : ''}`}
                            onClick={() => setMode('install')}
                        >
                            Install new agent
                        </button>
                    </div>
                )}

                {step === 1 && mode === 'pair' ? (
                    <PairAgentForm
                        groups={groups}
                        onClose={onClose}
                        onClaimed={onCreated}
                    />
                ) : step === 1 ? (
                    <form className="server-setup-form" onSubmit={handleCreateServer}>
                        <div className="server-setup-form__body">
                            {error && <div className="error-message">{error}</div>}

                            <div className="form-group">
                                <label>Server Name *</label>
                                <Input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    placeholder="prod-web-01"
                                    autoFocus
                                    required
                                />
                                <span className="form-hint">A friendly label. The agent itself reports the real hostname when it connects.</span>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Group</label>
                                    <select name="group_id" value={formData.group_id} onChange={handleChange}>
                                        <option value="">No Group</option>
                                        {groups.map(group => (
                                            <option key={group.id} value={group.id}>{group.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Access Profile</label>
                                    <select name="permission_profile" value={formData.permission_profile} onChange={handleChange}>
                                        <option value="deployment_runner">Deployment Runner</option>
                                        <option value="docker_manager">Docker Manager</option>
                                        <option value="docker_readonly">Docker Read-Only</option>
                                        <option value="full_access">Full Access</option>
                                    </select>
                                </div>
                            </div>

                            <button
                                type="button"
                                className="form-disclosure"
                                onClick={() => setShowOptional(v => !v)}
                                aria-expanded={showOptional}
                            >
                                <span className={`form-disclosure__chevron${showOptional ? ' is-open' : ''}`}>›</span>
                                Optional details
                                <span className="form-disclosure__hint">description, hostname, IP</span>
                            </button>

                            {showOptional && (
                                <div className="form-disclosure__panel">
                                    <div className="form-group">
                                        <label>Description</label>
                                        <textarea
                                            name="description"
                                            value={formData.description}
                                            onChange={handleChange}
                                            placeholder="What this server is used for…"
                                            rows={2}
                                        />
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Hostname</label>
                                            <Input
                                                type="text"
                                                name="hostname"
                                                value={formData.hostname}
                                                onChange={handleChange}
                                                placeholder="server.example.com"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>IP Address</label>
                                            <Input
                                                type="text"
                                                name="ip_address"
                                                value={formData.ip_address}
                                                onChange={handleChange}
                                                placeholder="192.168.1.100"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-actions">
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading ? 'Creating…' : 'Create & Get Install Script'}
                            </Button>
                        </div>
                    </form>
                ) : (
                    <div className="install-instructions">
                        <div className="install-instructions__scroll">
                            <div className="success-banner">
                                <CheckCircleIcon />
                                <div>
                                    <strong>Agent token created</strong>
                                    <p className="success-subtitle">Run the install script on your target machine to connect the agent.</p>
                                </div>
                            </div>

                            <div className="install-tabs">
                                <InstallTab
                                    title="Linux"
                                    description="Linux server with curl, tar, sudo, and systemd"
                                    icon={<TerminalIcon />}
                                    script={linuxInstallScript}
                                    onCopy={() => copyToClipboard(linuxInstallScript)}
                                />
                                <InstallTab
                                    title="Windows (PowerShell)"
                                    description="Run as Administrator"
                                    icon={<WindowsIcon />}
                                    script={windowsInstallScript}
                                    onCopy={() => copyToClipboard(windowsInstallScript)}
                                />
                            </div>

                            <div className="install-info">
                                <h4>What happens next?</h4>
                                <ol>
                                    <li>Copy and run the install script on your server</li>
                                    <li>The agent downloads, installs, and registers automatically</li>
                                    <li>Your server will appear as <strong>Pending</strong> until the agent connects, then switch to <strong>Online</strong></li>
                                </ol>
                                <p className="text-muted">
                                    The registration token expires in 24 hours. You can regenerate it from the server details page.
                                </p>
                            </div>
                        </div>

                        <div className="modal-actions">
                            <Button onClick={onCreated}>
                                Close
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const InstallTab = ({ title, description, icon, script, onCopy }) => {
    return (
        <div className="install-tab">
            <div className="install-tab-header">
                {icon}
                <div className="install-tab-title">
                    <span>{title}</span>
                    {description && <span className="install-tab-description">{description}</span>}
                </div>
                <Button variant="outline" size="sm" onClick={onCopy}>
                    <CopyIcon /> Copy
                </Button>
            </div>
            <pre className="install-script">{script}</pre>
        </div>
    );
};

const ManageGroupsModal = ({ groups, onClose, onUpdated }) => {
    const [groupList, setGroupList] = useState(groups);
    const [newGroupName, setNewGroupName] = useState('');
    const [editingGroup, setEditingGroup] = useState(null);
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    async function handleCreateGroup(e) {
        e.preventDefault();
        if (!newGroupName.trim()) return;

        setLoading(true);
        try {
            await api.createServerGroup({ name: newGroupName.trim() });
            setNewGroupName('');
            toast.success('Group created');
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err.message || 'Failed to create group');
        } finally {
            setLoading(false);
        }
    }

    async function handleUpdateGroup(groupId, newName) {
        try {
            await api.updateServerGroup(groupId, { name: newName });
            toast.success('Group updated');
            setEditingGroup(null);
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err.message || 'Failed to update group');
        }
    }

    async function handleDeleteGroup(groupId) {
        if (!confirm('Delete this group? Servers in this group will become ungrouped.')) return;

        try {
            await api.deleteServerGroup(groupId);
            toast.success('Group deleted');
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err.message || 'Failed to delete group');
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Manage Server Groups</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleCreateGroup} className="group-form">
                    <Input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="New group name..."
                        disabled={loading}
                    />
                    <Button type="submit" disabled={loading || !newGroupName.trim()}>
                        <PlusIcon /> Add
                    </Button>
                </form>

                <div className="groups-list">
                    {groupList.length === 0 ? (
                        <div className="empty-groups">No groups created yet</div>
                    ) : (
                        groupList.map(group => (
                            <div key={group.id} className="group-item">
                                {editingGroup === group.id ? (
                                    <Input
                                        type="text"
                                        defaultValue={group.name}
                                        onBlur={(e) => handleUpdateGroup(group.id, e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleUpdateGroup(group.id, e.target.value);
                                            if (e.key === 'Escape') setEditingGroup(null);
                                        }}
                                        autoFocus
                                    />
                                ) : (
                                    <>
                                        <span className="group-name">
                                            <FolderIcon size={14} />
                                            {group.name}
                                        </span>
                                        <span className="group-count">{group.server_count || 0} servers</span>
                                        <div className="group-actions">
                                            <button
                                                className="btn-icon"
                                                onClick={() => setEditingGroup(group.id)}
                                                title="Edit"
                                            >
                                                <EditIcon />
                                            </button>
                                            <button
                                                className="btn-icon danger"
                                                onClick={() => handleDeleteGroup(group.id)}
                                                title="Delete"
                                            >
                                                <TrashIcon />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="modal-actions">
                    <Button onClick={onClose}>Done</Button>
                </div>
            </div>
        </div>
    );
};

// Icons
const ServerIcon = ({ size = 24, className = '' }) => (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
        <line x1="6" y1="6" x2="6.01" y2="6"/>
        <line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
);

const PlusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
);

const FolderIcon = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
);

const SearchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
);

const CheckCircleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
);

const XCircleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
);

const RefreshIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
);

const EyeIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
);

const DockerIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="5" height="5" rx="1"/>
        <rect x="9" y="7" width="5" height="5" rx="1"/>
        <rect x="16" y="7" width="5" height="5" rx="1"/>
        <rect x="2" y="14" width="5" height="5" rx="1"/>
        <rect x="9" y="14" width="5" height="5" rx="1"/>
    </svg>
);

const TerminalIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
);

const WindowsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
);

const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
);

const EditIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
);

const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
);

const MoreIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="1.6"/>
        <circle cx="12" cy="12" r="1.6"/>
        <circle cx="19" cy="12" r="1.6"/>
    </svg>
);

export default Servers;
