import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

export const APP_TYPE_OPTIONS = [
    { value: 'auto', label: 'Auto-detect' },
    { value: 'docker', label: 'Docker / Compose' },
    { value: 'flask', label: 'Python' },
    { value: 'django', label: 'Django' },
    { value: 'php', label: 'PHP' },
    { value: 'static', label: 'Static site' },
];

export const BUILD_METHOD_OPTIONS = [
    { value: 'auto', label: 'Auto build' },
    { value: 'nixpacks', label: 'Nixpacks' },
    { value: 'dockerfile', label: 'Dockerfile' },
    { value: 'custom', label: 'Custom command' },
];

const APP_TYPE_LABELS = Object.fromEntries(APP_TYPE_OPTIONS.map(o => [o.value, o.label]));
const BUILD_METHOD_LABELS = Object.fromEntries(BUILD_METHOD_OPTIONS.map(o => [o.value, o.label]));

// One inline "you'll need X" line per source — replaces the old three-part
// SOURCE_GUIDES explainer block.
export const SOURCE_NEEDS = {
    github: 'A GitHub account connected via OAuth (Settings → Connections).',
    manual: 'The repository URL, plus a deploy key or credentials if it is private.',
    local: 'The path on the server, and its compose file or systemd unit if any.',
    upload: 'A .zip of the project (with a Dockerfile/compose or a detectable runtime).',
    template: 'A curated repo template — its manifests prefill the deploy for you.',
};

export function slugify(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function repoNameFromUrl(value) {
    if (!value) return '';
    const cleaned = value.trim().replace(/\.git$/, '');
    const parts = cleaned.split(/[/:]/).filter(Boolean);
    return slugify(parts[parts.length - 1] || '');
}

export function normalizeManualRepo(value) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}.git`;
    if (/^github\.com\//i.test(trimmed)) return `https://${trimmed.replace(/\.git$/, '')}.git`;
    return trimmed;
}

export function formatAppType(value) {
    return APP_TYPE_LABELS[value] || value || 'Auto-detect';
}

export function formatBuildMethod(value) {
    return BUILD_METHOD_LABELS[value] || value || 'Auto build';
}

// Map an API template detail object (kind: repo) to the flat fields the wizard
// prefills. Keeps the create-payload contract identical to before.
function templateFields(template) {
    const repo = template.repo || {};
    return {
        id: template.id,
        name: template.name,
        serviceName: repo.service_name || template.id,
        description: template.description,
        repoUrl: repo.url,
        branch: repo.branch || 'main',
        appType: repo.app_type || 'auto',
        buildMethod: repo.build_method || 'auto',
        port: repo.port || null,
        categories: template.categories || [],
    };
}

/**
 * All state, derived values, and handlers for the New Service wizard. Kept in a
 * hook so the page component is just step orchestration + submit, and the step
 * components stay presentational. Submit payloads are byte-identical to the
 * pre-redesign monolith — this is a flow re-skin, not a backend change.
 */
