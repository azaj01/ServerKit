// Re-exports the existing host Git page as GitExtPage so the
// contribution system can mount it at /git-ext while the hardcoded
// /git route stays in place. Both routes hit the same /api/v1/git
// backend and share state — this is intentional, the extension is
// the same feature surfaced through the opt-in plugin pipeline so
// you can A/B the two install paths.
//
// After install, this file lives at frontend/src/plugins/serverkit-git/
// so the relative import resolves against the host's pages directory.
import GitPage from '../../pages/Git';

export function GitExtPage() {
    return <GitPage basePath="/git-ext" />;
}
