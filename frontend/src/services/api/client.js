// Base HTTP client — constructor, token management, core request methods
const API_BASE_URL = import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? '/api/v1' : '/api/v1');

class ApiClient {
    constructor() {
        this.baseUrl = API_BASE_URL;
    }

    getToken() {
        return localStorage.getItem('access_token');
    }

    setTokens(accessToken, refreshToken) {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
    }

    clearTokens() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const token = this.getToken();

        // FormData uploads need browser-built Content-Type (with boundary)
        // and must NOT be JSON-stringified. Detect and bypass both.
        const isFormData = options.body instanceof FormData;

        const config = {
            headers: {
                ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
                ...(token && { Authorization: `Bearer ${token}` }),
                ...options.headers,
            },
            ...options,
        };

        if (
            !isFormData &&
            options.body &&
            typeof options.body === 'object' &&
            !(options.body instanceof Blob)
        ) {
            config.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, config);

            if (response.status === 401) {
                // flask-jwt-extended returns 401 with `{"msg": "..."}` when
                // the token is the problem; domain endpoints (e.g. wrong
                // pair-code passphrase) return `{"error": "..."}`. Only the
                // former should trigger a token refresh — refreshing on a
                // domain 401 wastes a backend round-trip and burns through
                // rate limits twice as fast.
                const probe = await response.clone().json().catch(() => ({}));
                const isJwtIssue = probe && probe.msg && !probe.error;

                if (isJwtIssue) {
                    const refreshed = await this.refreshToken();
                    if (refreshed) {
                        config.headers.Authorization = `Bearer ${this.getToken()}`;
                        const retryResponse = await fetch(url, config);
                        return this.handleResponse(retryResponse);
                    }
                    this.clearTokens();
                    window.location.href = '/login';
                    const err = new Error('Session expired');
                    err.status = 401;
                    throw err;
                }
                // Domain 401 — fall through so handleResponse throws the
                // server's error message verbatim, with status attached.
            }

            return this.handleResponse(response);
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    async handleResponse(response) {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = new Error(data.error || data.msg || 'Request failed');
            err.status = response.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    async refreshToken() {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) return false;

        try {
            const response = await fetch(`${this.baseUrl}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${refreshToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('access_token', data.access_token);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }
}

export default ApiClient;
