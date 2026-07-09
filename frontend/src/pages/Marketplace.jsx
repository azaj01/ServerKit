import { useState, useEffect, useCallback } from 'react';
import { useLocation, useSearchParams, useNavigate } from 'react-router-dom';
import {
    Activity,
    CheckCircle2,
    DownloadCloud,
    LayoutGrid,
    Package,
    PackageCheck,
    Plug,
    PlugZap,
    ServerCog,
    ShieldCheck,
    Sparkles,
    UploadCloud,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { sanitizeSvgInner } from '../utils/sanitizeSvg';
import Modal from '@/components/Modal';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    SearchField, FilterDrawer, FilterButton, countActiveFilters,
} from '@/components/ds';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import ManualInstallModal from '../components/marketplace/ManualInstallModal';
import {
    ExtensionBrandMark, hasBrandMark, extensionCoverStyle,
} from '../components/icons/ExtensionBrands';
import { resolveExtensionIcon } from '../components/icons/ExtensionIcons';

const CATEGORIES = ['ai', 'monitoring', 'security', 'deployment', 'integration', 'ui', 'utility'];

const CATEGORY_ICONS = {
    ai: Sparkles,
    monitoring: Activity,
    security: ShieldCheck,
    deployment: ServerCog,
    integration: Plug,
    ui: LayoutGrid,
    utility: Package,
};

