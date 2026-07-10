// Shared deploy-template catalog. One source of truth consumed by both the
// New Service wizard ("Deploy Template" source) and the Templates tab
// ("Deploy templates" section), so there is one list with two entry points.
//
// `example: true` marks a demonstration entry (badged "Example" in the UI).
// Real curated templates can be appended here as they are added.

export const DEPLOY_TEMPLATES = [
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
        example: true,
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

export function getDeployTemplate(id) {
    return DEPLOY_TEMPLATES.find((t) => t.id === id) || null;
}

export default DEPLOY_TEMPLATES;
