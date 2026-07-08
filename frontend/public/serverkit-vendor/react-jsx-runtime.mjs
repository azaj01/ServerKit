// Runtime-extension shim for `react/jsx-runtime` — re-exports the HOST instance.
// Every JSX-automatic-runtime extension bundle imports this; the shim keeps it
// on the panel's single React copy.
const m = (globalThis.__SK_VENDOR__ || {})['react/jsx-runtime'];
if (!m) {
    throw new Error('[serverkit] host react/jsx-runtime unavailable — vendorShare did not run');
}
export const Fragment = m.Fragment;
export const jsx = m.jsx;
export const jsxs = m.jsxs;
export const jsxDEV = m.jsxDEV;
