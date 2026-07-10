// GPU Monitor, contributed through the extension system. As of the first
// CORE_SLIM slice (plan 32 #7) the page component lives INSIDE the extension
// (./components/GpuMonitor) and its /api/v1/gpu backend is bridged from
// builtin-extensions/serverkit-gpu/backend — the core page + core blueprint are
// gone. The extension owns the /gpu route + sidebar/palette entries via its
// manifest, and declares an sdk_version range for the runtime SDK gate.
import GpuMonitor from './components/GpuMonitor';

export function GpuMonitorPage() {
    return <GpuMonitor />;
}
