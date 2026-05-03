/**
 * PluginLoader - Renders installed plugin widgets in the global slot.
 *
 * Two ways a plugin can show a widget:
 *
 *   1. Declarative (preferred): manifest contributions block —
 *        "contributions": { "widgets": [{ "slot": "global",
 *                                          "component": "MyWidget" }] }
 *      The host fetches contributions at runtime and resolves the
 *      `component` name against the plugin's index module exports.
 *
 *   2. Legacy auto-render: any plugin with a default export from
 *      index.js gets rendered globally with no manifest required.
 *      Kept for backward compatibility with plugins that predate
 *      the contribution model.
 *
 * Plugins that declare a widget contribution opt out of the legacy
 * auto-render to avoid double-rendering.
 */
import { useMemo } from 'react';
import { useContributions, resolveComponent, getPluginModule } from './contributions';

const pluginModules = import.meta.glob('./*/index.{js,jsx}', { eager: true });

function getInstalledPlugins() {
    const plugins = [];
    for (const [path, mod] of Object.entries(pluginModules)) {
        const match = path.match(/^\.\/([^/]+)\/index\.(?:js|jsx)$/);
        if (!match) continue;
        const slug = match[1];
        if (slug === 'PluginLoader' || slug === 'sdk') continue;
        plugins.push({
            slug,
            Component: mod.default || null,
            Provider: mod.Provider || null,
            module: mod,
        });
    }
    return plugins;
}

const PluginLoader = ({ api }) => {
    const { widgets } = useContributions();
    const legacyPlugins = useMemo(() => getInstalledPlugins(), []);

    // Plugins that declare a widget contribution own their rendering
    // through that path; skip the legacy auto-render for them.
    const slugsWithDeclared = useMemo(() => {
        const set = new Set();
        for (const w of widgets || []) {
            if (w && w.plugin) set.add(w.plugin);
        }
        return set;
    }, [widgets]);

    const declaredWidgets = (widgets || [])
        .filter((w) => w && (w.slot || 'global') === 'global')
        .map((w, i) => {
            const Component = resolveComponent(w.plugin, w.component);
            if (!Component) return null;
            const mod = getPluginModule(w.plugin);
            const Provider = (mod && mod.Provider) || null;
            const node = <Component key={`${w.plugin}:${w.component}:${i}`} api={api} />;
            return Provider
                ? <Provider key={`provider:${w.plugin}:${i}`}>{node}</Provider>
                : node;
        })
        .filter(Boolean);

    const legacyWidgets = legacyPlugins
        .filter(({ slug, Component }) => Component && !slugsWithDeclared.has(slug))
        .map(({ slug, Component, Provider }) => {
            const node = <Component key={slug} api={api} />;
            return Provider
                ? <Provider key={`legacy-provider:${slug}`}>{node}</Provider>
                : node;
        });

    if (declaredWidgets.length === 0 && legacyWidgets.length === 0) return null;

    return <>{declaredWidgets}{legacyWidgets}</>;
};

export default PluginLoader;
