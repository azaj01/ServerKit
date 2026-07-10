// Single map of panel surface -> serverkit.ai docs URL. Keeping every external
// docs link in one place means the White Label "hide external links" rule lives
// in exactly one component (DocsLink), and URLs don't drift page to page.

const DOCS_BASE = 'https://serverkit.ai/docs';

export const DOCS_LINKS = {
    deploySources: `${DOCS_BASE}/deploy-sources`,
    manifest: `${DOCS_BASE}/manifest`,
    extensions: `${DOCS_BASE}/extensions`,
    extensionsInstalling: `${DOCS_BASE}/extensions/installing`,
    extensionsBuilding: `${DOCS_BASE}/extensions/building`,
    extensionsPublishing: `${DOCS_BASE}/extensions/publishing`,
    extensionsSecurity: `${DOCS_BASE}/extensions/security`,
};

export function docsUrl(key) {
    return DOCS_LINKS[key] || DOCS_BASE;
}

export default DOCS_LINKS;
