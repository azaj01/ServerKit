// Reversible DNS cutover (/api/v1/dns-cutover) — snapshot a domain's records
// before a migration cutover so the switch can be reverted (plan 27 #13,
// plan 31 #1/#2/#4).

export async function getCutoverTtlGuidance(records) {
    return this.request('/dns-cutover/ttl-guidance', {
        method: 'POST',
        body: { records },
    });
}

// Server-sourced snapshot (plan 31 #2): the panel reads live records from the
// provider itself; the client may only pass `names` to filter which record
// names to include (never the record data). Requires a connected provider zone.
export async function snapshotDnsForCutover(domain, providerZoneId, provider = null, names = null) {
    return this.request('/dns-cutover/snapshot', {
        method: 'POST',
        body: { domain, provider_zone_id: providerZoneId, provider, names },
    });
}

export async function getCutoverSnapshots(domain = null) {
    const suffix = domain ? `?domain=${encodeURIComponent(domain)}` : '';
    return this.request(`/dns-cutover/snapshots${suffix}`);
}

export async function getCutoverSnapshot(snapshotId) {
    return this.request(`/dns-cutover/snapshots/${snapshotId}`);
}

// Perform (or dry-run) a cutover (plan 31 #1). `dryRun: true` returns the exact
// provider ops (create/update, old→new) without writing and needs no provider.
export async function performDnsCutover(snapshotId, target, { recordTypes = ['A'], dryRun = false } = {}) {
    return this.request('/dns-cutover/cutover', {
        method: 'POST',
        body: { snapshot_id: snapshotId, target, record_types: recordTypes, dry_run: dryRun },
    });
}

// Post-cutover resolution check across public resolvers (plan 31 #1).
export async function verifyDnsCutover(domain, { recordType = 'A', expected = null, snapshotId = null } = {}) {
    return this.request('/dns-cutover/verify', {
        method: 'POST',
        body: { domain, record_type: recordType, expected, snapshot_id: snapshotId },
    });
}

export async function revertDnsCutover(snapshotId) {
    return this.request(`/dns-cutover/snapshots/${snapshotId}/revert`, { method: 'POST' });
}
