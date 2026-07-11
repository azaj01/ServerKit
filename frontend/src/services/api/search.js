// Unified entity omnisearch (plan 41, Phase 4).
export async function search(q) {
    return this.request(`/search?q=${encodeURIComponent(q)}`);
}
