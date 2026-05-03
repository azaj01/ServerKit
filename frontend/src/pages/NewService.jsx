import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowRight,
    Boxes,
    CheckCircle2,
    GitBranch,
    Lock,
    Package,
    Rocket,
    Server,
    Zap,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const APP_TYPE_OPTIONS = [
    { value: 'auto', label: 'Auto-detect' },
    { value: 'docker', label: 'Docker / Compose' },
    { value: 'flask', label: 'Python' },
    { value: 'django', label: 'Django' },
    { value: 'php', label: 'PHP' },
    { value: 'static', label: 'Static site' },
];

const BUILD_METHOD_OPTIONS = [
    { value: 'auto', label: 'Auto build' },
    { value: 'nixpacks', label: 'Nixpacks' },
    { value: 'dockerfile', label: 'Dockerfile' },
    { value: 'custom', label: 'Custom command' },
];

function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function repoNameFromUrl(value) {
    if (!value) return '';
    const cleaned = value.trim().replace(/\.git$/, '');
    const parts = cleaned.split(/[/:]/).filter(Boolean);
    return slugify(parts[parts.length - 1] || '');
}

const NewService = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [repoUrl, setRepoUrl] = useState('');
    const [name, setName] = useState('');
    const [nameTouched, setNameTouched] = useState(false);
    const [branch, setBranch] = useState('main');
    const [appType, setAppType] = useState('auto');
    const [buildMethod, setBuildMethod] = useState('auto');
    const [port, setPort] = useState('');
    const [autoDeploy, setAutoDeploy] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const detectedName = useMemo(() => repoNameFromUrl(repoUrl), [repoUrl]);
    const serviceName = name || detectedName;

    function handleRepoChange(value) {
        setRepoUrl(value);
        if (!nameTouched) {
            setName(repoNameFromUrl(value));
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!repoUrl.trim()) {
            toast.error('Repository URL is required');
            return;
        }
        if (!serviceName || serviceName.length < 2) {
            toast.error('Service name must be at least 2 characters');
            return;
        }

        setSubmitting(true);
        try {
            const result = await api.createAppFromRepository({
                name: serviceName,
                repo_url: repoUrl.trim(),
                branch: branch.trim() || null,
                app_type: appType,
                build_method: buildMethod,
                port: port ? Number(port) : null,
                auto_deploy: autoDeploy,
            });
            toast.success('Repository service created');
            navigate(`/services/${result.app.id}`);
        } catch (err) {
            toast.error(err.message || 'Failed to create repository service');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="page-container new-service-page">
            <div className="new-service-page__breadcrumb">
                <Link to="/services">Services</Link>
                <span>/</span>
                <span>New</span>
            </div>

            <div className="new-service-page__header">
                <div>
                    <h1>New Service</h1>
                    <p>Create a service from an existing repository or start from a managed template.</p>
                </div>
            </div>

            <div className="new-service-page__source-grid">
                <button className="new-service-page__source-card new-service-page__source-card--active" type="button">
                    <span className="new-service-page__source-icon">
                        <GitBranch size={18} />
                    </span>
                    <span>
                        <strong>Repository</strong>
                        <small>GitHub, GitLab, Bitbucket, Gitea, or SSH remote</small>
                    </span>
                    <CheckCircle2 size={18} />
                </button>
                <Link to="/templates" className="new-service-page__source-card">
                    <span className="new-service-page__source-icon">
                        <Package size={18} />
                    </span>
                    <span>
                        <strong>Template</strong>
                        <small>One-click apps such as Gitea, Ghost, n8n, and Nextcloud</small>
                    </span>
                    <ArrowRight size={18} />
                </Link>
            </div>

            <div className="new-service-page__layout">
                <form className="new-service-page__panel new-service-page__form" onSubmit={handleSubmit}>
                    <div className="new-service-page__section">
                        <div className="new-service-page__section-heading">
                            <GitBranch size={16} />
                            <h2>Source</h2>
                        </div>
                        <div className="new-service-page__field">
                            <Label htmlFor="repo-url">Repository URL</Label>
                            <Input
                                id="repo-url"
                                value={repoUrl}
                                onChange={(e) => handleRepoChange(e.target.value)}
                                placeholder="git@github.com:owner/repo.git"
                                autoComplete="off"
                                required
                            />
                            <span className="new-service-page__hint">
                                Private repositories work with SSH URLs or HTTPS URLs your server can authenticate.
                            </span>
                        </div>
                        <div className="new-service-page__two-col">
                            <div className="new-service-page__field">
                                <Label htmlFor="branch">Branch</Label>
                                <Input
                                    id="branch"
                                    value={branch}
                                    onChange={(e) => setBranch(e.target.value)}
                                    placeholder="main"
                                />
                            </div>
                            <div className="new-service-page__field">
                                <Label htmlFor="service-name">Service name</Label>
                                <Input
                                    id="service-name"
                                    value={serviceName}
                                    onChange={(e) => {
                                        setNameTouched(true);
                                        setName(slugify(e.target.value));
                                    }}
                                    placeholder="my-service"
                                    minLength={2}
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div className="new-service-page__section">
                        <div className="new-service-page__section-heading">
                            <Boxes size={16} />
                            <h2>Runtime</h2>
                        </div>
                        <div className="new-service-page__two-col">
                            <div className="new-service-page__field">
                                <Label htmlFor="app-type">Service type</Label>
                                <select
                                    id="app-type"
                                    value={appType}
                                    onChange={(e) => setAppType(e.target.value)}
                                >
                                    {APP_TYPE_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="new-service-page__field">
                                <Label htmlFor="build-method">Build method</Label>
                                <select
                                    id="build-method"
                                    value={buildMethod}
                                    onChange={(e) => setBuildMethod(e.target.value)}
                                >
                                    {BUILD_METHOD_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="new-service-page__two-col">
                            <div className="new-service-page__field">
                                <Label htmlFor="port">Runtime port</Label>
                                <Input
                                    id="port"
                                    type="number"
                                    value={port}
                                    onChange={(e) => setPort(e.target.value)}
                                    placeholder="3000"
                                    min="1"
                                    max="65535"
                                />
                            </div>
                            <div className="new-service-page__toggle">
                                <div>
                                    <Label>Auto-deploy</Label>
                                    <span>Keep webhook deployment enabled for this branch.</span>
                                </div>
                                <Switch checked={autoDeploy} onCheckedChange={setAutoDeploy} />
                            </div>
                        </div>
                    </div>

                    <div className="new-service-page__actions">
                        <Button type="button" variant="outline" asChild>
                            <Link to="/services">Cancel</Link>
                        </Button>
                        <Button type="submit" disabled={submitting}>
                            <Rocket size={16} />
                            {submitting ? 'Creating...' : 'Create Service'}
                        </Button>
                    </div>
                </form>

                <aside className="new-service-page__panel new-service-page__aside">
                    <div className="new-service-page__aside-block">
                        <h2>Connection Flow</h2>
                        <div className="new-service-page__flow">
                            <div>
                                <GitBranch size={16} />
                                <span>Repo</span>
                            </div>
                            <ArrowRight size={14} />
                            <div>
                                <Zap size={16} />
                                <span>Build</span>
                            </div>
                            <ArrowRight size={14} />
                            <div>
                                <Server size={16} />
                                <span>Service</span>
                            </div>
                        </div>
                    </div>

                    <div className="new-service-page__aside-block">
                        <h2>Private Access</h2>
                        <div className="new-service-page__note">
                            <Lock size={16} />
                            <span>Use an SSH remote when the server already has a deploy key, or an HTTPS URL that includes a provider token.</span>
                        </div>
                    </div>

                    <div className="new-service-page__aside-block">
                        <h2>Templates Stay Separate</h2>
                        <div className="new-service-page__note">
                            <Package size={16} />
                            <span>Templates are for packaged apps and infrastructure services. Repository services start here.</span>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default NewService;
