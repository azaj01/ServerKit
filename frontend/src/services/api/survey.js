// Server survey ("flight") — read-only Observe-mode survey over a paired agent.
// Backs the Survey tab on server detail (/api/v1/servers/...).

// The operator-facing probe index: exactly what the survey reads.
export async function getSurveyCatalog() {
    return this.request('/servers/survey/catalog');
}

// Fly a new survey against the server's agent; returns the stored snapshot.
export async function runServerSurvey(serverId) {
    return this.request(`/servers/${serverId}/survey`, { method: 'POST' });
}

// Switch a server between 'managed' and 'observed' adoption modes. Optionally
// toggle the observed-mode agent:update break-glass (plan 31 #10). The response
// carries `observed_blocked_count` — how many commands the Observe guard has
// refused on this server (plan 31 #11).
export async function setServerManagementMode(serverId, mode, allowAgentUpdateObserved = undefined) {
    const body = { mode };
    if (allowAgentUpdateObserved !== undefined) {
        body.allow_agent_update_observed = allowAgentUpdateObserved;
    }
    return this.request(`/servers/${serverId}/management-mode`, {
        method: 'POST',
        body,
    });
}

// Observe-mode status: current mode, the agent:update break-glass flag, and the
// count of commands the Observe guard has blocked (plan 31 #10/#11).
export async function getServerObservedStatus(serverId) {
    return this.request(`/servers/${serverId}/observed-status`);
}

// List survey snapshots (newest first, without the map blob).
export async function getServerSurveys(serverId) {
    return this.request(`/servers/${serverId}/surveys`);
}

// Fetch one survey snapshot including its full Server Map.
export async function getServerSurvey(serverId, surveyId) {
    return this.request(`/servers/${serverId}/surveys/${surveyId}`);
}

// Diff two survey snapshots (defaults to the latest two).
export async function diffServerSurveys(serverId, fromId = null, toId = null) {
    const qs = new URLSearchParams();
    if (fromId) qs.set('from', fromId);
    if (toId) qs.set('to', toId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`/servers/${serverId}/surveys/diff${suffix}`);
}
