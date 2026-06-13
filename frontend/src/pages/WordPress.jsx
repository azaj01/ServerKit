import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import wordpressApi from '../services/wordpress';
import { useToast } from '../contexts/ToastContext';
import { useResourceTier } from '../contexts/ResourceTierContext';
import ResourceGate from '../components/ResourceGate';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import { Globe, ChevronRight, Search } from 'lucide-react';
import { PageTopbar, Pill, SegControl, ServiceTile } from '@/components/ds';
import { WORDPRESS_TABS } from '../components/wordpress/wordpressTabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

function WordPress() {
    const [sites, setSites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTag, setActiveTag] = useState(null); // null = show all
    const [statusFilter, setStatusFilter] = useState('all'); // all | running | stopped
    const [siteSearch, setSiteSearch] = useState(''); // client-side name/title/domain filter
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [createForm, setCreateForm] = useState({
        name: '', adminEmail: '', phpVersion: '', enablePageCache: false, enableObjectCache: false,
    });
    const [createdCreds, setCreatedCreds] = useState(null);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const [importForm, setImportForm] = useState({ name: '', adminEmail: '', oldUrl: '' });
    const [importFile, setImportFile] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

    const navigate = useNavigate();
    const toast = useToast();
    const { isLiteTier } = useResourceTier();

    useEffect(() => {
        loadSites();
    }, []);

    const loadSites = async () => {
        setLoading(true);
        try {
            const data = await wordpressApi.getSites();
            setSites(data.sites || []);
        } catch (error) {
            console.error('Failed to load WordPress sites:', error);
            setSites([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!createForm.name) {
            toast.error('Site name is required');
            return;
        }

        setCreateLoading(true);
        try {
            const result = await wordpressApi.createSite(createForm);
            if (result.success) {
                if (result.admin_password) {
                    // The generated admin password is returned once — surface it.
                    setCreatedCreds({ user: result.admin_user || 'admin', password: result.admin_password });
                }
                if (result.warning) {
                    toast.info(result.warning, { duration: 8000 });
                }
                toast.success('WordPress site created successfully');
                setShowCreateModal(false);
                setCreateForm({ name: '', adminEmail: '', phpVersion: '', enablePageCache: false, enableObjectCache: false });
                await loadSites();
            } else {
                toast.error(result.error || 'Failed to create site');
            }
        } catch (error) {
            toast.error(`Failed to create site: ${error.message}`);
        } finally {
            setCreateLoading(false);
        }
    };

    // Bulk ops fan out per-site (no bulk route yet — §5); `applies` filters the
    // selection to sites the action makes sense for.
    const bulkRun = async (label, fn, applies = () => true) => {
        const targets = sites.filter(s => selectedIds.has(s.id) && applies(s));
        if (targets.length === 0) {
            toast.info(`No selected sites need "${label}"`);
            return;
        }
        setBulkLoading(true);
        try {
            const results = await Promise.allSettled(targets.map(s => fn(s)));
            const failed = results.filter(r => r.status === 'rejected').length;
            if (failed) toast.error(`${label}: ${failed} of ${targets.length} failed`);
            else toast.success(`${label} sent to ${targets.length} site${targets.length === 1 ? '' : 's'}`);
            setSelectedIds(new Set());
            await loadSites();
        } finally {
            setBulkLoading(false);
        }
    };

    const handleImport = async () => {
        if (!importForm.name) { toast.error('Site name is required'); return; }
        if (!importForm.oldUrl) { toast.error('Original site URL is required'); return; }
        if (!importFile) { toast.error('A .sql or .sql.gz dump is required'); return; }
        setImportLoading(true);
        try {
            const result = await wordpressApi.importSite({
                name: importForm.name,
                adminEmail: importForm.adminEmail,
                oldUrl: importForm.oldUrl,
                sqlFile: importFile,
            });
            if (result.success) {
                toast.success('WordPress site imported successfully');
                if (result.warning) toast.info(result.warning, { duration: 8000 });
                setShowImportModal(false);
                setImportForm({ name: '', adminEmail: '', oldUrl: '' });
                setImportFile(null);
                await loadSites();
            } else {
                toast.error(result.error || 'Failed to import site');
            }
        } catch (error) {
            toast.error(`Failed to import site: ${error.message}`);
        } finally {
            setImportLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="page-container wordpress-page">
                <PageTopbar icon={<Globe size={18} />} title="WordPress" tabs={WORDPRESS_TABS} />
                <div className="wp-sites-grid">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="wp-site-card-skeleton">
                            <div className="wp-site-card-skeleton-header">
                                <div className="wp-site-card-skeleton-icon" />
                                <div className="wp-site-card-skeleton-info">
                                    <div className="wp-site-card-skeleton-name" />
                                    <div className="wp-site-card-skeleton-url" />
                                </div>
                                <div className="wp-site-card-skeleton-status" />
                            </div>
                            <div className="wp-site-card-skeleton-body">
                                <div className="wp-site-card-skeleton-meta">
                                    <div className="wp-site-card-skeleton-label" />
                                    <div className="wp-site-card-skeleton-value" />
                                </div>
                                <div className="wp-site-card-skeleton-meta">
                                    <div className="wp-site-card-skeleton-label" />
                                    <div className="wp-site-card-skeleton-value" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Lite tier with no sites -> resource gate
    if (sites.length === 0 && isLiteTier) {
        return (
            <div className="page-container wordpress-page">
                <ResourceGate feature="wordpress_create">
                    <div />
                </ResourceGate>
            </div>
        );
    }

    return (
        <div className="page-container wordpress-page">
            <PageTopbar
                icon={<Globe size={18} />}
                title="WordPress"
                meta={sites.length > 0 && (
                    <>
                        {sites.length} site{sites.length === 1 ? '' : 's'}
                        {' · '}
                        <span className="wp-list__meta-running">
                            {sites.filter(s => s.status === 'running').length} running
                        </span>
                    </>
                )}
                tabs={WORDPRESS_TABS}
                actions={(
                    <>
                        <Button variant="outline" size="sm" onClick={() => setShowImportModal(true)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Import Site
                        </Button>
                        <Button size="sm" onClick={() => setShowCreateModal(true)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Create Site
                        </Button>
                    </>
                )}
            />

            {createdCreds && (
                <div className="wp-creds-banner">
                    <div className="wp-creds-banner-text">
                        <strong>Save these admin credentials — they are shown only once.</strong>
                        <span>Username: <code>{createdCreds.user}</code></span>
                        <span>Password: <code>{createdCreds.password}</code></span>
                    </div>
                    <Button variant="ghost" onClick={() => setCreatedCreds(null)}>Dismiss</Button>
                </div>
            )}

            {sites.length === 0 ? (
                <EmptyState
                    size="lg"
                    icon={Globe}
                    title="No WordPress Sites"
                    description="Create your first WordPress site powered by Docker. Each site gets its own isolated environment with MySQL."
                    action={
                        <Button onClick={() => setShowCreateModal(true)}>
                            Create Site
                        </Button>
                    }
                />
            ) : (() => {
                const allTags = Array.from(new Set(sites.flatMap(s => s.tags || []))).sort();
                const runningCount = sites.filter(s => s.status === 'running').length;
                const q = siteSearch.trim().toLowerCase();
                const siteLabel = site => site.name || site.application?.name || `Site ${site.id}`;
                const shownSites = sites.filter(site => (
                    (statusFilter === 'all'
                        || (statusFilter === 'running' ? site.status === 'running' : site.status !== 'running'))
                    && (activeTag === null || (site.tags || []).includes(activeTag))
                    && (q === '' || [siteLabel(site), site.title, site.url, site.domain]
                        .some(v => v && String(v).toLowerCase().includes(q)))
                ));
                return (
                    <div className="wp-list">
                        <div className="wp-list__toolbar">
                            <SegControl
                                value={statusFilter}
                                onChange={setStatusFilter}
                                options={[
                                    { value: 'all', label: 'All', count: sites.length },
                                    { value: 'running', label: 'Running', count: runningCount },
                                    { value: 'stopped', label: 'Stopped', count: sites.length - runningCount },
                                ]}
                            />
                            <div className="wp-list__search">
                                <Search size={15} aria-hidden="true" />
                                <input
                                    type="text"
                                    value={siteSearch}
                                    onChange={e => setSiteSearch(e.target.value)}
                                    placeholder="Search sites…"
                                    aria-label="Search sites"
                                />
                            </div>
                            {allTags.length > 0 && (
                                <div className="wp-tag-filter">
                                    <button
                                        className={`wp-tag-chip wp-tag-chip--filter ${activeTag === null ? 'is-active' : ''}`}
                                        onClick={() => setActiveTag(null)}
                                    >
                                        All tags
                                    </button>
                                    {allTags.map(tag => (
                                        <button
                                            key={tag}
                                            className={`wp-tag-chip wp-tag-chip--filter ${activeTag === tag ? 'is-active' : ''}`}
                                            onClick={() => setActiveTag(tag)}
                                        >
                                            {tag}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {selectedIds.size > 0 && (
                            <div className="wp-list__bulkbar">
                                <span className="wp-list__bulkcount">{selectedIds.size} selected</span>
                                <div className="wp-list__bulkactions">
                                    <Button variant="outline" size="sm" disabled={bulkLoading}
                                        onClick={() => bulkRun('Start', s => wordpressApi.unarchiveSite(s.id), s => s.status !== 'running')}>
                                        Start
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={bulkLoading}
                                        onClick={() => bulkRun('Stop', s => wordpressApi.archiveSite(s.id), s => s.status === 'running')}>
                                        Stop
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={bulkLoading}
                                        onClick={() => bulkRun('Update core', s => wordpressApi.updateCore(s.id), s => s.status === 'running')}>
                                        Update
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={bulkLoading}
                                        onClick={() => bulkRun('Backup', s => wordpressApi.createSnapshot(s.id, { name: 'bulk-backup' }), s => s.status === 'running')}>
                                        Backup
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={bulkLoading}
                                        onClick={() => bulkRun('Clear cache', s => wordpressApi.flushCache(s.id), s => s.status === 'running')}>
                                        Clear cache
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                                        Clear
                                    </Button>
                                </div>
                            </div>
                        )}

                        <div className="wp-list__card">
                            <table className="sk-dtable">
                                <thead>
                                    <tr>
                                        <th className="wp-list__ck">
                                            <Checkbox
                                                checked={shownSites.length > 0 && shownSites.every(s => selectedIds.has(s.id))}
                                                onCheckedChange={(checked) => {
                                                    setSelectedIds(checked ? new Set(shownSites.map(s => s.id)) : new Set());
                                                }}
                                                aria-label="Select all sites"
                                            />
                                        </th>
                                        <th>Site</th>
                                        <th>Environments</th>
                                        <th>Version</th>
                                        <th>Status</th>
                                        <th>Tags</th>
                                        <th style={{ width: 70 }} />
                                    </tr>
                                </thead>
                                <tbody>
                                    {shownSites.map(site => (
                                        <tr
                                            key={site.id}
                                            className={`is-clickable ${selectedIds.has(site.id) ? 'is-selected' : ''}`}
                                            onClick={() => navigate(`/wordpress/${site.id}`)}
                                        >
                                            <td className="wp-list__ck" onClick={e => e.stopPropagation()}>
                                                <Checkbox
                                                    checked={selectedIds.has(site.id)}
                                                    onCheckedChange={(checked) => {
                                                        setSelectedIds(prev => {
                                                            const next = new Set(prev);
                                                            if (checked) next.add(site.id);
                                                            else next.delete(site.id);
                                                            return next;
                                                        });
                                                    }}
                                                    aria-label={`Select ${site.name || `site ${site.id}`}`}
                                                />
                                            </td>
                                            <td>
                                                <div className="sk-cell-name">
                                                    <ServiceTile
                                                        name={siteLabel(site)}
                                                        size={30}
                                                        className="wp-list__tile"
                                                        aria-hidden="true"
                                                    />
                                                    <span>
                                                        <div>{siteLabel(site)}</div>
                                                        {site.port && <div className="sk-cell-sub">:{site.port}</div>}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="sk-cell-mono">{(site.environment_count || 0) + 1}</td>
                                            <td className="sk-cell-mono">WP {site.wp_version || '6.4'}</td>
                                            <td>
                                                <Pill kind={site.status === 'running' ? 'green' : 'gray'}>
                                                    {site.status === 'running' ? 'Running' : 'Stopped'}
                                                </Pill>
                                            </td>
                                            <td>
                                                {site.tags?.length
                                                    ? site.tags.map(tag => <span key={tag} className="sk-tag">{tag}</span>)
                                                    : <span className="wp-list__dash">—</span>}
                                            </td>
                                            <td>
                                                {site.url && site.status === 'running' ? (
                                                    <div className="wp-list__links" onClick={e => e.stopPropagation()}>
                                                        <a href={site.url} target="_blank" rel="noopener noreferrer" title="Open site" aria-label="Open site">
                                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                                        </a>
                                                        <a href={`${site.url}/wp-admin`} target="_blank" rel="noopener noreferrer" title="WP Admin" aria-label="WP Admin">
                                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                                                        </a>
                                                    </div>
                                                ) : (
                                                    <ChevronRight size={16} className="wp-list__chev" />
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })()}

            {/* Import Site Modal */}
            {showImportModal && (
                <div className="modal-overlay" onClick={() => !importLoading && setShowImportModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Import WordPress Site</h3>
                            <button className="modal-close" onClick={() => !importLoading && setShowImportModal(false)}>
                                &times;
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="install-warning">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                                <div>
                                    <strong>Imports a database dump into a new stack:</strong>
                                    <ul>
                                        <li>Provisions a fresh WordPress + MySQL container</li>
                                        <li>Loads your .sql / .sql.gz dump</li>
                                        <li>Rewrites the site URL to this server</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="form-group">
                                <Label>Site Name <span className="required">*</span></Label>
                                <Input
                                    type="text"
                                    value={importForm.name}
                                    onChange={e => setImportForm({ ...importForm, name: e.target.value })}
                                    placeholder="my-imported-site"
                                    disabled={importLoading}
                                />
                                <span className="form-hint">Used as the Docker project name. Letters, numbers, and hyphens only.</span>
                            </div>

                            <div className="form-group">
                                <Label>Original Site URL <span className="required">*</span></Label>
                                <Input
                                    type="text"
                                    value={importForm.oldUrl}
                                    onChange={e => setImportForm({ ...importForm, oldUrl: e.target.value })}
                                    placeholder="https://old-site.com"
                                    disabled={importLoading}
                                />
                                <span className="form-hint">The live URL in your dump; we rewrite it to the localhost address on this server.</span>
                            </div>

                            <div className="form-group">
                                <Label>Admin Email</Label>
                                <Input
                                    type="email"
                                    value={importForm.adminEmail}
                                    onChange={e => setImportForm({ ...importForm, adminEmail: e.target.value })}
                                    placeholder="admin@example.com"
                                    disabled={importLoading}
                                />
                            </div>

                            <div className="form-group">
                                <Label>Database Dump <span className="required">*</span></Label>
                                <input
                                    type="file"
                                    accept=".sql,.gz,.sql.gz"
                                    disabled={importLoading}
                                    onChange={e => setImportFile(e.target.files?.[0] || null)}
                                />
                                <span className="form-hint">Export via phpMyAdmin or the wp db export command. .sql.gz is supported and recommended (100MB upload limit).</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowImportModal(false)} disabled={importLoading}>
                                Cancel
                            </Button>
                            <Button onClick={handleImport} disabled={importLoading || !importForm.name || !importForm.oldUrl || !importFile}>
                                {importLoading ? <><Spinner size="sm" /> Importing...</> : 'Import Site'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Site Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => !createLoading && setShowCreateModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Create WordPress Site</h3>
                            <button className="modal-close" onClick={() => !createLoading && setShowCreateModal(false)}>
                                &times;
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="install-warning">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                                <div>
                                    <strong>This will create:</strong>
                                    <ul>
                                        <li>WordPress 6.4 (Apache) container</li>
                                        <li>MySQL 8.0 database container</li>
                                        <li>Isolated Docker network</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="form-group">
                                <Label>
                                    Site Name <span className="required">*</span>
                                </Label>
                                <Input
                                    type="text"
                                    value={createForm.name}
                                    onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                                    placeholder="my-wordpress-site"
                                    disabled={createLoading}
                                />
                                <span className="form-hint">Used as the Docker project name. Letters, numbers, and hyphens only.</span>
                            </div>

                            <div className="form-group">
                                <Label>Admin Email</Label>
                                <Input
                                    type="email"
                                    value={createForm.adminEmail}
                                    onChange={e => setCreateForm({ ...createForm, adminEmail: e.target.value })}
                                    placeholder="admin@example.com"
                                    disabled={createLoading}
                                />
                            </div>

                            <div className="form-group">
                                <Label>PHP Version</Label>
                                <select
                                    value={createForm.phpVersion}
                                    onChange={e => setCreateForm({ ...createForm, phpVersion: e.target.value })}
                                    disabled={createLoading}
                                >
                                    <option value="">Default (latest for WordPress 6.4)</option>
                                    <option value="8.1">PHP 8.1</option>
                                    <option value="8.2">PHP 8.2</option>
                                    <option value="8.3">PHP 8.3</option>
                                </select>
                                <span className="form-hint">Baked into the container image at creation. Changeable later from the PHP tab.</span>
                            </div>

                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={createForm.enablePageCache}
                                        onChange={e => setCreateForm({ ...createForm, enablePageCache: e.target.checked })}
                                        disabled={createLoading}
                                    />
                                    Enable full-page cache
                                </label>
                                <span className="form-hint">Disk page cache with WordPress-aware skip rules (admin, login, cart, checkout).</span>
                            </div>

                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={createForm.enableObjectCache}
                                        onChange={e => setCreateForm({ ...createForm, enableObjectCache: e.target.checked })}
                                        disabled={createLoading}
                                    />
                                    Enable Redis object cache
                                </label>
                                <span className="form-hint">Uses the bundled Redis container with the redis-cache drop-in.</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button
                                variant="outline"
                                onClick={() => setShowCreateModal(false)}
                                disabled={createLoading}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreate}
                                disabled={createLoading || !createForm.name}
                            >
                                {createLoading ? <><Spinner size="sm" /> Creating...</> : 'Create Site'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default WordPress;
