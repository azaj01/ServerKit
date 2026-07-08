// Runtime-extension shim for `react-dom` — re-exports the HOST instance.
const m = (globalThis.__SK_VENDOR__ || {})['react-dom'];
if (!m) {
    throw new Error('[serverkit] host react-dom unavailable — vendorShare did not run');
}
export default m.default ?? m;
export const createPortal = m.createPortal;
export const flushSync = m.flushSync;
export const findDOMNode = m.findDOMNode;
export const render = m.render;
export const hydrate = m.hydrate;
export const unmountComponentAtNode = m.unmountComponentAtNode;
export const version = m.version;
