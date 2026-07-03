// Curated DB config tuner — vetted engine settings with RAM-aware
// suggestions. Target is a Docker container name (engine passed alongside)
// or a managed database id. Passwords travel via X-DB-Password, never URLs.

function tunerHeaders(password) {
    return password ? { 'X-DB-Password': password } : {};
}

export async function inspectDbTuner(target, { engine, dedicated, user, password } = {}) {
    const params = new URLSearchParams();
    if (engine) params.set('engine', engine);
    if (dedicated) params.set('dedicated', 'true');
    if (user) params.set('user', user);
    const qs = params.toString();
    return this.request(`/db-tuner/${encodeURIComponent(target)}/inspect${qs ? `?${qs}` : ''}`, {
        headers: tunerHeaders(password),
    });
}

export async function applyDbTunerSettings(target, settings, { engine, user, password } = {}) {
    return this.request(`/db-tuner/${encodeURIComponent(target)}/apply`, {
        method: 'POST',
        body: { settings, engine, user },
        headers: tunerHeaders(password),
    });
}

export async function rollbackDbTuner(target, { engine, user, password } = {}) {
    return this.request(`/db-tuner/${encodeURIComponent(target)}/rollback`, {
        method: 'POST',
        body: { engine, user },
        headers: tunerHeaders(password),
    });
}
