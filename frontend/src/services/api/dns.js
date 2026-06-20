// DNS Zones & Records

export async function getDNSZones() {
    return this.request('/dns/');
}

export async function getDNSZone(zoneId) {
    return this.request(`/dns/${zoneId}`);
}

export async function createDNSZone(data) {
    return this.request('/dns/', { method: 'POST', body: data });
}

export async function deleteDNSZone(zoneId) {
    return this.request(`/dns/${zoneId}`, { method: 'DELETE' });
}

export async function getDNSRecords(zoneId) {
    return this.request(`/dns/${zoneId}/records`);
}

export async function createDNSRecord(zoneId, data) {
    return this.request(`/dns/${zoneId}/records`, { method: 'POST', body: data });
}

export async function updateDNSRecord(recordId, data) {
    return this.request(`/dns/records/${recordId}`, { method: 'PUT', body: data });
}

export async function deleteDNSRecord(recordId) {
    return this.request(`/dns/records/${recordId}`, { method: 'DELETE' });
}

export async function getDNSPresets() {
    return this.request('/dns/presets');
}

export async function applyDNSPreset(zoneId, preset, variables = {}) {
    return this.request(`/dns/${zoneId}/apply-preset`, {
        method: 'POST',
        body: { preset, variables },
    });
}

export async function checkDNSPropagation(domain, type = 'A') {
    return this.request(`/dns/propagation/${domain}?type=${type}`);
}

export async function exportDNSZone(zoneId) {
    return this.request(`/dns/${zoneId}/export`);
}

export async function importDNSZone(zoneId, zoneFile) {
    return this.request(`/dns/${zoneId}/import`, {
        method: 'POST',
        body: { zone_file: zoneFile },
    });
}

// Dynamic DNS
export async function getDdnsHosts() {
    return this.request('/ddns/hosts');
}

export async function createDdnsHost(data) {
    return this.request('/ddns/hosts', { method: 'POST', body: data });
}

export async function deleteDdnsHost(hostId) {
    return this.request(`/ddns/hosts/${hostId}`, { method: 'DELETE' });
}

export async function regenerateDdnsToken(hostId) {
    return this.request(`/ddns/hosts/${hostId}/regenerate-token`, { method: 'POST' });
}
