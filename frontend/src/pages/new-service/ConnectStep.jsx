import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowRight, CheckCircle2, FileArchive, GitBranch, Info,
    Package, RefreshCw, Search, Settings2,
} from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SOURCE_NEEDS } from './useNewServiceForm';

// Templates flagged as featured get a badge in the picker.
const FEATURED_TEMPLATES = ['agentsite'];

// Template icon with a graceful fallback to a Package glyph if the inline/URL
// icon is missing or fails to load.
const TemplateIcon = ({ template }) => {
    const [failed, setFailed] = useState(false);
    if (template.icon && !failed) {
        return <img src={template.icon} alt="" onError={() => setFailed(true)} />;
    }
    return <Package size={22} />;
};

// Step 2 — Connect. Only the source-specific input, plus the editable detected
// service name + branch shown inline (not buried in Advanced).
const ConnectStep = ({ form }) => {
    const {
        sourceMode, selectSource, githubConnection, githubConfigured, reposLoading, repos, repoSearch,
        setRepoSearch, selectedRepo, setSelectedRepo, loadGithubRepos, handleConnectGithub,
        templates, templatesLoading, selectedTemplate, selectTemplateById,
        manualRepoUrl, handleManualRepoChange, localPath, setLocalPath, composeFile,
        setComposeFile, systemdUnit, setSystemdUnit, managedBy, setManagedBy,
        uploadFile, onUploadFile, uploadDragOver, setUploadDragOver,
        serviceName, onNameChange, branch, setBranch, branches, branchesLoading,
    } = form;

    const showBranch = sourceMode !== 'local' && sourceMode !== 'upload';

    return (
        <div className="new-service-page__step">
            <div className="new-service-page__step-head">
                <h2>
                    {sourceMode === 'github' ? 'Pick a repository'
                        : sourceMode === 'template' ? 'Choose a template'
                            : sourceMode === 'local' ? 'Point at the service'
                                : sourceMode === 'upload' ? 'Upload the archive'
                                    : 'Connect the remote'}
                </h2>
                {SOURCE_NEEDS[sourceMode] && (
                    <p className="new-service-page__need">
                        <Info size={14} />
                        {SOURCE_NEEDS[sourceMode]}
                    </p>
                )}
            </div>

            {sourceMode === 'github' && (
                <div className="new-service-page__pane">
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
                                {reposLoading && <div className="new-service-page__repo-state">Loading repositories…</div>}
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
                                <SiGithub size={20} />
                            </span>
                            <div>
                                <h3>{githubConfigured ? 'Connect GitHub' : 'GitHub connection is not configured'}</h3>
                                <p>
                                    {githubConfigured
                                        ? 'Authorize ServerKit once, then choose a repository from your GitHub account.'
                                        : 'Add the GitHub OAuth app credentials in Settings before connecting.'}
                                </p>
                            </div>
                            <div className="new-service-page__connect-actions">
                                <Button type="button" onClick={handleConnectGithub} disabled={!githubConfigured}>
                                    <SiGithub size={16} />
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
            )}

            {sourceMode === 'template' && (
                <div className="new-service-page__pane">
                    {templatesLoading && <div className="new-service-page__repo-state">Loading templates…</div>}
                    {!templatesLoading && templates.length === 0 && (
                        <div className="new-service-page__repo-state">No deploy templates available yet.</div>
                    )}
                    {!templatesLoading && templates.map(template => {
                        const active = selectedTemplate?.id === template.id;
                        return (
                            <button
                                key={template.id}
                                type="button"
                                className={`new-service-page__template-card ${active ? 'new-service-page__template-card--active' : ''}`}
                                onClick={() => selectTemplateById(template.id)}
                            >
                                <span className="new-service-page__template-card-icon">
                                    <TemplateIcon template={template} />
                                </span>
                                <span className="new-service-page__template-card-body">
                                    <span className="new-service-page__template-card-head">
                                        <strong>{template.name}</strong>
                                        {FEATURED_TEMPLATES.includes(template.id) && (
                                            <Badge variant="info">Featured</Badge>
                                        )}
                                        {template.version && <Badge variant="outline">v{template.version}</Badge>}
                                    </span>
                                    <span className="new-service-page__template-card-desc">{template.description}</span>
                                    <span className="new-service-page__template-card-meta">
                                        {(template.categories || []).slice(0, 3).map(cat => (
                                            <span key={cat} className="tg">{cat}</span>
                                        ))}
                                        {template.repo?.url && <em>{template.repo.url}</em>}
                                    </span>
                                </span>
                                {active ? <CheckCircle2 size={20} /> : <ArrowRight size={20} />}
                            </button>
                        );
                    })}

                    {/* Bring your own — no curated entry needed. Any repo with a
                        serverkit.yml / Docker Compose / Dockerfile deploys the same
                        way; this switches to the Git-remote input in place. */}
                    <div className="new-service-page__byo">
                        <div>
                            <strong>Bring your own manifest</strong>
                            <span>Deploy any Git repo that ships a serverkit.yml, Docker Compose, or Dockerfile — we detect it for you.</span>
                        </div>
                        <Button type="button" variant="outline" onClick={() => selectSource('manual')}>
                            <GitBranch size={16} />
                            Use a repo URL
                        </Button>
                    </div>

                    <Link to="/templates?kind=repo" className="new-service-page__pane-link">
                        <Package size={14} />
                        Open the full template library
                    </Link>
                </div>
            )}

            {sourceMode === 'local' && (
                <div className="new-service-page__pane">
                    <div className="new-service-page__field">
                        <Label htmlFor="local-path">Path on server</Label>
                        <Input
                            id="local-path"
                            value={localPath}
                            onChange={(e) => setLocalPath(e.target.value)}
                            placeholder="/opt/my-service"
                            autoComplete="off"
                        />
                    </div>
                    <div className="new-service-page__field">
                        <Label htmlFor="compose-file">Compose file (optional)</Label>
                        <Input
                            id="compose-file"
                            value={composeFile}
                            onChange={(e) => setComposeFile(e.target.value)}
                            placeholder="docker-compose.yml"
                            autoComplete="off"
                        />
                    </div>
                    <div className="new-service-page__field">
                        <Label htmlFor="systemd-unit">systemd unit (optional)</Label>
                        <Input
                            id="systemd-unit"
                            value={systemdUnit}
                            onChange={(e) => setSystemdUnit(e.target.value)}
                            placeholder="my-service"
                            autoComplete="off"
                        />
                    </div>
                    <div className="new-service-page__field">
                        <Label htmlFor="managed-by">Managed by</Label>
                        <select id="managed-by" value={managedBy} onChange={(e) => setManagedBy(e.target.value)}>
                            <option value="auto">Auto-detect</option>
                            <option value="docker_compose">Docker Compose</option>
                            <option value="systemd">systemd</option>
                        </select>
                    </div>
                </div>
            )}

            {sourceMode === 'upload' && (
                <div className="new-service-page__pane">
                    <div
                        className={`new-service-page__upload-drop ${uploadDragOver ? 'new-service-page__upload-drop--over' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setUploadDragOver(true); }}
                        onDragLeave={() => setUploadDragOver(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setUploadDragOver(false);
                            onUploadFile(e.dataTransfer.files[0]);
                        }}
                        onClick={() => document.getElementById('upload-zip')?.click()}
                    >
                        <FileArchive size={32} />
                        <span>{uploadFile ? uploadFile.name : 'Drag a zip here or click to browse'}</span>
                        <input
                            id="upload-zip"
                            type="file"
                            accept=".zip,application/zip,application/x-zip-compressed"
                            className="sr-only"
                            onChange={(e) => onUploadFile(e.target.files[0])}
                        />
                    </div>
                </div>
            )}

            {sourceMode === 'manual' && (
                <div className="new-service-page__pane">
                    <div className="new-service-page__field">
                        <Label htmlFor="manual-repo-url">Repository URL</Label>
                        <Input
                            id="manual-repo-url"
                            value={manualRepoUrl}
                            onChange={(e) => handleManualRepoChange(e.target.value)}
                            placeholder="git@gitea.example.com:owner/repo.git"
                            autoComplete="off"
                        />
                    </div>
                </div>
            )}

            {/* Detected service name + branch, editable inline. */}
            <div className="new-service-page__inline-fields">
                <div className="new-service-page__field">
                    <Label htmlFor="service-name-inline">Service name</Label>
                    <Input
                        id="service-name-inline"
                        value={serviceName}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="my-service"
                        minLength={2}
                    />
                </div>
                {showBranch && (
                    <div className="new-service-page__field">
                        <Label htmlFor="branch-inline">Branch</Label>
                        {sourceMode === 'github' && branches.length > 0 ? (
                            <select
                                id="branch-inline"
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
                                id="branch-inline"
                                value={branch}
                                onChange={(e) => setBranch(e.target.value)}
                                placeholder="main"
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ConnectStep;
