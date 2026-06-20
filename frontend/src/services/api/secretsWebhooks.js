// Secrets manager + inbound webhook gateway API methods

export async function listVaults() {
    return this.get('/vaults');
}

export async function createVault(data) {
    return this.post('/vaults', data);
}

export async function getVault(id) {
    return this.get(`/vaults/${id}`);
}

export async function updateVault(id, data) {
    return this.patch(`/vaults/${id}`, data);
}

export async function deleteVault(id) {
    return this.delete(`/vaults/${id}`);
}

export async function listSecrets(vaultId) {
    return this.get(`/vaults/${vaultId}/secrets`);
}

export async function createSecret(vaultId, data) {
    return this.post(`/vaults/${vaultId}/secrets`, data);
}

export async function bulkCreateSecrets(vaultId, secrets) {
    return this.post(`/vaults/${vaultId}/secrets/bulk`, { secrets });
}

export async function getSecret(id) {
    return this.get(`/secrets/${id}`);
}

export async function updateSecret(id, data) {
    return this.patch(`/secrets/${id}`, data);
}

export async function revealSecret(id) {
    return this.post(`/secrets/${id}/reveal`);
}

export async function deleteSecret(id) {
    return this.delete(`/secrets/${id}`);
}

export async function listWebhookEndpoints() {
    return this.get('/webhooks/endpoints');
}

export async function createWebhookEndpoint(data) {
    return this.post('/webhooks/endpoints', data);
}

export async function getWebhookEndpoint(id) {
    return this.get(`/webhooks/endpoints/${id}`);
}

export async function updateWebhookEndpoint(id, data) {
    return this.patch(`/webhooks/endpoints/${id}`, data);
}

export async function regenerateWebhookSecret(id) {
    return this.post(`/webhooks/endpoints/${id}/regenerate-secret`);
}

export async function deleteWebhookEndpoint(id) {
    return this.delete(`/webhooks/endpoints/${id}`);
}

export async function listWebhookDeliveries(endpointId, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.get(`/webhooks/endpoints/${endpointId}/deliveries${query ? `?${query}` : ''}`);
}

export async function replayWebhookDelivery(deliveryId) {
    return this.post(`/webhooks/deliveries/${deliveryId}/replay`);
}
