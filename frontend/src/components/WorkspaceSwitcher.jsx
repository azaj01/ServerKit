import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { api } from '../services/api';

const ACTIVE_KEY = 'active_workspace_id';
const ACCENT_KEY = 'workspace_accent';  // ThemeContext applies this with precedence over the user accent

// Mirror a workspace's brand color into localStorage so ThemeContext can apply it
// (with precedence over the user's accent), or clear it when there's no color.
function syncAccent(ws) {
    if (ws && ws.primary_color) {
        localStorage.setItem(ACCENT_KEY, ws.primary_color);
    } else {
        localStorage.removeItem(ACCENT_KEY);
    }
}

// Active-workspace selector (#33). Self-contained: it reads/writes the active
// workspace in localStorage (which services/api/client.js sends ambiently as the
// X-Workspace-Id header) and reloads so every page re-fetches its lists under the
// new scope. Hidden unless the user belongs to more than one workspace, so
// single-tenant installs stay uncluttered.
const WorkspaceSwitcher = () => {
    const [workspaces, setWorkspaces] = useState([]);
    const [active, setActive] = useState(() => localStorage.getItem(ACTIVE_KEY) || 'all');

    useEffect(() => {
        let alive = true;
        api.getWorkspaces()
            .then((res) => {
                if (!alive) return;
                const list = res?.workspaces || [];
                setWorkspaces(list);
                const stored = localStorage.getItem(ACTIVE_KEY);
                if (stored && stored !== 'all') {
                    const ws = list.find((w) => String(w.id) === stored);
                    if (!ws) {
                        // Stale selection (workspace deleted / access lost): clear it so
                        // a dead X-Workspace-Id header / brand color isn't applied.
                        localStorage.removeItem(ACTIVE_KEY);
                        localStorage.removeItem(ACCENT_KEY);
                        setActive('all');
                    } else {
                        // Keep the brand color fresh for the next load if the admin changed it.
                        syncAccent(ws);
                    }
                }
            })
            .catch(() => { /* best-effort; the selector just won't render */ });
        return () => { alive = false; };
    }, []);

    if (workspaces.length < 2) return null;

    const handleChange = (e) => {
        const value = e.target.value;
        if (value === 'all') {
            localStorage.removeItem(ACTIVE_KEY);
            localStorage.removeItem(ACCENT_KEY);
        } else {
            localStorage.setItem(ACTIVE_KEY, value);
            syncAccent(workspaces.find((w) => String(w.id) === value));
        }
        // Reload so every page re-fetches its lists (and re-applies the brand color)
        // under the new workspace scope.
        window.location.reload();
    };

    return (
        <div className="workspace-switcher">
            <Building2 size={14} className="workspace-switcher__icon" aria-hidden="true" />
            <select
                className="workspace-switcher__select"
                value={active}
                onChange={handleChange}
                aria-label="Active workspace"
            >
                <option value="all">All workspaces</option>
                {workspaces.map((w) => (
                    <option key={w.id} value={String(w.id)}>{w.name}</option>
                ))}
            </select>
        </div>
    );
};

export default WorkspaceSwitcher;