const titleCase = (value = '') => {
    const cleaned = String(value || 'utility').replace(/[-_]/g, ' ');
    return cleaned
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

const getCategoryIcon = (category) => CATEGORY_ICONS[category] || Package;

// A first-party ("by ServerKit") entry is one authored by ServerKit or one whose
// manifest explicitly opts in via `first_party`. Case-insensitive on author.
const isFirstParty = (author, source = {}) => {
    if (source && source.first_party) return true;
    return String(author || '').trim().toLowerCase() === 'serverkit';
};

// Union of categories actually present across the merged catalog, ordered by the
// canonical CATEGORIES list first, then any extras alphabetically (stable, deduped).
const deriveCatalogCategories = (entries) => {
    const present = new Set(entries.map((entry) => entry.category || 'utility'));
    const known = CATEGORIES.filter((item) => present.has(item));
    const extra = [...present].filter((item) => !CATEGORIES.includes(item)).sort();
    return [...known, ...extra];
};

const getRegistryCatalogEntry = (entry) => ({
    key: `registry:${entry.slug}`,
    source: 'registry',
    sourceLabel: 'Registry',
    sourceDetail: 'Remote registry package',
    installKey: entry.slug,
    displayName: entry.display_name || entry.slug,
    description: entry.description || 'No description provided.',
    category: entry.category || 'utility',
    version: entry.version || '0.0.0',
    author: entry.author,
    firstParty: isFirstParty(entry.author, entry),
    icon: entry.icon || null,
    logo: entry.logo || null,
    screenshots: Array.isArray(entry.screenshots) ? entry.screenshots : [],
    permissions: Array.isArray(entry.permissions) ? entry.permissions : [],
    configSchema: entry.config_schema && typeof entry.config_schema === 'object' ? entry.config_schema : null,
    extensionType: 'registry',
    installed: Boolean(entry.installed),
    status: entry.status,
});

// Source badge tint: built-in is 'warning', registry is 'info'.
const sourceBadgeVariant = (source) => {
    if (source === 'local') return 'warning';
    if (source === 'registry') return 'info';
    return 'outline';
};

const getLocalCatalogEntry = (builtin) => {
    const manifest = builtin.manifest || {};

    return {
        key: `local:${builtin.slug}`,
        source: 'local',
        sourceLabel: 'Built-in',
        sourceDetail: 'Bundled with ServerKit',
        installKey: builtin.slug,
        displayName: manifest.display_name || builtin.slug,
        description: manifest.description || 'Bundled extension.',
        category: manifest.category || 'utility',
        version: manifest.version || '0.0.0',
        author: manifest.author,
        firstParty: isFirstParty(manifest.author, manifest),
        icon: manifest.icon || null,
        logo: manifest.logo || null,
        screenshots: Array.isArray(manifest.screenshots) ? manifest.screenshots : [],
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
        configSchema: manifest.config_schema && typeof manifest.config_schema === 'object' ? manifest.config_schema : null,
        extensionType: 'built-in',
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
    const [plugins, setPlugins] = useState([]);
    const [builtins, setBuiltins] = useState([]);
    const [registryExtensions, setRegistryExtensions] = useState([]);
    const [pluginUpdates, setPluginUpdates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    // Advanced filters live in a shared FilterDrawer. `ownership` is single-select
    // ('' all, 'serverkit' firstParty, 'community'); `category` is multi-select.
    const [filters, setFilters] = useState({ ownership: '', category: [] });
    const [filtersOpen, setFiltersOpen] = useState(false);
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // The active view is driven by the route (/marketplace = browse,
    // /marketplace/installed = installed). The legacy ?tab=installed deep link
    // still resolves to the installed view.
    const installedView = location.pathname.endsWith('/installed')
        || searchParams.get('tab') === 'installed';
    // Manual install modal (URL / folder / zip); null when closed, otherwise
    // the source sub-tab to preselect.
    const [manualInstallSource, setManualInstallSource] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [detailEntry, setDetailEntry] = useState(null);
    // Plugin pending uninstall — drives the keep-vs-purge data-policy dialog.
    const [uninstallTarget, setUninstallTarget] = useState(null);
    // Plugin whose config is being edited (#49) — drives the config dialog.
    const [configTarget, setConfigTarget] = useState(null);

    const loadExtensions = useCallback(async () => {
        try {
            const [pData, bData, rData, uData] = await Promise.all([
                api.getInstalledPlugins().catch(() => ({ plugins: [] })),
                api.getBuiltinExtensions().catch(() => ({ builtin: [] })),
                api.getRegistryExtensions().catch(() => ({ extensions: [] })),
                api.getPluginUpdates().catch(() => ({ updates: [] })),
            ]);
            setPlugins(pData.plugins || []);
            setBuiltins(bData.builtin || []);
            setRegistryExtensions(rData.extensions || []);
            setPluginUpdates(uData.updates || []);
        } catch {
            toast.error('Failed to load extensions');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadExtensions(); }, [loadExtensions]);

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

    const handleRegistryInstall = async (slug) => {
        setInstalling(true);
        try {
            const result = await api.installRegistryExtension(slug);
            toast.success(`Installed "${result.display_name}". Restart backend if blueprint routes do not appear.`);
            loadExtensions();
        } catch (err) {
            toast.error(err.message || 'Registry install failed');
        } finally {
            setInstalling(false);
        }
    };

    const installEntry = (entry) => {
        if (entry.source === 'local') {
            handleBuiltinInstall(entry.installKey);
        } else {
            handleRegistryInstall(entry.installKey);
        }
    };

    // Land on Installed after a manual install so the new row (and its
    // actions) is immediately visible.
    const handleManualInstalled = () => {
        setManualInstallSource(null);
        loadExtensions();
        navigate('/marketplace/installed');
    };

    // Open the data-policy dialog instead of uninstalling immediately, so the
    // operator can choose to keep or purge the extension's tables.
    const requestPluginUninstall = (plugin) => setUninstallTarget(plugin);

    const confirmPluginUninstall = async (purge) => {
        const plugin = uninstallTarget;
        setUninstallTarget(null);
        if (!plugin) return;
        try {
            await api.uninstallPlugin(plugin.id, purge);
            toast.success(purge ? 'Extension uninstalled; data purged' : 'Extension uninstalled; data kept');
            loadExtensions();
        } catch (err) { toast.error(err.message); }
    };

    const handlePluginUpdate = async (pluginId) => {
        setInstalling(true);
        try {
            const result = await api.updatePlugin(pluginId);
            toast.success(`Extension "${result.display_name}" updated to v${result.version}.`);
            loadExtensions();
        } catch (err) {
            toast.error(err.message || 'Extension update failed');
        } finally {
            setInstalling(false);
        }
    };

    const handlePluginToggle = async (plugin) => {
        try {
            if (plugin.status === 'active') {
                await api.disablePlugin(plugin.id);
                toast.success('Extension disabled');
            } else {
                await api.enablePlugin(plugin.id);
                toast.success('Extension enabled');
            }
            loadExtensions();
        } catch (err) { toast.error(err.message); }
    };

    const resetFilters = () => {
        setSearch('');
        setFilters({ ownership: '', category: [] });
    };

    const pluginStatusVariant = (status) => {
        if (status === 'active') return 'success';
        if (status === 'error') return 'destructive';
        return 'outline';
    };

    const activeFilterCount = countActiveFilters(filters);

    // Search + advanced-filter trigger sit in the shared page top bar (next to
    // Install manually) so the browse body starts straight at the grid. Only the
    // browse view gets search/filters; the installed view keeps Install manually
    // alone. Search is debounced, so re-publishing here is cheap and React
    // reconciles the input in place (focus is preserved between keystrokes).
    useTopbarActions(() =>
        <>
            {!installedView && (
                <>
                    <SearchField
                        value={search}
                        onSearch={setSearch}
                        placeholder="Search extensions…"
                    />
                    <FilterButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
                </>
            )}
            <Button variant="outline" size="sm" onClick={() => setManualInstallSource('url')}>
                <UploadCloud aria-hidden="true" />
                Install manually
            </Button>
        </>,
        [installedView, search, activeFilterCount],
    );

    if (loading) return <PageLoader />;

    const localCatalogEntries = builtins.map(getLocalCatalogEntry);
    const registryCatalogEntries = registryExtensions.map(getRegistryCatalogEntry);
    // Update descriptors keyed by both plugin_id and slug so PluginRow can match
    // whichever identifier it has on hand.
    const updatesByKey = new Map();
    pluginUpdates.forEach((update) => {
        if (update.plugin_id != null) updatesByKey.set(String(update.plugin_id), update);
        if (update.slug) updatesByKey.set(update.slug, update);
    });
    const mergedCatalogEntries = [...localCatalogEntries, ...registryCatalogEntries];
    const catalogCategories = deriveCatalogCategories(mergedCatalogEntries);
    const filterGroups = [
        {
            key: 'ownership',
            label: 'Publisher',
            type: 'single',
            options: [
                { value: 'serverkit', label: 'By ServerKit' },
                { value: 'community', label: 'Community' },
            ],
        },
        {
            key: 'category',
            label: 'Categories',
            type: 'multi',
            options: catalogCategories.map((item) => ({ value: item, label: titleCase(item) })),
        },
    ];
    const catalogEntries = mergedCatalogEntries
        // Category is handled below (multi-select), so pass '' to the shared matcher.
        .filter((entry) => catalogEntryMatches(entry, search, ''))
        .filter((entry) => {
            if (filters.ownership === 'serverkit') return entry.firstParty;
            if (filters.ownership === 'community') return !entry.firstParty;
            return true;
        })
        .filter((entry) => {
            const cats = filters.category || [];
            return cats.length === 0 || cats.includes(entry.category);
        });
    const hasFilters = Boolean(search.trim() || activeFilterCount > 0);

    return (
        <div className="sk-tabgroup__inner marketplace-page">
            {!installedView ? (
                <>
                    {hasFilters && (
                        <div className="marketplace-resultbar">
                            <Button variant="ghost" size="sm" onClick={resetFilters}>
                                Reset filters
                            </Button>
                        </div>
                    )}

                    <section className="marketplace-section">
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
                                                : handleRegistryInstall
                                        }
                                        onOpenDetail={setDetailEntry}
                                        statusVariant={pluginStatusVariant}
                                    />
                                ))}
                            </div>
                        ) : (
                            <EmptyState
                                icon={Package}
                                title="No catalog entries found"
                                description={hasFilters ? 'No built-in or registry entries match the current filter.' : 'No extension entries are available yet.'}
                            />
                        )}
                    </section>
                </>
            ) : (
                <section className="marketplace-section">
                    <SectionHeader
                        kicker="Installed"
                        title="Installed extensions"
                        meta={`${plugins.length} installed`}
                    />
                    {plugins.length > 0 ? (
                        <div className="installed-list">
                            {plugins.map((plugin) => (
                                <PluginRow
                                    key={plugin.id}
                                    plugin={plugin}
                                    update={updatesByKey.get(String(plugin.id))}
                                    installing={installing}
                                    onToggle={handlePluginToggle}
                                    onUpdate={handlePluginUpdate}
                                    onUninstall={requestPluginUninstall}
                                    onConfigure={setConfigTarget}
                                    statusVariant={pluginStatusVariant}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            icon={PackageCheck}
                            title="No extensions installed"
                            description="Install one from Marketplace or use Install manually."
                        />
                    )}
                </section>
            )}

            <FilterDrawer
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                groups={filterGroups}
                value={filters}
                onChange={setFilters}
                title="Filter extensions"
            />

            {manualInstallSource && (
                <ManualInstallModal
                    defaultSource={manualInstallSource}
                    onClose={() => setManualInstallSource(null)}
                    onInstalled={handleManualInstalled}
                />
            )}

            {detailEntry && (
                <ExtensionDetailModal
                    entry={detailEntry}
                    installing={installing}
                    statusVariant={pluginStatusVariant}
                    onClose={() => setDetailEntry(null)}
                    onInstall={() => {
                        installEntry(detailEntry);
                        setDetailEntry(null);
                    }}
                />
            )}

            {uninstallTarget && (
                <PluginUninstallDialog
                    plugin={uninstallTarget}
                    onCancel={() => setUninstallTarget(null)}
                    onConfirm={confirmPluginUninstall}
                />
            )}

            {configTarget && (
                <PluginConfigDialog
                    plugin={configTarget}
                    onClose={() => setConfigTarget(null)}
                />
            )}
        </div>
    );
};

// Cover chrome differs by artwork: illustrated raster icons get a clean light
// tile (their 3D art is drawn for a light backdrop and fills the space), while
// glyph / Simple-Icons brand-mark fallbacks keep the deterministic gradient so
// the white mark stays legible. `base` is the cover class ('extension-card__cover'
// or 'extension-detail__cover').
const coverProps = (base, entry, category) => {
    if (resolveExtensionIcon(entry.installKey, category)) {
        return { className: `${base} ${base}--icon` };
    }
    return { className: base, style: extensionCoverStyle(entry.installKey, category) };
};

const SectionHeader = ({ kicker, title, meta }) => (
    <div className="marketplace-section__header">
        <div>
            <p className="marketplace-kicker">{kicker}</p>
            <h2>{title}</h2>
        </div>
        {meta && <Badge variant="outline">{meta}</Badge>}
    </div>
);

// Cover artwork with a deterministic fallback chain:
// registry logo image -> bundled illustrated icon -> Simple Icons brand mark ->
// manifest icon SVG -> category lucide glyph. Kept as its own component so both
// the card and the detail modal share the exact same resolution order.
const ExtensionCover = ({ entry, category, brandSize = 34 }) => {
    const [logoFailed, setLogoFailed] = useState(false);
    const Icon = getCategoryIcon(category);
    const iconSvg = entry.icon ? sanitizeSvgInner(entry.icon) : '';
    const rasterIcon = resolveExtensionIcon(entry.installKey, category);

    if (entry.logo && !logoFailed) {
        return (
            <img
                src={entry.logo}
                loading="lazy"
                alt=""
                className="extension-card__logo"
                onError={() => setLogoFailed(true)}
            />
        );
    }
    if (rasterIcon) {
        return (
            <img
                src={rasterIcon}
                loading="lazy"
                alt=""
                aria-hidden="true"
                className="extension-card__icon"
            />
        );
    }
    if (hasBrandMark(entry.installKey)) {
        return (
            <ExtensionBrandMark
                slug={entry.installKey}
                size={brandSize}
                className="extension-card__brand"
            />
        );
    }
    if (iconSvg) {
        return (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
                focusable="false"
                className="extension-card__glyph"
                dangerouslySetInnerHTML={{ __html: iconSvg }}
            />
        );
    }
    return <Icon aria-hidden="true" className="extension-card__glyph" />;
};

const CatalogExtensionCard = ({ entry, installing, onInstall, onOpenDetail, statusVariant }) => {
    const category = entry.category || 'utility';
    const isLocal = entry.source === 'local';
    const installedLabel = entry.status && entry.status !== 'active'
        ? titleCase(entry.status)
        : 'Installed';

    const openDetail = () => onOpenDetail(entry);
    const handleKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDetail();
        }
    };

    return (
        <article
            className={`extension-card extension-card--${entry.source} extension-card--${category} extension-card--clickable card`}
            role="button"
            tabIndex={0}
            onClick={openDetail}
            onKeyDown={handleKeyDown}
        >
            <div {...coverProps('extension-card__cover', entry, category)}>
                <ExtensionCover entry={entry} category={category} brandSize={34} />
            </div>
            <div className="extension-card__badges">
                <Badge variant={sourceBadgeVariant(entry.source)}>{entry.sourceLabel}</Badge>
                <Badge variant="outline">{titleCase(category)}</Badge>
            </div>
            <div className="extension-card__body">
                <h3>{entry.displayName}</h3>
                <p className="extension-card__desc">{entry.description}</p>
            </div>
            <div className="extension-card__footer">
                <div className="extension-card__info">
                    <span>v{entry.version}</span>
                    {entry.firstParty ? (
                        <Badge variant="secondary" className="extension-firstparty">by ServerKit</Badge>
                    ) : (
                        entry.author && <span>by {entry.author}</span>
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
                            disabled={installing}
                            onClick={(event) => {
                                event.stopPropagation();
                                onInstall(entry.installKey);
                            }}
                        >
                            <DownloadCloud aria-hidden="true" />
                            {installing ? 'Installing...' : 'Install'}
                        </Button>
                    )}
                </div>
            </div>
        </article>
    );
};

