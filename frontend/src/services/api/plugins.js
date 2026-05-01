// Plugin management API methods

export async function getInstalledPlugins(status) {
    const params = status ? `?status=${status}` : '';
    return this.request(`/plugins${params}`);
}

export async function getPlugin(pluginId) {
    return this.request(`/plugins/${pluginId}`);
}

export async function installPlugin(url) {
    return this.request('/plugins/install', {
        method: 'POST',
        body: JSON.stringify({ url }),
    });
}

export async function installPluginFromPath(path) {
    return this.request('/plugins/install-local', {
        method: 'POST',
        body: JSON.stringify({ path }),
    });
}

export async function installPluginFromZip(file) {
    const form = new FormData();
    form.append('file', file);
    return this.request('/plugins/install-upload', {
        method: 'POST',
        body: form,
    });
}

export async function uninstallPlugin(pluginId) {
    return this.request(`/plugins/${pluginId}`, {
        method: 'DELETE',
    });
}

export async function enablePlugin(pluginId) {
    return this.request(`/plugins/${pluginId}/enable`, {
        method: 'POST',
    });
}

export async function disablePlugin(pluginId) {
    return this.request(`/plugins/${pluginId}/disable`, {
        method: 'POST',
    });
}
