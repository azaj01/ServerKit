// Deployment config snapshots + diff/restore.
// Mounted by the backend at /api/v1/apps.

export async function getAppSnapshots(appId, limit = 50) {
    return this.request(`/apps/${appId}/snapshots?limit=${limit}`);
}

export async function getAppSnapshot(appId, snapId) {
    return this.request(`/apps/${appId}/snapshots/${snapId}`);
}

export async function getSnapshotDiff(appId, snapId, against = 'previous') {
    const query = against ? `?against=${encodeURIComponent(against)}` : '';
    return this.request(`/apps/${appId}/snapshots/${snapId}/diff${query}`);
}

export async function restoreSnapshot(appId, snapId) {
    return this.request(`/apps/${appId}/snapshots/${snapId}/restore`, {
        method: 'POST',
    });
}
