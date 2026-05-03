import { useState, useEffect, useCallback } from 'react';
import {
    Activity,
    Archive,
    CheckCircle2,
    DownloadCloud,
    FileArchive,
    Filter,
    FolderOpen,
    Globe2,
    LayoutGrid,
    Package,
    PackageCheck,
    Plug,
    PlugZap,
    Search,
    ServerCog,
    ShieldCheck,
    Sparkles,
    Star,
    UploadCloud,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const CATEGORIES = ['monitoring', 'security', 'deployment', 'integration', 'ui', 'utility'];

const CATEGORY_ICONS = {
    monitoring: Activity,
    security: ShieldCheck,
    deployment: ServerCog,
    integration: Plug,
    ui: LayoutGrid,
    utility: Package,
};

const PLUGIN_INSTALL_SOURCES = [
    { id: 'url', label: 'URL', icon: Globe2 },
    { id: 'path', label: 'Folder', icon: FolderOpen },
    { id: 'upload', label: 'Zip', icon: FileArchive },
];

const numberFormatter = new Intl.NumberFormat();

const formatCount = (value) => numberFormatter.format(Number(value) || 0);

const titleCase = (value = '') => {
    const cleaned = String(value || 'utility').replace(/[-_]/g, ' ');
    return cleaned
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

const getCategoryIcon = (category) => CATEGORY_ICONS[category] || Package;

const getPublishedCatalogEntry = (extension, installed) => ({
    key: `published:${extension.id}`,
    source: 'published',
    sourceLabel: 'Published',
    sourceDetail: 'Registry package',
    installKey: extension.id,
    displayName: extension.display_name || extension.name,
    description: extension.description || 'No description provided.',
    category: extension.category || 'utility',
    version: extension.version || '0.0.0',
    author: extension.author,
    extensionType: extension.extension_type,
    installed,
    rating: extension.rating,
    ratingCount: extension.rating_count,
    downloadCount: extension.download_count,
});

const getInstalledPublishedEntry = (extension) => ({
    key: `installed:${extension.id}`,
    source: 'published',
    sourceLabel: 'Published',
    displayName: extension.extension_name,
    version: extension.installed_version || '0.0.0',
    installId: extension.id,
});

const getLocalCatalogEntry = (builtin) => {
    const manifest = builtin.manifest || {};

    return {
        key: `local:${builtin.slug}`,
        source: 'local',
        sourceLabel: 'Local mapping',
        sourceDetail: 'Mapped in local registry',
        installKey: builtin.slug,
        displayName: manifest.display_name || builtin.slug,
        description: manifest.description || 'Local extension package.',
        category: manifest.category || 'utility',
        version: manifest.version || '0.0.0',
        author: manifest.author,
        extensionType: 'local',
        installed: Boolean(builtin.installed),
        status: builtin.status,
    };
};

const catalogEntryMatches = (entry, search, category) => {
    if (category && entry.category !== category) return false;

    const query = search.trim().toLowerCase();
    if (!query) return true;

    return [
        entry.displayName,
        entry.description,
        entry.category,
        entry.author,
        entry.sourceLabel,
    ].some((value) => String(value || '').toLowerCase().includes(query));
};

const Marketplace = () => {
    const toast = useToast();
    const [extensions, setExtensions] = useState([]);
    const [myExtensions, setMyExtensions] = useState([]);
    const [plugins, setPlugins] = useState([]);
    const [builtins, setBuiltins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('');
    const [activeTab, setActiveTab] = useState('browse');
    const [pluginUrl, setPluginUrl] = useState('');
    const [pluginPath, setPluginPath] = useState('');
    const [pluginFile, setPluginFile] = useState(null);
    const [installSource, setInstallSource] = useState('url');
    const [installing, setInstalling] = useState(false);

    const loadExtensions = useCallback(async () => {
        try {
            const [eData, mData, pData, bData] = await Promise.all([
                api.getMarketplaceExtensions(category, search),
                api.getMyExtensions(),
                api.getInstalledPlugins().catch(() => ({ plugins: [] })),
                api.getBuiltinExtensions().catch(() => ({ builtin: [] })),
            ]);
            setExtensions(eData.extensions || []);
            setMyExtensions(mData.extensions || []);
            setPlugins(pData.plugins || []);
            setBuiltins(bData.builtin || []);
        } catch {
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

    const handleBuiltinInstall = async (slug) => {
        setInstalling(true);
        try {
            const result = await api.installBuiltinExtension(slug);
            toast.success(`Installed "${result.display_name}". Hot-reload should pick it up; restart backend if blueprint routes do not appear.`);
            loadExtensions();
        } catch (err) {
            toast.error(err.message || 'Local install failed');
        } finally {
            setInstalling(false);
        }
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

    const resetFilters = () => {
        setSearch('');
        setCategory('');
    };

    const openZipInstaller = () => {
        setInstallSource('upload');
        setActiveTab('plugins');
    };

    const pluginStatusVariant = (status) => {
        if (status === 'active') return 'success';
        if (status === 'error') return 'destructive';
        return 'outline';
    };

    if (loading) return <Spinner />;

    const installedIds = new Set(myExtensions.map((extension) => String(extension.extension_id)));
    const localCatalogEntries = builtins.map(getLocalCatalogEntry);
    const publishedCatalogEntries = extensions.map((extension) => (
        getPublishedCatalogEntry(extension, installedIds.has(String(extension.id)))
    ));
    const installedCatalogEntries = [
        ...localCatalogEntries.filter((entry) => entry.installed),
        ...myExtensions.map(getInstalledPublishedEntry),
    ];
    const installedBuiltinCount = localCatalogEntries.filter((entry) => entry.installed).length;
    const activePluginCount = plugins.filter((plugin) => plugin.status === 'active').length;
    const pluginIssueCount = plugins.filter((plugin) => plugin.status === 'error').length;
    const totalDownloads = extensions.reduce((total, extension) => total + (Number(extension.download_count) || 0), 0);
    const availableCount = extensions.length + builtins.length;
    const installedCatalogCount = installedCatalogEntries.length;
    const catalogEntries = [...localCatalogEntries, ...publishedCatalogEntries]
        .filter((entry) => catalogEntryMatches(entry, search, category));
    const hasFilters = Boolean(search.trim() || category);

    return (
        <div className="page-container marketplace-page">
            <section className="marketplace-hero">
                <div className="marketplace-hero__content">
                    <div className="marketplace-eyebrow">
                        <Sparkles aria-hidden="true" />
                        Extension control plane
                    </div>
                    <div className="page-header-content">
                        <h1>Marketplace</h1>
                        <p className="page-description">
                            One catalog for local registry mappings, published packages, and runtime plugins.
                        </p>
                    </div>
                </div>
                <div className="marketplace-hero__actions">
                    <Button variant="outline" onClick={openZipInstaller}>
                        <UploadCloud aria-hidden="true" />
                        Import ZIP
                    </Button>
                </div>
            </section>

            <div className="marketplace-stats" aria-label="Marketplace summary">
                <StatTile icon={Package} label="Catalog" value={availableCount} tone="blue" />
                <StatTile icon={Archive} label="Local Entries" value={builtins.length} tone="amber" />
                <StatTile icon={PackageCheck} label="Installed" value={installedCatalogCount} tone="green" />
                <StatTile icon={PlugZap} label="Active Plugins" value={`${activePluginCount}/${plugins.length}`} tone={pluginIssueCount > 0 ? 'red' : 'violet'} />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="marketplace-tabs">
                <TabsList className="marketplace-tabs__list">
                    <TabsTrigger value="browse">
                        <LayoutGrid aria-hidden="true" />
                        Browse
                    </TabsTrigger>
                    <TabsTrigger value="installed">
                        <PackageCheck aria-hidden="true" />
                        Installed ({installedCatalogCount})
                    </TabsTrigger>
                    <TabsTrigger value="plugins">
                        <PlugZap aria-hidden="true" />
                        ServerKit Plugins ({plugins.length})
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="browse">
                    <div className="marketplace-toolbar">
                        <div className="marketplace-search">
                            <Search className="marketplace-search__icon" aria-hidden="true" />
                            <Input
                                placeholder="Search extensions..."
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                aria-label="Search extensions"
                            />
                        </div>
                        <select
                            className="form-select marketplace-category-select"
                            value={category}
                            onChange={(event) => setCategory(event.target.value)}
                            aria-label="Filter by category"
                        >
                            <option value="">All Categories</option>
                            {CATEGORIES.map((item) => (
                                <option key={item} value={item}>{titleCase(item)}</option>
                            ))}
                        </select>
                        {hasFilters && (
                            <Button variant="ghost" size="sm" onClick={resetFilters}>
                                Reset
                            </Button>
                        )}
                    </div>

                    <div className="marketplace-browse-grid">
                        <div className="marketplace-main-stack">
                            <section className="marketplace-section">
                                <SectionHeader
                                    kicker="Catalog"
                                    title="Extension catalog"
                                    meta={`${catalogEntries.length} results`}
                                />
                                {catalogEntries.length > 0 ? (
                                    <div className="extensions-grid">
                                        {catalogEntries.map((entry) => (
                                            <CatalogExtensionCard
                                                key={entry.key}
                                                entry={entry}
                                                installing={installing}
                                                onInstall={
                                                    entry.source === 'local'
                                                        ? handleBuiltinInstall
                                                        : handleInstall
                                                }
                                                statusVariant={pluginStatusVariant}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <EmptyState
                                        icon={Package}
                                        title="No catalog entries found"
                                        description={hasFilters ? 'No local or published entries match the current filter.' : 'No extension entries are available yet.'}
                                    />
                                )}
                            </section>
                        </div>

                        <aside className="marketplace-side-panel" aria-label="Marketplace controls">
                            <div className="marketplace-panel">
                                <div className="marketplace-panel__title">
                                    <Filter aria-hidden="true" />
                                    Categories
                                </div>
                                <div className="marketplace-category-list">
                                    <button
                                        type="button"
                                        className={`marketplace-category ${category === '' ? 'marketplace-category--active' : ''}`}
                                        onClick={() => setCategory('')}
                                    >
                                        All
                                    </button>
                                    {CATEGORIES.map((item) => {
                                        const Icon = getCategoryIcon(item);
                                        return (
                                            <button
                                                key={item}
                                                type="button"
                                                className={`marketplace-category marketplace-category--${item} ${category === item ? 'marketplace-category--active' : ''}`}
                                                onClick={() => setCategory(item)}
                                            >
                                                <Icon aria-hidden="true" />
                                                {titleCase(item)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="marketplace-panel">
                                <div className="marketplace-panel__title">
                                    <ServerCog aria-hidden="true" />
                                    Runtime
                                </div>
                                <div className="marketplace-runtime">
                                    <RuntimeRow label="Published installs" value={formatCount(totalDownloads)} />
                                    <RuntimeRow label="Local mappings" value={builtins.length} />
                                    <RuntimeRow label="Installed local" value={`${installedBuiltinCount}/${builtins.length}`} />
                                    <RuntimeRow label="Active plugins" value={`${activePluginCount}/${plugins.length}`} />
                                    <RuntimeRow
                                        label="Plugin issues"
                                        value={pluginIssueCount}
                                        danger={pluginIssueCount > 0}
                                    />
                                </div>
                            </div>
                        </aside>
                    </div>
                </TabsContent>

                <TabsContent value="installed">
                    <section className="marketplace-section">
                        <SectionHeader
                            kicker="Installed"
                            title="Installed extensions"
                            meta={`${installedCatalogCount} installed`}
                        />
                        {installedCatalogEntries.length > 0 ? (
                            <div className="installed-list">
                                {installedCatalogEntries.map((entry) => (
                                    <InstalledCatalogRow
                                        key={entry.key}
                                        entry={entry}
                                        onUninstall={handleUninstall}
                                    />
                                ))}
                            </div>
                        ) : (
                            <EmptyState
                                icon={PackageCheck}
                                title="No extensions installed"
                                description="Install a local or published extension to see it here."
                            />
                        )}
                    </section>
                </TabsContent>

                <TabsContent value="plugins">
                    <div className="plugins-section">
                        <section className="marketplace-section">
                            <SectionHeader
                                kicker="Installer"
                                title="Install ServerKit plugin"
                                meta={titleCase(installSource)}
                            />
                            <div className="plugin-install-form">
                                <div className="plugin-install-form__heading">
                                    <div className="plugin-install-form__icon">
                                        <PlugZap aria-hidden="true" />
                                    </div>
                                    <div>
                                        <h3>Plugin source</h3>
                                        <p className="text-muted">Load plugin packages from a repository, host folder, or zip archive.</p>
                                    </div>
                                </div>

                                <div className="plugin-install-tabs" role="tablist" aria-label="Plugin install source">
                                    {PLUGIN_INSTALL_SOURCES.map((source) => {
                                        const SourceIcon = source.icon;
                                        return (
                                            <button
                                                key={source.id}
                                                role="tab"
                                                type="button"
                                                aria-selected={installSource === source.id}
                                                className={`plugin-install-tab ${installSource === source.id ? 'plugin-install-tab--active' : ''}`}
                                                onClick={() => setInstallSource(source.id)}
                                            >
                                                <SourceIcon aria-hidden="true" />
                                                {source.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                {installSource === 'url' && (
                                    <PluginInstallInput
                                        description="Paste a GitHub repo URL, release URL, or direct zip link."
                                        placeholder="https://github.com/user/serverkit-plugin"
                                        value={pluginUrl}
                                        onChange={setPluginUrl}
                                        onInstall={handlePluginInstall}
                                        disabled={installing}
                                        installDisabled={installing || !pluginUrl.trim()}
                                    />
                                )}

                                {installSource === 'path' && (
                                    <PluginInstallInput
                                        description="Use an absolute path that exists on the backend host or inside the backend container."
                                        placeholder="/opt/serverkit/plugins/my-plugin"
                                        value={pluginPath}
                                        onChange={setPluginPath}
                                        onInstall={handlePluginInstall}
                                        disabled={installing}
                                        installDisabled={installing || !pluginPath.trim()}
                                    />
                                )}

                                {installSource === 'upload' && (
                                    <div className="plugin-install-source">
                                        <p className="text-muted">
                                            Upload a plugin zip with <code>plugin.json</code> at the top level or one folder deep.
                                        </p>
                                        <div className="plugin-install-row">
                                            <Input
                                                type="file"
                                                className="marketplace-file-input"
                                                accept=".zip,application/zip,application/x-zip-compressed"
                                                disabled={installing}
                                                onChange={(event) => setPluginFile(event.target.files?.[0] || null)}
                                            />
                                            <Button
                                                onClick={handlePluginInstall}
                                                disabled={installing || !pluginFile}
                                            >
                                                <DownloadCloud aria-hidden="true" />
                                                {installing ? 'Installing...' : 'Install'}
                                            </Button>
                                        </div>
                                        {pluginFile && (
                                            <div className="plugin-file-note">
                                                {pluginFile.name} | {(pluginFile.size / 1024).toFixed(1)} KB
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="marketplace-section">
                            <SectionHeader
                                kicker="Runtime"
                                title="Installed ServerKit plugins"
                                meta={`${plugins.length} plugins`}
                            />
                            {plugins.length > 0 ? (
                                <div className="installed-list">
                                    {plugins.map((plugin) => (
                                        <PluginRow
                                            key={plugin.id}
                                            plugin={plugin}
                                            onToggle={handlePluginToggle}
                                            onUninstall={handlePluginUninstall}
                                            statusVariant={pluginStatusVariant}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <EmptyState
                                    icon={PlugZap}
                                    title="No ServerKit plugins installed"
                                    description="Install a plugin package to extend the panel runtime."
                                />
                            )}
                        </section>
                    </div>
                </TabsContent>
            </Tabs>

        </div>
    );
};

const StatTile = ({ icon: Icon, label, value, tone }) => (
    <div className={`marketplace-stat marketplace-stat--${tone}`}>
        <div className="marketplace-stat__icon">
            <Icon aria-hidden="true" />
        </div>
        <div>
            <div className="marketplace-stat__value">{value}</div>
            <div className="marketplace-stat__label">{label}</div>
        </div>
    </div>
);

const SectionHeader = ({ kicker, title, meta }) => (
    <div className="marketplace-section__header">
        <div>
            <p className="marketplace-kicker">{kicker}</p>
            <h2>{title}</h2>
        </div>
        {meta && <Badge variant="outline">{meta}</Badge>}
    </div>
);

const CatalogExtensionCard = ({ entry, installing, onInstall, statusVariant }) => {
    const category = entry.category || 'utility';
    const Icon = getCategoryIcon(category);
    const isLocal = entry.source === 'local';
    const installedLabel = isLocal && entry.status && entry.status !== 'active'
        ? titleCase(entry.status)
        : 'Installed';

    return (
        <article className={`extension-card extension-card--${entry.source} extension-card--${category} card`}>
            <div className="extension-card__topline">
                <div className={`extension-card__icon extension-card__icon--${category}`}>
                    <Icon aria-hidden="true" />
                </div>
                <div className="extension-card__badges">
                    <Badge variant={isLocal ? 'warning' : 'outline'}>{entry.sourceLabel}</Badge>
                    <Badge variant="outline">{titleCase(category)}</Badge>
                </div>
            </div>
            <div className="extension-card__body">
                <h3>{entry.displayName}</h3>
                <p className="extension-card__desc">{entry.description}</p>
            </div>
            <div className="extension-card__signals">
                {isLocal ? (
                    <>
                        <span>{entry.sourceDetail}</span>
                        <span>{entry.installed ? installedLabel : 'Ready to install'}</span>
                    </>
                ) : (
                    <>
                        <span>
                            {renderStars(entry.rating)}
                            <span className="extension-card__signal-text">
                                {formatCount(entry.ratingCount)} reviews
                            </span>
                        </span>
                        <span>{formatCount(entry.downloadCount)} installs</span>
                    </>
                )}
            </div>
            <div className="extension-card__footer">
                <div className="extension-card__info">
                    <span>v{entry.version}</span>
                    {entry.author && <span>by {entry.author}</span>}
                    {entry.extensionType && (
                        <Badge variant="secondary">
                            {isLocal ? 'local db' : entry.extensionType}
                        </Badge>
                    )}
                </div>
                <div className="extension-card__actions">
                    {entry.installed ? (
                        <Badge variant={isLocal ? statusVariant(entry.status) : 'success'}>
                            <CheckCircle2 aria-hidden="true" />
                            {installedLabel}
                        </Badge>
                    ) : (
                        <Button
                            size="sm"
                            disabled={isLocal && installing}
                            onClick={() => onInstall(entry.installKey)}
                        >
                            <DownloadCloud aria-hidden="true" />
                            {isLocal && installing ? 'Installing...' : 'Install'}
                        </Button>
                    )}
                </div>
            </div>
        </article>
    );
};

const InstalledCatalogRow = ({ entry, onUninstall }) => {
    const isLocal = entry.source === 'local';
    const Icon = isLocal ? Archive : PackageCheck;

    return (
        <article className="installed-item card">
            <div className="installed-item__main">
                <div className={`installed-item__icon installed-item__icon--${isLocal ? 'local' : 'extension'}`}>
                    <Icon aria-hidden="true" />
                </div>
                <div className="installed-item__content">
                    <div className="installed-item__title-line">
                        <strong>{entry.displayName}</strong>
                        <span className="text-muted">v{entry.version}</span>
                        <Badge variant={isLocal ? 'warning' : 'outline'}>{entry.sourceLabel}</Badge>
                    </div>
                    {isLocal && (
                        <p className="installed-item__description">
                            Managed as a local registry mapping.
                        </p>
                    )}
                </div>
            </div>
            <div className="installed-item__actions">
                {isLocal ? (
                    <Badge variant="success">Installed</Badge>
                ) : (
                    <Button size="sm" variant="destructive" onClick={() => onUninstall(entry.installId)}>
                        Uninstall
                    </Button>
                )}
            </div>
        </article>
    );
};

const PluginRow = ({ plugin, onToggle, onUninstall, statusVariant }) => (
    <article className={`installed-item installed-item--plugin card ${plugin.status === 'error' ? 'installed-item--error' : ''}`}>
        <div className="installed-item__main">
            <div className="installed-item__icon installed-item__icon--plugin">
                <PlugZap aria-hidden="true" />
            </div>
            <div className="installed-item__content">
                <div className="installed-item__title-line">
                    <strong>{plugin.display_name}</strong>
                    <span className="text-muted">v{plugin.version}</span>
                    <Badge variant={statusVariant(plugin.status)}>{plugin.status}</Badge>
                    {plugin.has_backend && <Badge variant="secondary">Backend</Badge>}
                    {plugin.has_frontend && <Badge variant="secondary">Frontend</Badge>}
                </div>
                {plugin.description && <p className="installed-item__description">{plugin.description}</p>}
                {plugin.error_message && <p className="installed-item__error">{plugin.error_message}</p>}
            </div>
        </div>
        <div className="installed-item__actions">
            <Button
                size="sm"
                variant={plugin.status === 'active' ? 'outline' : 'default'}
                onClick={() => onToggle(plugin)}
            >
                {plugin.status === 'active' ? 'Disable' : 'Enable'}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onUninstall(plugin.id)}>
                Uninstall
            </Button>
        </div>
    </article>
);

const PluginInstallInput = ({
    description,
    placeholder,
    value,
    onChange,
    onInstall,
    disabled,
    installDisabled,
}) => (
    <div className="plugin-install-source">
        <p className="text-muted">{description}</p>
        <div className="plugin-install-row">
            <Input
                placeholder={placeholder}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && onInstall()}
                disabled={disabled}
            />
            <Button onClick={onInstall} disabled={installDisabled}>
                <DownloadCloud aria-hidden="true" />
                {disabled ? 'Installing...' : 'Install'}
            </Button>
        </div>
    </div>
);

const RuntimeRow = ({ label, value, danger }) => (
    <div className={`marketplace-runtime__row ${danger ? 'marketplace-runtime__row--danger' : ''}`}>
        <span>{label}</span>
        <strong>{value}</strong>
    </div>
);

const EmptyState = ({ icon: Icon, title, description }) => (
    <div className="empty-state marketplace-empty">
        <Icon aria-hidden="true" />
        <h3>{title}</h3>
        <p>{description}</p>
    </div>
);

const renderStars = (rating) => {
    const normalizedRating = Math.max(0, Math.min(5, Number(rating) || 0));

    return (
        <span className="extension-card__stars" aria-label={`${normalizedRating.toFixed(1)} rating`}>
            {Array.from({ length: 5 }, (_, index) => (
                <Star
                    key={index}
                    aria-hidden="true"
                    className={index < Math.round(normalizedRating) ? 'is-filled' : ''}
                />
            ))}
        </span>
    );
};

export default Marketplace;
