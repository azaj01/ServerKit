// CrowdSec integration UI, contributed through the extension system. Unlike the
// re-export builtins (ftp/status/email…), this page is fully self-contained in
// the extension — no core page to wrap. After sync this folder lives at
// frontend/src/plugins/serverkit-crowdsec/, so '@/…' host aliases resolve.
export { default as CrowdSecPage } from './components/CrowdSecPage.jsx';

// No default export on purpose: PluginLoader legacy-auto-renders any plugin
// default export globally. The route contribution resolves the NAMED export.