export function useNewServiceForm() {
    const navigate = useNavigate();
    const toast = useToast();
    const [searchParams] = useSearchParams();

    const [step, setStep] = useState(1);
    const [sourceMode, setSourceMode] = useState('github');

    const [githubStatus, setGithubStatus] = useState(null);
    const [repos, setRepos] = useState([]);
    const [reposLoading, setReposLoading] = useState(false);
    const [repoSearch, setRepoSearch] = useState('');
    const [selectedRepo, setSelectedRepo] = useState(null);

    // Repo-kind deploy templates, fetched from the backend catalog.
    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [templateManifest, setTemplateManifest] = useState(null);
    const [templateManifestLoading, setTemplateManifestLoading] = useState(false);

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
    const [ingressPlane, setIngressPlane] = useState('nginx');
    const [autoDeploy, setAutoDeploy] = useState(true);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [buildpack, setBuildpack] = useState(null);
    const [buildpackLoading, setBuildpackLoading] = useState(false);
    const [buildpackOverrides, setBuildpackOverrides] = useState({});

    const [localPath, setLocalPath] = useState('');
    const [composeFile, setComposeFile] = useState('');
    const [systemdUnit, setSystemdUnit] = useState('');
    const [managedBy, setManagedBy] = useState('auto');

    const [uploadFile, setUploadFile] = useState(null);
    const [uploadDragOver, setUploadDragOver] = useState(false);

    const [projects, setProjects] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');
    const [projectEnvironments, setProjectEnvironments] = useState([]);

    const githubConnection = githubStatus?.connection;
    const githubConfigured = githubStatus?.configured;
    const normalizedManualRepo = useMemo(() => normalizeManualRepo(manualRepoUrl), [manualRepoUrl]);

    const activeManifest = sourceMode === 'template' ? templateManifest : repoManifest;
    const activeManifestLoading = sourceMode === 'template' ? templateManifestLoading : repoManifestLoading;
    const recommended = activeManifest?.recommended || {};

    const detectedServiceName = useMemo(() => {
        if (sourceMode === 'template' && selectedTemplate) {
            return slugify(selectedTemplate.serviceName || selectedTemplate.name || '');
        }
        if (sourceMode === 'github' && selectedRepo) return slugify(selectedRepo.name || '');
        return repoNameFromUrl(normalizedManualRepo);
    }, [normalizedManualRepo, selectedRepo, selectedTemplate, sourceMode]);

    const serviceName = nameTouched ? name : detectedServiceName;

    const canSubmit = sourceMode === 'github'
        ? Boolean(githubConnection && selectedRepo && serviceName?.length >= 2)
        : sourceMode === 'template'
            ? Boolean(selectedTemplate && serviceName?.length >= 2)
            : sourceMode === 'local'
                ? Boolean(serviceName?.length >= 2 && localPath?.length >= 1)
                : sourceMode === 'upload'
                    ? Boolean(serviceName?.length >= 2 && uploadFile)
                    : Boolean(normalizedManualRepo && serviceName?.length >= 2);

    // Whether step 2 (Connect) has enough input to move on to Review.
    const canProceedFromConnect = sourceMode === 'github'
        ? Boolean(githubConnection && selectedRepo)
        : sourceMode === 'template'
            ? Boolean(selectedTemplate)
            : sourceMode === 'local'
                ? Boolean(localPath?.length >= 1)
                : sourceMode === 'upload'
                    ? Boolean(uploadFile)
                    : Boolean(normalizedManualRepo);

    const buildSummary = buildMethod === 'auto' && recommended.build_method
        ? `Auto → ${formatBuildMethod(recommended.build_method)}`
        : formatBuildMethod(buildMethod);

    const ingressProxyEligible = appType === 'docker'
        || appType === 'auto'
        || (sourceMode === 'local' && managedBy === 'docker_compose');

    const buildpackEligible = (buildMethod === 'auto' || buildMethod === 'nixpacks')
        && (sourceMode === 'github' || sourceMode === 'manual' || sourceMode === 'template');

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

    // The template gallery shows the FULL catalog (repo + one-click compose), so
    // the picker feels like a real app gallery rather than a single row.
    const loadTemplates = useCallback(async () => {
        setTemplatesLoading(true);
        try {
            const data = await api.listTemplates();
            setTemplates(data.templates || []);
        } catch (err) {
            setTemplates([]);
        } finally {
            setTemplatesLoading(false);
        }
    }, []);

    useEffect(() => { loadGithubStatus(); }, [loadGithubStatus]);
    useEffect(() => { loadTemplates(); }, [loadTemplates]);

    useEffect(() => {
        if (!ingressProxyEligible && ingressPlane !== 'nginx') {
            setIngressPlane('nginx');
        }
    }, [ingressProxyEligible, ingressPlane]);

    useEffect(() => {
        let cancelled = false;
        api.getProjects()
            .then(data => {
                if (cancelled) return;
                setProjects(Array.isArray(data?.projects) ? data.projects : []);
            })
            .catch(() => { if (!cancelled) setProjects([]); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!selectedProjectId) {
            setProjectEnvironments([]);
            setSelectedEnvironmentId('');
            return undefined;
        }
        let cancelled = false;
        api.getProject(selectedProjectId)
            .then(data => {
                if (cancelled) return;
                const envs = Array.isArray(data?.project?.environments) ? data.project.environments : [];
                setProjectEnvironments(envs);
                const def = envs.find(e => e.is_default) || envs[0];
                setSelectedEnvironmentId(def ? String(def.id) : '');
            })
            .catch(() => {
                if (!cancelled) {
                    setProjectEnvironments([]);
                    setSelectedEnvironmentId('');
                }
            });
        return () => { cancelled = true; };
    }, [selectedProjectId]);

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
                if (!port && detectedPort) setPort(String(detectedPort));
            })
            .catch((err) => {
                if (!cancelled) {
                    setRepoManifest(null);
                    toast.error(err.message || 'Failed to inspect repository manifests');
                }
            })
            .finally(() => { if (!cancelled) setRepoManifestLoading(false); });
        return () => { cancelled = true; };
    }, [branch, port, selectedRepo, sourceMode, toast]);

    useEffect(() => {
        if (selectedRepo && !nameTouched) {
            setName(slugify(selectedRepo.name || ''));
        }
    }, [selectedRepo, nameTouched]);

    // Build-pack detection (zero-Dockerfile). Only repo-based sources.
    useEffect(() => {
        if (!buildpackEligible) {
            setBuildpack(null);
            setBuildpackLoading(false);
            return undefined;
        }
        const body = { branch: branch || 'main', name: detectedServiceName || 'app' };
        if (sourceMode === 'github' && selectedRepo && githubConnection) {
            body.source_connection_id = githubConnection.id;
            body.repository_full_name = selectedRepo.full_name;
            body.repo_url = `https://github.com/${selectedRepo.full_name}.git`;
        } else if (sourceMode === 'template' && selectedTemplate) {
            body.repo_url = selectedTemplate.repoUrl;
        } else if (sourceMode === 'manual' && normalizedManualRepo) {
            body.repo_url = normalizedManualRepo;
        } else {
            setBuildpack(null);
            return undefined;
        }
        let cancelled = false;
        setBuildpackLoading(true);
        setBuildpackOverrides({});
        api.detectBuildpack(body)
            .then((data) => { if (!cancelled) setBuildpack(data); })
            .catch(() => { if (!cancelled) setBuildpack(null); })
            .finally(() => { if (!cancelled) setBuildpackLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [buildpackEligible, sourceMode, selectedRepo, selectedTemplate, normalizedManualRepo, branch, githubConnection]);

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

    function selectSource(mode) {
        setSourceMode(mode);
        if (mode === 'local') setAppType('docker');
        if (mode === 'upload') setAppType('auto');
    }

    // Apply a repo-kind template (API detail object) to the flat wizard fields
    // and fetch its live/hinted manifest for the review step.
    const selectTemplate = useCallback((templateDetail) => {
        const fields = templateFields(templateDetail);
        setSelectedTemplate(fields);
        setSelectedRepo(null);
        setManualRepoUrl(fields.repoUrl || '');
        setName(slugify(fields.serviceName || fields.name || ''));
        setNameTouched(false);
        setBranch(fields.branch || 'main');
        setAppType(fields.appType || 'auto');
        setBuildMethod(fields.buildMethod || 'auto');
        setPort(fields.port ? String(fields.port) : '');
        setAutoDeploy(true);

        setTemplateManifest(null);
        setTemplateManifestLoading(true);
        api.inspectTemplateManifest(fields.id, fields.branch)
            .then((data) => setTemplateManifest(data?.manifest || null))
            .catch(() => setTemplateManifest(null))
            .finally(() => setTemplateManifestLoading(false));
    }, []);

    // Pick a template by id (deep link or list click): fetch its detail, then apply.
    const selectTemplateById = useCallback(async (templateId) => {
        try {
            const result = await api.getTemplate(templateId);
            if (result?.template) {
                setSourceMode('template');
                selectTemplate(result.template);
                return true;
            }
        } catch (err) {
            toast.error(err.message || 'Failed to load template');
        }
        return false;
    }, [selectTemplate, toast]);

    // Pick a template from the gallery. Repo templates continue in the wizard
    // (they deploy from their Git repo); one-click compose templates route to
    // their install flow on the Templates page, which is their real deploy path.
    const pickTemplate = useCallback((template) => {
        if ((template.kind || 'compose') === 'repo') {
            selectTemplateById(template.id);
        } else {
            navigate(`/templates?install=${encodeURIComponent(template.id)}`);
        }
    }, [selectTemplateById, navigate]);

    function handleManualRepoChange(value) {
        setManualRepoUrl(value);
        if (!nameTouched) setName(repoNameFromUrl(normalizeManualRepo(value)));
    }

    function onNameChange(value) {
        setNameTouched(true);
        setName(slugify(value));
    }

    function onUploadFile(file) {
        if (!file) return;
        setUploadFile(file);
        if (!nameTouched) setName(slugify(file.name.replace(/\.zip$/i, '')));
    }

    // Deep links: /services/new?template=<id> or ?source=<mode> land preloaded on
    // the Connect step. Runs once on mount.
    useEffect(() => {
        const templateId = searchParams.get('template');
        const source = searchParams.get('source');
        if (templateId) {
            selectTemplateById(templateId).then((ok) => { if (ok) setStep(2); });
            return;
        }
        if (source && ['github', 'manual', 'local', 'upload', 'template'].includes(source)) {
            selectSource(source);
            setStep(2);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleSubmit(e) {
        if (e) e.preventDefault();
        if (!canSubmit) {
            const msg = sourceMode === 'github'
                ? 'Select a GitHub repository'
                : sourceMode === 'template'
                    ? 'Select a service template'
                    : sourceMode === 'local'
                        ? 'Service name and server path are required'
                        : sourceMode === 'upload'
                            ? 'Service name and a zip file are required'
                            : 'Repository URL is required';
            toast.error(msg);
            return;
        }

        setSubmitting(true);
        const projectEnvPayload = {};
        if (selectedProjectId) {
            projectEnvPayload.project_id = Number(selectedProjectId);
            if (selectedEnvironmentId) projectEnvPayload.environment_id = Number(selectedEnvironmentId);
        }
        try {
            if (sourceMode === 'local') {
                const payload = {
                    name: serviceName,
                    app_type: appType,
                    root_path: localPath.trim(),
                    compose_file: composeFile.trim() || undefined,
                    systemd_unit: systemdUnit.trim() || undefined,
                    managed_by: managedBy === 'auto' ? undefined : managedBy,
                    ingress_plane: ingressProxyEligible ? ingressPlane : 'nginx',
                    ...projectEnvPayload,
                };
                const result = await api.createManualApp(payload);
                toast.success('Manual service registered');
                navigate(`/services/${result.app.id}`);
            } else if (sourceMode === 'upload') {
                const formData = new FormData();
                formData.append('file', uploadFile);
                formData.append('name', serviceName);
                formData.append('app_type', appType);
                formData.append('auto_deploy', autoDeploy ? 'true' : 'false');
                formData.append('ingress_plane', ingressProxyEligible ? ingressPlane : 'nginx');
                if (projectEnvPayload.project_id) formData.append('project_id', projectEnvPayload.project_id);
                if (projectEnvPayload.environment_id) formData.append('environment_id', projectEnvPayload.environment_id);
                const result = await api.uploadAppZip(formData);
                toast.success('Upload service created');
                navigate(`/services/${result.app.id}`);
            } else {
                const payload = {
                    name: serviceName,
                    branch: branch.trim() || null,
                    app_type: appType,
                    build_method: buildMethod,
                    port: port ? Number(port) : null,
                    auto_deploy: autoDeploy,
                    ingress_plane: ingressProxyEligible ? ingressPlane : 'nginx',
                    ...projectEnvPayload,
                };
                if (recommended.dockerfile_path) payload.dockerfile_path = recommended.dockerfile_path;
                if (recommended.custom_build_cmd) payload.custom_build_cmd = recommended.custom_build_cmd;
                if (recommended.custom_start_cmd) payload.custom_start_cmd = recommended.custom_start_cmd;
                if (buildpackEligible && buildpack?.plan) {
                    payload.buildpack_plan = buildpack.plan;
                    if (Object.keys(buildpackOverrides).length > 0) {
                        payload.buildpack_overrides = buildpackOverrides;
                    }
                }

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

                const result = await api.createAppFromRepository(payload);
                toast.success('Repository service created');
                navigate(`/services/${result.app.id}`);
            }
        } catch (err) {
            toast.error(err.message || 'Failed to create service');
        } finally {
            setSubmitting(false);
        }
    }

    return {
        // step control
        step, setStep,
        // source
        sourceMode, selectSource,
        // github
        githubStatus, githubConnection, githubConfigured,
        repos, reposLoading, repoSearch, setRepoSearch, selectedRepo, setSelectedRepo,
        loadGithubRepos, handleConnectGithub, branches, branchesLoading,
        // templates
        templates, templatesLoading, selectedTemplate, selectTemplate, selectTemplateById, pickTemplate,
        // manual / local / upload
        manualRepoUrl, handleManualRepoChange, normalizedManualRepo,
        localPath, setLocalPath, composeFile, setComposeFile,
        systemdUnit, setSystemdUnit, managedBy, setManagedBy,
        uploadFile, onUploadFile, uploadDragOver, setUploadDragOver,
        // core fields
        name, serviceName, onNameChange, nameTouched,
        branch, setBranch, appType, setAppType, buildMethod, setBuildMethod,
        port, setPort, ingressPlane, setIngressPlane, autoDeploy, setAutoDeploy,
        advancedOpen, setAdvancedOpen,
        // manifest / buildpack
        activeManifest, activeManifestLoading, recommended, buildSummary,
        buildpack, buildpackLoading, buildpackOverrides, setBuildpackOverrides, buildpackEligible,
        // projects
        projects, selectedProjectId, setSelectedProjectId,
        selectedEnvironmentId, setSelectedEnvironmentId, projectEnvironments,
        // derived + submit
        ingressProxyEligible, canSubmit, canProceedFromConnect, submitting, handleSubmit,
    };
}
