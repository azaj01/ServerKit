// Self-hosted mail server UI (Stalwart engine), contributed through the
// extension system. Fully self-contained in the extension — no core page to
// wrap. After sync this folder lives at frontend/src/plugins/serverkit-mail/,
// so '@/…' host aliases resolve.
export { default as MailPage } from './components/MailPage.jsx';

// No default export on purpose: PluginLoader legacy-auto-renders any plugin
// default export globally. The route contribution resolves the NAMED export.