const ExtensionDetailModal = ({ entry, installing, statusVariant, onClose, onInstall }) => {
    const category = entry.category || 'utility';
    const isLocal = entry.source === 'local';
    const screenshots = entry.screenshots || [];
    const permissions = Array.isArray(entry.permissions) ? entry.permissions : [];
    const configKeys = entry.configSchema && typeof entry.configSchema === 'object'
        ? Object.keys(entry.configSchema)
        : [];
    const installedLabel = entry.status && entry.status !== 'active'
        ? titleCase(entry.status)
        : 'Installed';

    return (
        <Modal open onClose={onClose} title={entry.displayName} size="lg">
            <div className="extension-detail">
                <div {...coverProps('extension-detail__cover', entry, category)}>
                    <ExtensionCover entry={entry} category={category} brandSize={46} />
                </div>
                <div className="extension-detail__header">
                    <div className="extension-detail__heading">
                        <div className="extension-detail__badges">
                            {entry.firstParty && (
                                <Badge variant="secondary" className="extension-firstparty">by ServerKit</Badge>
                            )}
                            <Badge variant={sourceBadgeVariant(entry.source)}>{entry.sourceLabel}</Badge>
                            <Badge variant="outline">{titleCase(category)}</Badge>
                        </div>
                        <div className="extension-detail__meta">
                            <span>v{entry.version}</span>
                            {entry.author && <span>by {entry.author}</span>}
                            <span>{isLocal ? 'built-in' : entry.extensionType}</span>
                        </div>
                    </div>
                </div>

                <p className="extension-detail__desc">{entry.description}</p>

                {permissions.length > 0 && (
                    <div className="extension-detail__consent">
                        <p className="extension-detail__section-label">This extension requests:</p>
                        <div className="extension-detail__chips">
                            {permissions.map((permission) => (
                                <Badge key={permission} variant="outline">{permission}</Badge>
                            ))}
                        </div>
                    </div>
                )}

                {configKeys.length > 0 && (
                    <div className="extension-detail__config">
                        <p className="extension-detail__section-label">Configuration</p>
                        <ul className="extension-detail__config-list">
                            {configKeys.map((key) => (
                                <li key={key}><code>{key}</code></li>
                            ))}
                        </ul>
                    </div>
                )}

                {screenshots.length > 0 && (
                    <div className="extension-detail__gallery" aria-label="Screenshots">
                        {screenshots.map((src, index) => (
                            <img
                                key={src}
                                src={src}
                                alt={`${entry.displayName} screenshot ${index + 1}`}
                                className="extension-detail__shot"
                                loading="lazy"
                            />
                        ))}
                    </div>
                )}

                <div className="extension-detail__actions">
                    {entry.installed ? (
                        <Badge variant={isLocal ? statusVariant(entry.status) : 'success'}>
                            <CheckCircle2 aria-hidden="true" />
                            {installedLabel}
                        </Badge>
                    ) : (
                        <Button disabled={installing} onClick={onInstall}>
                            <DownloadCloud aria-hidden="true" />
                            {installing ? 'Installing...' : 'Install'}
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
};

// Install-origin badge for installed rows. url/local/upload all collapse to
// "Manual" — the raw origin lives in the tooltip.
const PLUGIN_SOURCE_BADGES = {
    builtin: { label: 'Built-in', variant: 'warning' },
    registry: { label: 'Registry', variant: 'info' },
};

const PluginRow = ({ plugin, update, installing, onToggle, onUpdate, onUninstall, onConfigure, statusVariant }) => {
    const updateAvailable = Boolean(update?.update_available);
    const compatible = update?.compatible !== false;
    const configurable = plugin.config_schema
        && typeof plugin.config_schema === 'object'
        && Object.keys(plugin.config_schema).length > 0;
    const sourceBadge = PLUGIN_SOURCE_BADGES[plugin.source_type]
        || { label: 'Manual', variant: 'outline', title: plugin.source_url || undefined };

    return (
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
                        <Badge variant={sourceBadge.variant} title={sourceBadge.title}>{sourceBadge.label}</Badge>
                        {plugin.has_backend && <Badge variant="secondary">Backend</Badge>}
                        {plugin.has_frontend && <Badge variant="secondary">Frontend</Badge>}
                        {updateAvailable && (
                            <Badge variant="info" className="plugin-update-badge">
                                Update available → v{update.available_version}
                            </Badge>
                        )}
                    </div>
                    {plugin.description && <p className="installed-item__description">{plugin.description}</p>}
                    {plugin.error_message && <p className="installed-item__error">{plugin.error_message}</p>}
                </div>
            </div>
            <div className="installed-item__actions">
                {updateAvailable && (
                    <Button
                        size="sm"
                        disabled={!compatible || installing}
                        title={compatible ? undefined : 'Panel version is too old for this update'}
                        onClick={() => onUpdate(plugin.id)}
                    >
                        <DownloadCloud aria-hidden="true" />
                        Update
                    </Button>
                )}
                {configurable && (
                    <Button size="sm" variant="outline" onClick={() => onConfigure(plugin)}>
                        Configure
                    </Button>
                )}
                <Button
                    size="sm"
                    variant={plugin.status === 'active' ? 'outline' : 'default'}
                    onClick={() => onToggle(plugin)}
                >
                    {plugin.status === 'active' ? 'Disable' : 'Enable'}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => onUninstall(plugin)}>
                    Uninstall
                </Button>
            </div>
        </article>
    );
};

// Config editor for an installed plugin (#49). Fields come from the manifest's
// config_schema (top-level keys, or JSON-schema `properties`); values persist
// via PUT /plugins/<id>/config and the plugin reads them on the backend via
// plugins_sdk.config(slug).
const PluginConfigDialog = ({ plugin, onClose }) => {
    const toast = useToast();
    const [values, setValues] = useState(null);
    const [saving, setSaving] = useState(false);

    const schema = plugin.config_schema || {};
    const fields = schema.properties && typeof schema.properties === 'object'
        ? schema.properties
        : schema;

    useEffect(() => {
        api.getPluginConfig(plugin.id)
            .then((data) => setValues(data.config || {}))
            .catch(() => setValues({}));
    }, [plugin.id]);

    const setField = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));

    const save = async () => {
        setSaving(true);
        try {
            await api.updatePluginConfig(plugin.id, values || {});
            toast.success('Extension configuration saved');
            onClose();
        } catch (err) {
            toast.error(err.message || 'Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={`Configure ${plugin.display_name}`}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={save} disabled={saving || values === null}>
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                </>
            }
        >
            {values === null ? (
                <p className="text-muted">Loading…</p>
            ) : (
                <div className="plugin-config-form">
                    {Object.entries(fields).map(([key, spec]) => {
                        const s = spec && typeof spec === 'object' ? spec : {};
                        const type = s.type || 'string';
                        const isNumber = type === 'number' || type === 'integer';
                        const value = values[key] ?? s.default ?? (type === 'boolean' ? false : '');
                        return (
                            <label key={key} className="plugin-config-form__field">
                                <span className="plugin-config-form__label">{s.title || key}</span>
                                {type === 'boolean' ? (
                                    <input
                                        type="checkbox"
                                        checked={Boolean(value)}
                                        onChange={(e) => setField(key, e.target.checked)}
                                    />
                                ) : Array.isArray(s.enum) ? (
                                    <select
                                        className="ui-input"
                                        value={value}
                                        onChange={(e) => setField(key, e.target.value)}
                                    >
                                        {s.enum.map((opt) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        className="ui-input"
                                        type={isNumber ? 'number' : (s.secret ? 'password' : 'text')}
                                        value={value}
                                        onChange={(e) => setField(
                                            key,
                                            isNumber
                                                ? (e.target.value === '' ? '' : Number(e.target.value))
                                                : e.target.value
                                        )}
                                    />
                                )}
                                {s.description && (
                                    <span className="plugin-config-form__hint text-muted">{s.description}</span>
                                )}
                            </label>
                        );
                    })}
                    {Object.keys(fields).length === 0 && (
                        <p className="text-muted">This extension declares no configuration fields.</p>
                    )}
                </div>
            )}
        </Modal>
    );
};

// Data-policy dialog for plugin uninstall. Keeping data (default) leaves the
// extension's tables intact for a later reinstall; purging drops them.
const PluginUninstallDialog = ({ plugin, onCancel, onConfirm }) => (
    <Modal
        open
        onClose={onCancel}
        title={`Uninstall ${plugin.display_name}?`}
        size="sm"
        footer={
            <>
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button variant="outline" onClick={() => onConfirm(false)}>Keep data</Button>
                <Button variant="destructive" onClick={() => onConfirm(true)}>Purge data</Button>
            </>
        }
    >
        <div className="plugin-uninstall-dialog">
            <p>Removing this extension stops its routes and UI contributions.</p>
            <p className="text-muted">
                <strong>Keep data</strong> leaves the extension&apos;s database tables intact so you can
                reinstall later. <strong>Purge data</strong> permanently drops the extension&apos;s tables
                and cannot be undone.
            </p>
        </div>
    </Modal>
);

export default Marketplace;
