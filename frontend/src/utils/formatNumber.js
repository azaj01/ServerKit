// Number formatting helpers for KPI tiles and count badges.
//
// `formatCompact` renders large counts in a space-tight notation (107814 →
// "107.8K") so a 6-digit total never bursts a narrow tile; `formatFull` is the
// grouped exact form (107814 → "107,814") used as the hover title so the precise
// count stays one hover away. Non-finite / non-numeric input is returned
// unchanged, letting callers pass placeholders like '—' straight through.
const compactFormatter = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
});

const fullFormatter = new Intl.NumberFormat('en');

export function formatCompact(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return value;
    return compactFormatter.format(n);
}

export function formatFull(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return value;
    return fullFormatter.format(n);
}

export default formatCompact;
