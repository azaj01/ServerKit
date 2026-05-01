import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const Marketplace = () => {
    const toast = useToast();
    const { user } = useAuth();
    const [extensions, setExtensions] = useState([]);
    const [myExtensions, setMyExtensions] = useState([]);
    const [plugins, setPlugins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('');
    const [showSubmit, setShowSubmit] = useState(false);
    const [pluginUrl, setPluginUrl] = useState('');
    const [pluginPath, setPluginPath] = useState('');
    const [pluginFile, setPluginFile] = useState(null);
    const [installSource, setInstallSource] = useState('url');
    const [installing, setInstalling] = useState(false);
    const [form, setForm] = useState({ name: '', display_name: '', description: '', category: 'utility', version: '1.0.0', author: '' });

    const categories = ['monitoring', 'security', 'deployment', 'integration', 'ui', 'utility'];

    const loadExtensions = useCallback(async () => {
        try {
            const [eData, mData, pData] = await Promise.all([
                api.getMarketplaceExtensions(category, search),
                api.getMyExtensions(),
                api.getInstalledPlugins().catch(() => ({ plugins: [] })),
            ]);
            setExtensions(eData.extensions || []);
            setMyExtensions(mData.extensions || []);
            setPlugins(pData.plugins || []);
        } catch (err) {
            toast.error('Failed to load extensions');
        } finally {
            setLoading(false);
        }
    }, [category, search, toast]);

    useEffect(() => { loadExtensions(); }, [loadExtensions]);

    const handleInstall = async (extId) => {
        try {
            await api.installMarketplaceExtension(extId);
            toast.success('Extension installed');
            loadExtensions();
        } catch (err) { toast.error(err.message); }
    };

    const handleUninstall = async (installId) => {
        try {
            await api.uninstallMarketplaceExtension(installId);
            toast.success('Extension uninstalled');
            loadExtensions();
        } catch (err) { toast.error(err.message); }
    };

    const handlePluginInstall = async () => {
        let action;
        if (installSource === 'url') {
            if (!pluginUrl.trim()) return;
            action = () => api.installPlugin(pluginUrl.trim());
        } else if (installSource === 'path') {
            if (!pluginPath.trim()) return;
            action = () => api.installPluginFromPath(pluginPath.trim());
        } else if (installSource === 'upload') {
            if (!pluginFile) return;
            action = () => api.installPluginFromZip(pluginFile);
        } else {
            return;
        }

        setInstalling(true);
        try {
            const result = await action();
            toast.success(`Plugin "${result.display_name}" installed. Restart backend to activate routes.`);
            setPluginUrl('');
            setPluginPath('');
            setPluginFile(null);
            loadExtensions();
        } catch (err) {
            toast.error(err.message || 'Plugin installation failed');
        } finally {
            setInstalling(false);
        }
    };

    const handlePluginUninstall = async (pluginId) => {
        try {
            await api.uninstallPlugin(pluginId);
            toast.success('Plugin uninstalled');
            loadExtensions();
        } catch (err) { toast.error(err.message); }
    };

    const handlePluginToggle = async (plugin) => {
        try {
            if (plugin.status === 'active') {
                await api.disablePlugin(plugin.id);
                toast.success('Plugin disabled');
            } else {
                await api.enablePlugin(plugin.id);
                toast.success('Plugin enabled');
            }
            loadExtensions();
        } catch (err) { toast.error(err.message); }
    };

    const handleSubmit = async () => {
        try {
            await api.createMarketplaceExtension(form);
            toast.success('Extension submitted');
            setShowSubmit(false);
            loadExtensions();
        } catch (err) { toast.error(err.message); }
    };

    const renderStars = (rating) => {
        const full = Math.floor(rating);
        return '★'.repeat(full) + '☆'.repeat(5 - full);
    };

    const pluginStatusVariant = (status) => {
        if (status === 'active') return 'success';
        if (status === 'error') return 'destructive';
        return 'outline';
    };

    if (loading) return <Spinner />;

    const installedIds = new Set(myExtensions.map(e => e.extension_id));

    return (
        <div className="page-container marketplace-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Marketplace</h1>
                    <p className="page-description">{extensions.length} extensions available</p>
                </div>
                <div className="page-header-actions">
                    <Button variant="outline" onClick={() => setShowSubmit(true)}>Submit Extension</Button>
                </div>
            </div>

            <Tabs defaultValue="browse">
                <TabsList>
                    <TabsTrigger value="browse">Browse</TabsTrigger>
                    <TabsTrigger value="installed">Installed ({myExtensions.length})</TabsTrigger>
                    <TabsTrigger value="plugins">Plugins ({plugins.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="browse">
                    <div className="marketplace-filters">
                        <Input placeholder="Search extensions..." value={search} onChange={e => setSearch(e.target.value)} />
                        <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
                            <option value="">All Categories</option>
                            {categories.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                        </select>
                    </div>

                    <div className="extensions-grid">
                        {extensions.map(ext => (
                            <div key={ext.id} className="extension-card card">
                                <div className="extension-card__header">
                                    <h3>{ext.display_name}</h3>
                                    <Badge variant="outline">{ext.category}</Badge>
                                </div>
                                <p className="extension-card__desc">{ext.description}</p>
                                <div className="extension-card__meta">
                                    <span className="extension-card__rating">{renderStars(ext.rating)} ({ext.rating_count})</span>
                                    <span>{ext.download_count} installs</span>
                                </div>
                                <div className="extension-card__info">
                                    <span>v{ext.version}</span>
                                    {ext.author && <span>by {ext.author}</span>}
                                    <Badge variant="secondary">{ext.extension_type}</Badge>
                                </div>
                                <div className="extension-card__actions">
                                    {installedIds.has(ext.id) ? (
                                        <Badge variant="success">Installed</Badge>
                                    ) : (
                                        <Button size="sm" onClick={() => handleInstall(ext.id)}>Install</Button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {extensions.length === 0 && <div className="empty-state"><p>No extensions found.</p></div>}
                    </div>
                </TabsContent>

                <TabsContent value="installed">
                    <div className="installed-list">
                        {myExtensions.map(inst => (
                            <div key={inst.id} className="installed-item card">
                                <div className="installed-item__info">
                                    <strong>{inst.extension_name}</strong>
                                    <span className="text-muted">v{inst.installed_version}</span>
                                </div>
                                <Button size="sm" variant="destructive" onClick={() => handleUninstall(inst.id)}>Uninstall</Button>
                            </div>
                        ))}
                        {myExtensions.length === 0 && <div className="empty-state"><p>No extensions installed.</p></div>}
                    </div>
                </TabsContent>

                <TabsContent value="plugins">
                    <div className="plugins-section">
                        <div className="plugin-install-form card">
                            <h3>Install Plugin</h3>

                            <div className="plugin-install-tabs" role="tablist">
                                {[
                                    { id: 'url', label: 'From URL' },
                                    { id: 'path', label: 'From Folder' },
                                    { id: 'upload', label: 'Upload Zip' },
                                ].map(t => (
                                    <button
                                        key={t.id}
                                        role="tab"
                                        type="button"
                                        aria-selected={installSource === t.id}
                                        className={`plugin-install-tab ${installSource === t.id ? 'plugin-install-tab--active' : ''}`}
                                        onClick={() => setInstallSource(t.id)}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>

                            {installSource === 'url' && (
                                <>
                                    <p className="text-muted">Paste a GitHub repo URL, release URL, or direct zip link.</p>
                                    <div className="plugin-install-row">
                                        <Input
                                            placeholder="https://github.com/user/serverkit-plugin"
                                            value={pluginUrl}
                                            onChange={e => setPluginUrl(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handlePluginInstall()}
                                            disabled={installing}
                                        />
                                        <Button
                                            onClick={handlePluginInstall}
                                            disabled={installing || !pluginUrl.trim()}
                                        >
                                            {installing ? 'Installing...' : 'Install'}
                                        </Button>
                                    </div>
                                </>
                            )}

                            {installSource === 'path' && (
                                <>
                                    <p className="text-muted">
                                        Absolute path to a plugin folder <strong>on the panel host</strong>
                                        — not on your local machine. If the backend runs in Docker, the
                                        path must exist inside the container (bind-mount the folder, or
                                        use <em>Upload Zip</em> instead). Folder must contain
                                        <code> plugin.json</code>.
                                    </p>
                                    <div className="plugin-install-row">
                                        <Input
                                            placeholder={
                                                navigator.userAgent.toLowerCase().includes('win')
                                                    ? 'C:\\Users\\you\\Documents\\GitHub\\my-plugin'
                                                    : '/home/you/projects/my-plugin'
                                            }
                                            value={pluginPath}
                                            onChange={e => setPluginPath(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handlePluginInstall()}
                                            disabled={installing}
                                        />
                                        <Button
                                            onClick={handlePluginInstall}
                                            disabled={installing || !pluginPath.trim()}
                                        >
                                            {installing ? 'Installing...' : 'Install'}
                                        </Button>
                                    </div>
                                </>
                            )}

                            {installSource === 'upload' && (
                                <>
                                    <p className="text-muted">
                                        Upload a plugin zip (max 50 MB). The archive must contain
                                        <code> plugin.json</code> at the top level (or one folder deep,
                                        as GitHub source zips do).
                                    </p>
                                    <div className="plugin-install-row">
                                        <input
                                            type="file"
                                            accept=".zip,application/zip,application/x-zip-compressed"
                                            disabled={installing}
                                            onChange={e => setPluginFile(e.target.files?.[0] || null)}
                                        />
                                        <Button
                                            onClick={handlePluginInstall}
                                            disabled={installing || !pluginFile}
                                        >
                                            {installing ? 'Installing...' : 'Install'}
                                        </Button>
                                    </div>
                                    {pluginFile && (
                                        <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                                            {pluginFile.name} · {(pluginFile.size / 1024).toFixed(1)} KB
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="installed-list">
                            {plugins.map(plugin => (
                                <div key={plugin.id} className={`installed-item card ${plugin.status === 'error' ? 'installed-item--error' : ''}`}>
                                    <div className="installed-item__info">
                                        <strong>{plugin.display_name}</strong>
                                        <span className="text-muted">v{plugin.version}</span>
                                        <Badge variant={pluginStatusVariant(plugin.status)}>
                                            {plugin.status}
                                        </Badge>
                                        {plugin.has_backend && <Badge variant="secondary">Backend</Badge>}
                                        {plugin.has_frontend && <Badge variant="secondary">Frontend</Badge>}
                                    </div>
                                    {plugin.description && <p className="text-muted" style={{ margin: '4px 0 8px', fontSize: '13px' }}>{plugin.description}</p>}
                                    {plugin.error_message && <p className="text-danger" style={{ margin: '4px 0 8px', fontSize: '12px' }}>{plugin.error_message}</p>}
                                    <div className="installed-item__actions">
                                        <Button
                                            size="sm"
                                            variant={plugin.status === 'active' ? 'outline' : 'default'}
                                            onClick={() => handlePluginToggle(plugin)}
                                        >
                                            {plugin.status === 'active' ? 'Disable' : 'Enable'}
                                        </Button>
                                        <Button size="sm" variant="destructive" onClick={() => handlePluginUninstall(plugin.id)}>Uninstall</Button>
                                    </div>
                                </div>
                            ))}
                            {plugins.length === 0 && (
                                <div className="empty-state">
                                    <p>No plugins installed. Use the form above to install one from a URL.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </TabsContent>
            </Tabs>

            {showSubmit && (
                <div className="modal-overlay" onClick={() => setShowSubmit(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h2>Submit Extension</h2><button className="modal-close" onClick={() => setShowSubmit(false)}>&times;</button></div>
                        <div className="modal-body">
                            <div className="form-group"><label>Name</label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
                            <div className="form-group"><label>Display Name</label><Input value={form.display_name} onChange={e => setForm({...form, display_name: e.target.value})} /></div>
                            <div className="form-group"><label>Description</label><Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={3} /></div>
                            <div className="form-group"><label>Category</label><select className="form-select" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                            <div className="form-group"><label>Author</label><Input value={form.author} onChange={e => setForm({...form, author: e.target.value})} /></div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowSubmit(false)}>Cancel</Button>
                            <Button onClick={handleSubmit} disabled={!form.name}>Submit</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Marketplace;
