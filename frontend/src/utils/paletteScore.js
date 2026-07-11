// One scorer for the command palette (plan 41). A single subsequence fuzzy
// matcher with a word-start bonus, used across every provider so results from
// pages, settings, actions, and entities rank on the same scale. cmdk's own
// matcher is disabled (shouldFilter={false}) so this is the ONLY filter.

// Characters that begin a "word" — used to reward matches at the start of a
// token (e.g. "sm" hitting "SMTP" or "settings/security").
const WORD_BOUNDARY = /[\s\-_/:.]/;

/**
 * Subsequence fuzzy match of `query` against `text`.
 * @returns {number} score >= 0 on a match (higher is better), or -1 on no match.
 */
export function fuzzyScore(text, query) {
    if (!query) return 0;
    if (!text) return -1;
    const t = text.toLowerCase();
    const q = query.toLowerCase();

    // Fast path: a contiguous substring beats any scattered subsequence, and a
    // prefix / word-start hit beats a mid-word one.
    const idx = t.indexOf(q);
    if (idx !== -1) {
        let s = 100 - Math.min(idx, 40);
        if (idx === 0) s += 40;
        else if (WORD_BOUNDARY.test(t[idx - 1])) s += 20;
        return s;
    }

    // Subsequence: every char of q must appear in order within t.
    let ti = 0;
    let score = 0;
    let streak = 0;
    for (let qi = 0; qi < q.length; qi++) {
        const ch = q[qi];
        let found = -1;
        for (let k = ti; k < t.length; k++) {
            if (t[k] === ch) { found = k; break; }
        }
        if (found === -1) return -1;
        if (found === ti && qi > 0) { streak += 1; score += 2 + streak; }
        else { streak = 0; score += 1; }
        if (found === 0 || WORD_BOUNDARY.test(t[found - 1])) score += 3;
        ti = found + 1;
    }
    return score;
}

/**
 * Score a palette item against a query, weighting label matches highest, then
 * keywords, then sublabel, then path. Returns -1 when nothing matches.
 */
export function scoreItem(item, query) {
    const q = (query || '').trim();
    if (!q) return 0;

    const label = fuzzyScore(item.label || '', q);
    const kw = fuzzyScore(item.keywords || '', q);
    const sub = fuzzyScore(item.sublabel || '', q);
    const path = fuzzyScore(item.path || '', q);

    return Math.max(
        label >= 0 ? label + 25 : -1,
        kw >= 0 ? kw + 8 : -1,
        sub >= 0 ? sub + 4 : -1,
        path >= 0 ? path : -1,
    );
}
