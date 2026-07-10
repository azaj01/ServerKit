/**
 * Tiny semver-range satisfier — the JS mirror of backend/app/utils/sdk.py.
 *
 * Supports the small grammar extension authors actually write for `sdk_version`:
 *   ''/'*'/'x'          → matches anything
 *   '1.2.3'             → exact
 *   '^1.2.3'            → >=1.2.3 <2.0.0 (0.x pins the minor)
 *   '~1.2.3'            → >=1.2.3 <1.3.0
 *   '>=1.2.0' '>1' '<=2' '<2.0.0' '=1.2.3'
 *   a comma/space-separated AND of the above.
 *
 * Malformed comparators fail OPEN (return true) — a bad range must never wrongly
 * mark a working extension incompatible.
 */

function toTuple(v) {
    const parts = String(v).split('-')[0].split('+')[0].split('.').map((chunk) => {
        const digits = (chunk.match(/\d+/) || ['0'])[0];
        return parseInt(digits, 10) || 0;
    });
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
}

function cmp(a, b) {
    const ta = toTuple(a);
    const tb = toTuple(b);
    for (let i = 0; i < 3; i += 1) {
        if (ta[i] < tb[i]) return -1;
        if (ta[i] > tb[i]) return 1;
    }
    return 0;
}

function satisfiesOne(current, comparator) {
    const c = comparator.trim();
    if (!c || c === '*' || c === 'x' || c === 'X') return true;

    const m = c.match(/^(\^|~|>=|<=|>|<|=)?\s*v?(.+)$/);
    if (!m) return true;
    const op = m[1] || '=';
    const ver = m[2].trim();
    const lo = toTuple(ver);

    if (op === '^') {
        let hi;
        if (lo[0] > 0) hi = [lo[0] + 1, 0, 0];
        else if (lo[1] > 0) hi = [0, lo[1] + 1, 0];
        else hi = [0, 0, lo[2] + 1];
        return cmp(current, ver) >= 0 && cmp(current, hi.join('.')) < 0;
    }
    if (op === '~') {
        const hi = [lo[0], lo[1] + 1, 0];
        return cmp(current, ver) >= 0 && cmp(current, hi.join('.')) < 0;
    }
    const d = cmp(current, ver);
    if (op === '>=') return d >= 0;
    if (op === '<=') return d <= 0;
    if (op === '>') return d > 0;
    if (op === '<') return d < 0;
    return d === 0;
}

export function satisfiesRange(range, current) {
    if (!range || !String(range).trim()) return true;
    if (!current) return true;
    return String(range)
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .every((token) => satisfiesOne(current, token));
}
