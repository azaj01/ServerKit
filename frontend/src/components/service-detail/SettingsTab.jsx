import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal, GitBranch, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { DangerZone } from '../DangerZone';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';

// Grouped left sub-nav for the service Settings tab — mirrors the WordPress
// detail page's settings layout: an uppercase mono group label per section with
// the existing setting panels on the right. Groups give it structure (and room
// to grow) instead of one long flat stack.
const SVC_SETTINGS_GROUPS = [
    { label: 'General', items: [{ id: 'environment', label: 'Environment', icon: SlidersHorizontal }] },
    { label: 'Connections', items: [{ id: 'repository', label: 'Repository', icon: GitBranch }] },
    { label: 'Advanced', items: [{ id: 'danger', label: 'Danger Zone', icon: AlertTriangle }] },
];

const SettingsTab = ({ app, deployConfig, onUpdate, onOpenGitModal }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [section, setSection] = useState('environment');
    const [deleting, setDeleting] = useState(false);
    const [environmentType, setEnvironmentType] = useState(app.environment_type || 'standalone');
    const [savingEnvironment, setSavingEnvironment] = useState(false);
    const [unlinking, setUnlinking] = useState(false);

    const envLabels = {
        standalone: 'Standalone',
        production: 'Production',
        development: 'Development',
        staging: 'Staging',
    };

    async function handleEnvironmentChange(newType) {
        if (newType === app.environment_type) return;

        setSavingEnvironment(true);
        try {
            await api.updateAppEnvironment(app.id, newType);
            setEnvironmentType(newType);
            onUpdate();
        } catch (err) {
            toast.error('Failed to update environment type');
            setEnvironmentType(app.environment_type || 'standalone');
        } finally {
            setSavingEnvironment(false);
        }
    }

    async function handleUnlink() {
        if (!confirm(`Unlink ${app.name} from its linked application?`)) return;

        setUnlinking(true);
        try {
            await api.unlinkApp(app.id);
            onUpdate();
        } catch (err) {
            toast.error('Failed to unlink app');
        } finally {
            setUnlinking(false);
        }
    }

    async function handleDelete() {
        if (!confirm(`Delete ${app.name}? This action cannot be undone.`)) return;
        if (!confirm('Are you sure? This will permanently remove the service.')) return;

        setDeleting(true);
        try {
            await api.deleteApp(app.id);
            navigate('/services');
        } catch (err) {
            toast.error('Failed to delete service');
            setDeleting(false);
        }
    }

    return (
        <div className="svc-settings">
            <nav className="svc-settings__nav" aria-label="Service settings sections">
                {SVC_SETTINGS_GROUPS.map(g => (
                    <div className="svc-settings__group" key={g.label}>
                        <div className="svc-settings__grouplabel">{g.label}</div>
                        {g.items.map(s => (
                            <button
                                type="button"
                                key={s.id}
                                className={`svc-settings__navitem ${section === s.id ? 'is-active' : ''}`}
                                onClick={() => setSection(s.id)}
                            >
                                <s.icon size={15} />
                                {s.label}
                            </button>
                        ))}
                    </div>
                ))}
            </nav>

            <div className="svc-settings__content">
                {/* Environment Configuration */}
                {section === 'environment' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">Environment</h3>
                        <div className="card settings-section">
                            <div className="settings-row">
                                <div className="settings-label">
                                    <span>Environment Type</span>
                                    <span className="settings-hint">
                                        {app.has_linked_app
                                            ? 'This app is linked. Unlink to change environment type.'
                                            : 'Set how this application is used in your workflow.'}
                                    </span>
                                </div>
                                <div className="settings-control">
                                    {app.has_linked_app ? (
                                        <span className={`env-badge env-${app.environment_type}`}>
                                            {envLabels[app.environment_type] || app.environment_type}
                                        </span>
                                    ) : (
                                        <Select
                                            value={environmentType}
                                            onValueChange={handleEnvironmentChange}
                                            disabled={savingEnvironment}
                                        >
                                            <SelectTrigger className="settings-select">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="standalone">Standalone</SelectItem>
                                                <SelectItem value="development">Development</SelectItem>
                                                <SelectItem value="staging">Staging</SelectItem>
                                                <SelectItem value="production">Production</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {savingEnvironment && <span className="settings-saving">Saving...</span>}
                                </div>
                            </div>

                            {app.has_linked_app && (
                                <div className="settings-row">
                                    <div className="settings-label">
                                        <span>Linked Application</span>
                                        <span className="settings-hint">
                                            Unlinking will reset both apps to standalone mode.
                                        </span>
                                    </div>
                                    <div className="settings-control">
                                        <Button
                                            variant="outline"
                                            onClick={handleUnlink}
                                            disabled={unlinking}
                                        >
                                            {unlinking ? 'Unlinking...' : 'Unlink'}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Repository Configuration */}
                {section === 'repository' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">Repository</h3>
                        <div className="card">
                            <div className="settings-row">
                                <div className="settings-label">
                                    <span>Connected Repository</span>
                                    <span className="settings-hint">
                                        {deployConfig
                                            ? `${deployConfig.repo_url} (${deployConfig.branch || 'main'})`
                                            : 'No repository connected'}
                                    </span>
                                </div>
                                <div className="settings-control">
                                    <Button variant="outline" onClick={onOpenGitModal}>
                                        {deployConfig ? 'Edit' : 'Connect'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Danger Zone */}
                {section === 'danger' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">Danger Zone</h3>
                        <DangerZone
                            description="Once you delete a service, there is no going back. All data will be permanently removed."
                            action={
                                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                                    {deleting ? 'Deleting...' : 'Delete Service'}
                                </Button>
                            }
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsTab;
