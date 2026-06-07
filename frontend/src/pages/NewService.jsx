import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowRight,
    CheckCircle2,
    ChevronDown,
    Github,
    GitBranch,
    KeyRound,
    Link2,
    Lock,
    Package,
    Plus,
    RefreshCw,
    Rocket,
    Search,
    Server,
    Settings2,
    ShieldCheck,
    Zap,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { PageTopbar } from '@/components/ds';
import { SERVICE_TABS } from '../components/services/serviceTabs';
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

const APP_TYPE_LABELS = Object.fromEntries(APP_TYPE_OPTIONS.map(option => [option.value, option.label]));
const BUILD_METHOD_LABELS = Object.fromEntries(BUILD_METHOD_OPTIONS.map(option => [option.value, option.label]));

const SERVICE_TEMPLATES = [
    {
        id: 'agentsite',
        name: 'AgentSite',
        serviceName: 'agentsite',
        description: 'AI-powered website builder with multi-agent orchestration.',
        repoUrl: 'https://github.com/jhd3197/AgentSite.git',
        branch: 'main',
        appType: 'docker',
        buildMethod: 'dockerfile',
        port: 6391,
        badges: ['Render', 'Railway', 'Compose', 'Dockerfile'],
        manifest: {
            strategy: 'docker_compose',
            recommended: {
                app_type: 'docker',
                build_method: 'dockerfile',
                port: 6391,
                dockerfile_path: 'Dockerfile',
                healthcheck_path: '/api/health',
            },
            manifests: [
                { type: 'docker_compose', file: 'docker-compose.yml', label: 'Docker Compose', summary: 'agentsite service on port 6391' },
                { type: 'render', file: 'render.yaml', label: 'Render blueprint', summary: 'agentsite web service using docker' },
                { type: 'railway', file: 'railway.json', label: 'Railway config', summary: 'Dockerfile build with health check' },
                { type: 'app_json', file: 'app.json', label: 'App manifest', summary: 'AI-powered website builder using multi-agent orchestration' },
            ],
            env: [
                { key: 'OPENAI_API_KEY', required: true, secret: true, source: 'render.yaml' },
                { key: 'CLAUDE_API_KEY', required: true, secret: true, source: 'render.yaml' },
                { key: 'GOOGLE_API_KEY', required: true, secret: true, source: 'render.yaml' },
                { key: 'GROQ_API_KEY', required: true, secret: true, source: 'render.yaml' },
                { key: 'GROK_API_KEY', required: true, secret: true, source: 'render.yaml' },
                { key: 'OPENROUTER_API_KEY', required: true, secret: true, source: 'render.yaml' },
            ],
            ports: [6391],
        },
    },
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

function normalizeManualRepo(value) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}.git`;
    if (/^github\.com\//i.test(trimmed)) return `https://${trimmed.replace(/\.git$/, '')}.git`;
    return trimmed;
}

function formatAppType(value) {
    return APP_TYPE_LABELS[value] || value || 'Auto-detect';
}

function formatBuildMethod(value) {
    return BUILD_METHOD_LABELS[value] || value || 'Auto build';
}

