// Per-user "frecency" for the command palette (plan 41): frequency + recency of
// selections, kept in localStorage so an empty query can surface Recently used
// and a matched query can boost the things you actually pick. Client-only —
// server-side sync across devices is explicitly out of scope.

const STORE_KEY = 'serverkit:palette:frecency';
const HALF_LIFE_DAYS = 14;   // a selection's weight halves every two weeks
const DAY_MS = 86400000;

function load() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function save(data) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
        /* storage full / disabled — frecency is a nicety, never fatal */
    }
}

/** Exponentially time-decayed selection count for one item id. */
export function frecencyScore(id, now = Date.now()) {
    const rec = load()[id];
    if (!rec) return 0;
    const ageDays = Math.max(0, (now - (rec.lastUsed || 0)) / DAY_MS);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    return (rec.count || 0) * decay;
}

/** Record that the user selected `id`. */
export function recordUse(id, now = Date.now()) {
    if (!id) return;
    const data = load();
    const rec = data[id] || { count: 0, lastUsed: 0 };
    rec.count += 1;
    rec.lastUsed = now;
    data[id] = rec;
    save(data);
}

/** Most-used-recently item ids, best first. */
export function recentIds(limit = 8, now = Date.now()) {
    const data = load();
    return Object.keys(data)
        .map((id) => ({ id, score: frecencyScore(id, now) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => r.id);
}
