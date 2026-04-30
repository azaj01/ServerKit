// Tiny client for the agent's local IPC server. Always 127.0.0.1 — the IPC
// server refuses non-loopback binds — so we don't worry about CORS, auth, or
// retries beyond the simple ones the hooks already handle.

const DEFAULT_PORT = 19780;

// Resolve the IPC base URL. The agent UI runs in WebView2 served from
// 127.0.0.1:<random>, so we can't get the IPC port from the document origin.
// We accept an override via an env var (Vite injects it at build time) and
// otherwise fall back to the default port baked into the agent's config.
const PORT =
    Number(import.meta.env.VITE_AGENT_IPC_PORT) ||
    Number(window.__SERVERKIT_IPC_PORT__) ||
    DEFAULT_PORT;

const BASE = `http://127.0.0.1:${PORT}`;

async function get(path) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`IPC ${path} ${res.status}: ${text || res.statusText}`);
    }
    return res.json();
}

async function post(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : null,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`IPC ${path} ${res.status}: ${text || res.statusText}`);
    }
    return res.json();
}

export const ipc = {
    health: () => get('/health'),
    status: () => get('/status'),
    metricsHistory: () => get('/metrics/history'),
    events: (since = 0) => get(`/events${since ? `?since=${since}` : ''}`),
    connection: () => get('/connection'),
    logs: (lines = 200) => get(`/logs?lines=${lines}`),
    restart: () => post('/restart'),
};
