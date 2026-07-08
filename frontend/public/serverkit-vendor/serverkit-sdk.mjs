// Runtime-extension shim for `serverkit-sdk` — re-exports the HOST's SDK
// instance (captured in globalThis.__SK_VENDOR__ by vendorShare.js). This IS
// the sanctioned SDK surface; keep it in lock-step with
// src/plugins/sdk/index.js (asserted by the frontend build + backend
// test_sdk_contract). A runtime extension imports everything it needs from
// here, so a host restructure behind the SDK never breaks it.
const m = (globalThis.__SK_VENDOR__ || {})['serverkit-sdk'];
if (!m) {
    throw new Error('[serverkit] host serverkit-sdk unavailable — vendorShare did not run');
}
export const SDK_VERSION = m.SDK_VERSION;
// api
export const api = m.api;
export const defaultApi = m.defaultApi;
// design-system primitives
export const KpiBand = m.KpiBand;
export const MetricCard = m.MetricCard;
export const Gauge = m.Gauge;
export const ScoreGauge = m.ScoreGauge;
export const Sparkline = m.Sparkline;
export const Pill = m.Pill;
export const PageTopbar = m.PageTopbar;
export const DataTable = m.DataTable;
export const ResourceCard = m.ResourceCard;
export const ResourceList = m.ResourceList;
export const Drawer = m.Drawer;
export const SchedulePicker = m.SchedulePicker;
// contexts / hooks
export const useToast = m.useToast;
export const useAuth = m.useAuth;
export const useTheme = m.useTheme;
export const useServerkitAI = m.useServerkitAI;
export const AIContext = m.AIContext;
// routing helpers
export const Link = m.Link;
export const NavLink = m.NavLink;
export const useNavigate = m.useNavigate;
export const useLocation = m.useLocation;
export const useParams = m.useParams;
export const Outlet = m.Outlet;
