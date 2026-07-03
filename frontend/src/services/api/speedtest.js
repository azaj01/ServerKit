// Server speed test API — backs the Monitoring overview card.

export async function getSpeedTest() {
    return this.request('/speedtest');
}

export async function runSpeedTest() {
    return this.request('/speedtest/run', { method: 'POST' });
}