const NewService = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [sourceMode, setSourceMode] = useState('github');
    const [githubStatus, setGithubStatus] = useState(null);
    const [repos, setRepos] = useState([]);
    const [reposLoading, setReposLoading] = useState(false);
    const [repoSearch, setRepoSearch] = useState('');
    const [selectedRepo, setSelectedRepo] = useState(null);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [branches, setBranches] = useState([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [repoManifest, setRepoManifest] = useState(null);
    const [repoManifestLoading, setRepoManifestLoading] = useState(false);
    const [manualRepoUrl, setManualRepoUrl] = useState('');
    const [name, setName] = useState('');
    const [nameTouched, setNameTouched] = useState(false);
    const [branch, setBranch] = useState('main');
    const [appType, setAppType] = useState('auto');
    const [buildMethod, setBuildMethod] = useState('auto');
    const [port, setPort] = useState('');
    const [autoDeploy, setAutoDeploy] = useState(true);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const githubConnection = githubStatus?.connection;
    const githubConfigured = githubStatus?.configured;
    const normalizedManualRepo = useMemo(() => normalizeManualRepo(manualRepoUrl), [manualRepoUrl]);
    const activeManifest = sourceMode === 'template' ? selectedTemplate?.manifest : repoManifest;
    const recommended = activeManifest?.recommended || {};
    const detectedServiceName = useMemo(() => {
        if (sourceMode === 'template' && selectedTemplate) return slugify(selectedTemplate.serviceName || selectedTemplate.name || '');
        if (sourceMode === 'github' && selectedRepo) return slugify(selectedRepo.name || '');
        return repoNameFromUrl(normalizedManualRepo);
    }, [normalizedManualRepo, selectedRepo, selectedTemplate, sourceMode]);
    const serviceName = nameTouched ? name : detectedServiceName;
    const canSubmit = sourceMode === 'github'
        ? Boolean(githubConnection && selectedRepo && serviceName?.length >= 2)
        : sourceMode === 'template'
            ? Boolean(selectedTemplate && serviceName?.length >= 2)
            : Boolean(normalizedManualRepo && serviceName?.length >= 2);
    const buildSummary = buildMethod === 'auto' && recommended.build_method
        ? `Auto -> ${formatBuildMethod(recommended.build_method)}`
        : formatBuildMethod(buildMethod);

    const loadGithubStatus = useCallback(async () => {
        try {
            const data = await api.getGithubSourceStatus();
            setGithubStatus(data);
        } catch (err) {
            toast.error(err.message || 'Failed to load GitHub connection');
        }
    }, [toast]);

    const loadGithubRepos = useCallback(async (search = '') => {
        setReposLoading(true);
        try {
            const data = await api.listGithubRepositories({ search, perPage: 80 });
            setRepos(data.repos || []);
        } catch (err) {
            toast.error(err.message || 'Failed to load GitHub repositories');
        } finally {
            setReposLoading(false);
        }
    }, [toast]);

    const loadBranches = useCallback(async (fullName) => {
        setBranchesLoading(true);
        try {
            const data = await api.listGithubBranches(fullName);
            setBranches(data.branches || []);
        } catch (err) {
            setBranches([]);
            toast.error(err.message || 'Failed to load branches');
        } finally {
            setBranchesLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadGithubStatus();
    }, [loadGithubStatus]);

    useEffect(() => {
        if (sourceMode === 'github' && githubConnection) {
            loadGithubRepos();
        }
    }, [sourceMode, githubConnection, loadGithubRepos]);

    useEffect(() => {
        if (selectedRepo) {
            setBranch(selectedRepo.default_branch || 'main');
            loadBranches(selectedRepo.full_name);
        }
    }, [selectedRepo, loadBranches]);

    useEffect(() => {
        if (sourceMode !== 'github' || !selectedRepo) {
            if (sourceMode !== 'template') setRepoManifest(null);
            setRepoManifestLoading(false);
            return undefined;
        }

        let cancelled = false;
        setRepoManifestLoading(true);
        api.inspectGithubRepositoryManifest(selectedRepo.full_name, branch || selectedRepo.default_branch || 'main')
            .then((data) => {
                if (cancelled) return;
                const manifest = data.manifest || null;
                setRepoManifest(manifest);
                const detectedPort = manifest?.recommended?.port;
                if (!port && detectedPort) {
                    setPort(String(detectedPort));
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setRepoManifest(null);
                    toast.error(err.message || 'Failed to inspect repository manifests');
                }
            })
            .finally(() => {
                if (!cancelled) setRepoManifestLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [branch, port, selectedRepo, sourceMode, toast]);

    useEffect(() => {
        if (selectedRepo) {
            if (!nameTouched) {
                setName(slugify(selectedRepo.name || ''));
            }
        }
    }, [selectedRepo, nameTouched]);

    async function handleConnectGithub() {
        try {
            const redirectUri = `${window.location.origin}/connections/callback/github`;
            sessionStorage.setItem('sourceConnectionReturnTo', '/services/new');
            const { auth_url } = await api.startSourceConnection('github', redirectUri);
            window.location.href = auth_url;
        } catch (err) {
            toast.error(err.message || 'Failed to start GitHub connection');
        }
    }

    function handleSourceModeChange(mode) {
        setSourceMode(mode);
        if (mode === 'template' && !selectedTemplate) {
            handleSelectTemplate(SERVICE_TEMPLATES[0]);
        }
    }

    function handleSelectTemplate(template) {
        setSelectedTemplate(template);
        setSelectedRepo(null);
        setRepoManifest(template.manifest || null);
        setManualRepoUrl(template.repoUrl);
        setName(slugify(template.serviceName || template.name || ''));
        setNameTouched(false);
        setBranch(template.branch || 'main');
        setAppType(template.appType || 'auto');
        setBuildMethod(template.buildMethod || 'auto');
        setPort(template.port ? String(template.port) : '');
        setAutoDeploy(template.autoDeploy ?? true);
    }

    function handleManualRepoChange(value) {
        setManualRepoUrl(value);
        if (!nameTouched) {
            setName(repoNameFromUrl(normalizeManualRepo(value)));
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!canSubmit) {
            toast.error(sourceMode === 'github'
                ? 'Select a GitHub repository'
                : sourceMode === 'template'
                    ? 'Select a service template'
                    : 'Repository URL is required');
            return;
        }

        const payload = {
            name: serviceName,
            branch: branch.trim() || null,
            app_type: appType,
            build_method: buildMethod,
            port: port ? Number(port) : null,
            auto_deploy: autoDeploy,
        };
        if (recommended.dockerfile_path) payload.dockerfile_path = recommended.dockerfile_path;
        if (recommended.custom_build_cmd) payload.custom_build_cmd = recommended.custom_build_cmd;
        if (recommended.custom_start_cmd) payload.custom_start_cmd = recommended.custom_start_cmd;

        if (sourceMode === 'github') {
            payload.source_connection_id = githubConnection.id;
            payload.repository_full_name = selectedRepo.full_name;
            payload.repo_url = `https://github.com/${selectedRepo.full_name}.git`;
        } else if (sourceMode === 'template') {
            payload.template_id = selectedTemplate.id;
            payload.repo_url = selectedTemplate.repoUrl;
        } else {
            payload.repo_url = normalizedManualRepo;
        }

        setSubmitting(true);
        try {
            const result = await api.createAppFromRepository(payload);
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
            <PageTopbar
                icon={<Plus size={18} />}
                title="New Service"
                tabs={SERVICE_TABS}
                actions={(
                    <Button type="button" variant="outline" size="sm" asChild>
                        <Link to="/settings/connections">
                            <Link2 size={16} />
                            Connections
                        </Link>
                    </Button>
                )}
            />

            <div className="new-service-page__mode-strip" aria-label="Service source options">
                <button
                    className={`new-service-page__mode-card ${sourceMode === 'github' ? 'new-service-page__mode-card--active' : ''}`}
                    type="button"
                    onClick={() => handleSourceModeChange('github')}
                >
                    <span className="new-service-page__mode-icon">
                        <Github size={18} />
                    </span>
                    <span>
                        <strong>GitHub</strong>
                        <small>Connect with OAuth and choose a repository</small>
                    </span>
                    {sourceMode === 'github' ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                </button>
                <button
                    className={`new-service-page__mode-card ${sourceMode === 'manual' ? 'new-service-page__mode-card--active' : ''}`}
                    type="button"
                    onClick={() => handleSourceModeChange('manual')}
                >
                    <span className="new-service-page__mode-icon">
                        <KeyRound size={18} />
                    </span>
                    <span>
                        <strong>Other Git Remote</strong>
                        <small>GitLab, Bitbucket, Gitea, or SSH</small>
                    </span>
                    {sourceMode === 'manual' ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                </button>
                <button
                    className={`new-service-page__mode-card ${sourceMode === 'template' ? 'new-service-page__mode-card--active' : ''}`}
                    type="button"
                    onClick={() => handleSourceModeChange('template')}
                >
                    <span className="new-service-page__mode-icon">
                        <Package size={18} />
                    </span>
                    <span>
                        <strong>Deploy Template</strong>
                        <small>Fast import from manifest-ready repos</small>
                    </span>
                    {sourceMode === 'template' ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                </button>
            </div>

            <form className="new-service-page__wizard" onSubmit={handleSubmit}>
                <section className="new-service-page__panel new-service-page__provider-panel">
                    <div className="new-service-page__section-heading">
                        <Link2 size={16} />
                        <h2>{sourceMode === 'github' ? 'Pick Repository' : sourceMode === 'template' ? 'Choose Template' : 'Connect Source'}</h2>
                    </div>

                    {sourceMode === 'github' ? (
                        <div className="new-service-page__connect-box">
                            {githubConnection ? (
                                <>
                                    <div className="new-service-page__github-account">
                                        {githubConnection.avatar_url && <img src={githubConnection.avatar_url} alt="" />}
                                        <div>
                                            <strong>{githubConnection.display_name || githubConnection.provider_username}</strong>
                                            <span>@{githubConnection.provider_username}</span>
                                        </div>
                                        <Button type="button" variant="outline" onClick={() => loadGithubRepos()}>
                                            <RefreshCw size={16} className={reposLoading ? 'spinning' : ''} />
                                            Refresh
                                        </Button>
                                    </div>

                                    <div className="new-service-page__repo-search">
                                        <Search size={16} />
                                        <Input
                                            value={repoSearch}
                                            onChange={(e) => setRepoSearch(e.target.value)}
                                            placeholder="Search repositories"
                                        />
                                        <Button type="button" variant="outline" onClick={() => loadGithubRepos(repoSearch)}>
                                            Search
                                        </Button>
                                    </div>

                                    <div className="new-service-page__repo-list">
                                        {reposLoading && <div className="new-service-page__repo-state">Loading repositories...</div>}
                                        {!reposLoading && repos.length === 0 && (
                                            <div className="new-service-page__repo-state">No repositories found.</div>
                                        )}
                                        {!reposLoading && repos.map(repo => (
                                            <button
                                                key={repo.id}
                                                type="button"
                                                className={`new-service-page__repo-row ${selectedRepo?.id === repo.id ? 'new-service-page__repo-row--active' : ''}`}
                                                onClick={() => setSelectedRepo(repo)}
                                            >
                                                <span>
                                                    <strong>{repo.full_name}</strong>
                                                    <small>{repo.description || repo.language || 'No description'}</small>
                                                </span>
                                                <em>{repo.private ? 'Private' : 'Public'}</em>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <div className="new-service-page__connect-empty">
                                    <span className="new-service-page__connect-icon">
                                        <Github size={20} />
                                    </span>
                                    <div>
                                        <h2>{githubConfigured ? 'Connect GitHub' : 'GitHub connection is not configured'}</h2>
                                        <p>
                                            {githubConfigured
                                                ? 'Authorize ServerKit once, then choose a repository from your GitHub account.'
                                                : 'Add the GitHub OAuth app credentials in Settings before connecting.'}
                                        </p>
                                    </div>
                                    <div className="new-service-page__connect-actions">
                                        <Button type="button" onClick={handleConnectGithub} disabled={!githubConfigured}>
                                            <Github size={16} />
                                            Connect GitHub
                                        </Button>
                                        <Button type="button" variant="outline" asChild>
                                            <Link to="/settings/connections">
                                                <Settings2 size={16} />
                                                Settings
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : sourceMode === 'template' ? (
                        <div className="new-service-page__connect-box">
                            <div className="new-service-page__connect-heading">
                                <span className="new-service-page__connect-icon">
                                    <Package size={18} />
                                </span>
                                <div>
                                    <strong>Manifest-ready templates</strong>
                                    <span>Templates can ship Render, Railway, Docker Compose, app.json, or ServerKit manifest files.</span>
                                </div>
                            </div>

                            <div className="new-service-page__template-list">
                                {SERVICE_TEMPLATES.map(template => (
                                    <button
                                        key={template.id}
                                        type="button"
                                        className={`new-service-page__template-row ${selectedTemplate?.id === template.id ? 'new-service-page__template-row--active' : ''}`}
                                        onClick={() => handleSelectTemplate(template)}
                                    >
                                        <span className="new-service-page__template-main">
                                            <strong>{template.name}</strong>
                                            <small>{template.description}</small>
                                            <em>{template.repoUrl}</em>
                                        </span>
                                        <span className="new-service-page__template-badges">
                                            {template.badges.map(badge => (
                                                <span key={badge}>{badge}</span>
                                            ))}
                                        </span>
                                        {selectedTemplate?.id === template.id ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                                    </button>
                                ))}
                            </div>

                            <div className="new-service-page__connect-actions new-service-page__connect-actions--left">
                                <Button type="button" variant="outline" asChild>
                                    <Link to="/templates">
                                        <Package size={16} />
                                        Template Library
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="new-service-page__connect-box">
                            <div className="new-service-page__connect-heading">
                                <span className="new-service-page__connect-icon">
                                    <GitBranch size={18} />
                                </span>
                                <div>
                                    <strong>Git remote</strong>
                                    <span>Use this for providers that are not connected through the GitHub API.</span>
                                </div>
                            </div>
                            <div className="new-service-page__field">
                                <Label htmlFor="manual-repo-url">Repository URL</Label>
                                <Input
                                    id="manual-repo-url"
                                    value={manualRepoUrl}
                                    onChange={(e) => handleManualRepoChange(e.target.value)}
                                    placeholder="git@gitea.example.com:owner/repo.git"
                                    autoComplete="off"
                                    required={sourceMode === 'manual'}
                                />
                            </div>
                        </div>
                    )}

                    {(selectedRepo || sourceMode === 'manual' || selectedTemplate) && (
                        <div className="new-service-page__repo-preview">
                            <div>
                                <span>Service</span>
                                <strong>{serviceName || 'Auto-named from repo'}</strong>
                            </div>
                            <div>
                                <span>Branch</span>
                                <strong>{branch || 'main'}</strong>
                            </div>
                            <div>
                                <span>Build</span>
                                <strong>{buildSummary}</strong>
                            </div>
                        </div>
                    )}
                </section>

                <aside className="new-service-page__panel new-service-page__review-panel">
                    <div className="new-service-page__deploy-card">
                        <span className="new-service-page__deploy-icon">
                            <Rocket size={18} />
                        </span>
                        <div>
                            <h2>Ready to Import</h2>
                            <p>ServerKit clones the selected repository, detects the runtime, configures builds, and records deployment settings.</p>
                        </div>
                    </div>

                    <div className="new-service-page__flow">
                        <div>
                            <Github size={16} />
                            <span>Connect</span>
                        </div>
                        <ArrowRight size={14} />
                        <div>
                            <Zap size={16} />
                            <span>Detect</span>
                        </div>
                        <ArrowRight size={14} />
                        <div>
                            <Server size={16} />
                            <span>Deploy</span>
                        </div>
                    </div>

                    {(repoManifestLoading || activeManifest) && (
                        <div className="new-service-page__manifest-card">
                            <div className="new-service-page__manifest-head">
                                <span>
                                    <Zap size={16} />
                                    Manifest Detection
                                </span>
                                <strong>{repoManifestLoading ? 'Inspecting' : activeManifest?.strategy?.replace('_', ' ') || 'Detected'}</strong>
                            </div>
                            {!repoManifestLoading && activeManifest && (
                                <>
                                    <div className="new-service-page__manifest-grid">
                                        <div>
                                            <span>Type</span>
                                            <strong>{formatAppType(recommended.app_type)}</strong>
                                        </div>
                                        <div>
                                            <span>Build</span>
                                            <strong>{formatBuildMethod(recommended.build_method)}</strong>
                                        </div>
                                        <div>
                                            <span>Port</span>
                                            <strong>{recommended.port || 'Auto'}</strong>
                                        </div>
                                    </div>
                                    <div className="new-service-page__manifest-files">
                                        {(activeManifest.manifests || []).slice(0, 5).map(manifest => (
                                            <span key={manifest.file}>
                                                <CheckCircle2 size={13} />
                                                {manifest.file}
                                            </span>
                                        ))}
                                    </div>
                                    {(activeManifest.env || []).length > 0 && (
                                        <div className="new-service-page__env-preview">
                                            {(activeManifest.env || []).slice(0, 6).map(env => (
                                                <span key={env.key} className={env.secret ? 'new-service-page__env-preview-secret' : ''}>
                                                    {env.key}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    <div className="new-service-page__summary">
                        <div>
                            <span>Source</span>
                            <strong>{sourceMode === 'github' ? 'GitHub API' : sourceMode === 'template' ? 'Template' : 'Git remote'}</strong>
                        </div>
                        <div>
                            <span>Repository</span>
                            <strong>{selectedRepo?.full_name || selectedTemplate?.repoUrl || normalizedManualRepo || 'Not selected'}</strong>
                        </div>
                        <div>
                            <span>Build</span>
                            <strong>{buildSummary}</strong>
                        </div>
                        <div>
                            <span>Auto-deploy</span>
                            <strong>{autoDeploy ? 'On' : 'Off'}</strong>
                        </div>
                    </div>

                    <button
                        className="new-service-page__advanced-toggle"
                        type="button"
                        onClick={() => setAdvancedOpen(open => !open)}
                        aria-expanded={advancedOpen}
                    >
                        <span>
                            <Settings2 size={16} />
                            Advanced settings
                        </span>
                        <ChevronDown size={16} />
                    </button>

                    {advancedOpen && (
                        <div className="new-service-page__advanced">
                            <div className="new-service-page__two-col">
                                <div className="new-service-page__field">
                                    <Label htmlFor="branch">Branch</Label>
                                    {sourceMode === 'github' && branches.length > 0 ? (
                                        <select
                                            id="branch"
                                            value={branch}
                                            onChange={(e) => setBranch(e.target.value)}
                                            disabled={branchesLoading}
                                        >
                                            {branches.map(option => (
                                                <option key={option.name} value={option.name}>{option.name}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <Input
                                            id="branch"
                                            value={branch}
                                            onChange={(e) => setBranch(e.target.value)}
                                            placeholder="main"
                                        />
                                    )}
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
                                        <span>Webhook deployment for this branch.</span>
                                    </div>
                                    <Switch checked={autoDeploy} onCheckedChange={setAutoDeploy} />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="new-service-page__notes">
                        <div className="new-service-page__note">
                            <ShieldCheck size={16} />
                            <span>ServerKit checks serverkit.json, Docker Compose, Render, Railway, app.json, Dockerfile, and Nixpacks signals.</span>
                        </div>
                        <div className="new-service-page__note">
                            <Lock size={16} />
                            <span>Secret values from manifests stay empty until you add them to the service environment.</span>
                        </div>
                    </div>

                    <div className="new-service-page__actions">
                        <Button type="button" variant="outline" asChild>
                            <Link to="/services">Cancel</Link>
                        </Button>
                        <Button type="submit" disabled={!canSubmit || submitting}>
                            <Rocket size={16} />
                            {submitting ? 'Importing...' : 'Import Repository'}
                        </Button>
                    </div>
                </aside>
            </form>
        </div>
    );
};

export default NewService;
