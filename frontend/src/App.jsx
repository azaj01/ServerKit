import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { ResourceTierProvider } from './contexts/ResourceTierContext';
import { NotificationsProvider } from './contexts/NotificationsContext';
import { Toaster } from './components/ui/sonner';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Setup from './pages/Setup';
import ApplicationDetail from './pages/ApplicationDetail';
import Docker from './pages/Docker';
import Databases from './pages/Databases';
import Domains from './pages/Domains';
import Monitoring from './pages/Monitoring';
import Backups from './pages/Backups';
import Terminal from './pages/Terminal';
import Settings from './pages/Settings';
import FileManager from './pages/FileManager';
import FTPServer from './pages/FTPServer';
// Firewall is now part of Security page
import CronJobs from './pages/CronJobs';
import Security from './pages/Security';
import Services from './pages/Services';
import NewService from './pages/NewService';
import ServiceDetail from './pages/ServiceDetail';
import Templates from './pages/Templates';
import WorkflowBuilder from './pages/WorkflowBuilder';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import AgentFleet from './pages/AgentFleet';
import FleetMonitor from './pages/FleetMonitor';
import TabGroupLayout from './layouts/TabGroupLayout';
import { SERVER_TABS } from './components/servers/serverTabs';
import { DOMAIN_TABS } from './components/domains/domainTabs';
import { SERVICE_TABS } from './components/services/serviceTabs';
import { FILE_TABS } from './components/files/fileTabs';
import { MONITOR_TABS } from './components/monitoring/monitorTabs';
import { MARKET_TABS } from './components/marketplace/marketTabs';
import { WORDPRESS_TABS } from './components/wordpress/wordpressTabs';
import { BACKUP_TABS } from './components/backups/backupTabs';
import { SECURITY_TABS } from './components/security/securityTabs';
import Downloads from './pages/Downloads';
import WordPress from './pages/WordPress';
import WordPressDetail from './pages/WordPressDetail';
import WordPressProjects from './pages/WordPressProjects';
import WordPressProject from './pages/WordPressProject';
import SSLCertificates from './pages/SSLCertificates';
import Email from './pages/Email';
import SSOCallback from './pages/SSOCallback';
import SourceConnectionCallback from './pages/SourceConnectionCallback';
import DatabaseMigration from './pages/DatabaseMigration';
import ServerTemplates from './pages/ServerTemplates';
import RemoteAccess from './pages/RemoteAccess';
import Workspaces from './pages/Workspaces';
import WorkspaceDetail from './pages/WorkspaceDetail';
import DNSZones from './pages/DNSZones';
import StatusPages from './pages/StatusPages';
import PublicStatusPage from './pages/PublicStatusPage';
import CloudProvision from './pages/CloudProvision';
import Marketplace from './pages/Marketplace';
import SecretsWebhooks from './pages/SecretsWebhooks';
import StyleGuide from './pages/StyleGuide';
import AppMap from './pages/AppMap';
import Documentation from './pages/Documentation';
import Deployments from './pages/Deployments';
import GpuMonitor from './pages/GpuMonitor';
import DynamicDns from './pages/DynamicDns';
import QueueOperations from './pages/QueueOperations';
import QueueDetail from './pages/QueueDetail';
import Notifications from './pages/Notifications';
import DeliveryLog from './pages/DeliveryLog';
import Telemetry from './pages/Telemetry';
import Jobs from './pages/Jobs';
import useExtensionRoutes from './plugins/ExtensionRoutes';
import { useContributions } from './plugins/contributions';

// Page title mapping
const PAGE_TITLES = {
    '/': 'Dashboard',
    '/login': 'Login',
    '/register': 'Register',
    '/setup': 'Setup',
    '/services': 'Services',
    '/services/new': 'New Service',
    '/apps': 'Applications',
    '/wordpress': 'WordPress Sites',
    '/wordpress/projects': 'WordPress Projects',
    '/templates': 'Templates',
    '/deployments': 'Deployment Activity',
    '/workflow': 'Workflow Builder',
    '/domains': 'Domains',
    '/databases': 'Databases',
    '/ssl': 'SSL Certificates',
    '/docker': 'Docker',
    '/servers': 'Servers',
    '/downloads': 'Downloads',
    '/files': 'File Manager',
    '/ftp': 'FTP Server',
    '/monitoring': 'Monitoring',
    '/backups': 'Backups',
    '/cron': 'Cron Jobs',
    '/security': 'Security',
    '/email': 'Email Server',
    '/terminal': 'Terminal',
    '/settings': 'Settings',
    '/connections/callback/github': 'GitHub Connection',
    '/migrate': 'Database Migration',
    '/fleet': 'Agent Fleet',
    '/fleet-monitor': 'Fleet Monitor',
    '/agent-plugins': 'Marketplace',
    '/server-templates': 'Server Templates',
    '/workspaces': 'Workspaces',
    '/workspaces/:id': 'Workspace',
    '/workspaces/:id/overview': 'Workspace Overview',
    '/workspaces/:id/servers': 'Workspace Servers',
    '/workspaces/:id/services': 'Workspace Services',
    '/workspaces/:id/sites': 'Workspace Sites',
    '/workspaces/:id/members': 'Workspace Members',
    '/workspaces/:id/settings': 'Workspace Settings',
    '/workspaces/:id/settings/general': 'Workspace Settings',
    '/workspaces/:id/settings/navigation': 'Workspace Navigation Permissions',
    '/dns': 'DNS Zones',
    '/status-pages': 'Status Pages',
    '/cloud': 'Cloud Provisioning',
    '/marketplace': 'Marketplace',
    '/secrets': 'Secrets & Webhooks',
    '/secrets/:tab': 'Secrets & Webhooks',
    '/style-guide': 'Style Guide',
    '/app-map': 'App Map',
    '/documentation': 'Documentation',
    '/gpu': 'GPU Monitor',
    '/dynamic-dns': 'Dynamic DNS',
    '/queue': 'Queue Bus',
    '/notifications': 'Notifications',
    '/admin/notifications': 'Notification Delivery Log',
    '/telemetry': 'Telemetry',
    '/jobs': 'Jobs',
};

function PageTitleUpdater() {
    const location = useLocation();
    const { page_titles: pluginTitles } = useContributions();

    useEffect(() => {
        const path = location.pathname;
        let title = PAGE_TITLES[path] || (pluginTitles && pluginTitles[path]);

        // Handle dynamic routes and tab sub-routes
        if (!title) {
            if (path.startsWith('/workspaces/')) {
                const parts = path.split('/');
                const tab = parts[3];
                const section = parts[4];
                if (tab === 'settings' && section) {
                    title = PAGE_TITLES[`/workspaces/:id/settings/${section}`] || 'Workspace Settings';
                } else if (tab) {
                    title = PAGE_TITLES[`/workspaces/:id/${tab}`] || 'Workspace';
                } else {
                    title = 'Workspace';
                }
            }
            // Check if it's a base page with a tab suffix (e.g., /security/firewall)
            else {
                const basePath = '/' + path.split('/')[1];
                if (PAGE_TITLES[basePath]) {
                    title = PAGE_TITLES[basePath];
                } else if (pluginTitles && pluginTitles[basePath]) {
                    title = pluginTitles[basePath];
                } else if (path.startsWith('/services/')) title = 'Service Details';
                else if (path.startsWith('/apps/')) title = 'Application Details';
                else if (path.startsWith('/servers/')) title = 'Server Details';
                else if (path.startsWith('/wordpress/projects/')) title = 'WordPress Pipeline';
                else if (path.startsWith('/wordpress/')) title = 'WordPress Site';
                else title = 'ServerKit';
            }
        }

        document.title = title ? `${title} | ServerKit` : 'ServerKit';
    }, [location, pluginTitles]);

    return null;
}

function PrivateRoute({ children }) {
    const { isAuthenticated, loading, needsSetup, needsMigration } = useAuth();

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    // Priority: migrations > setup > auth
    if (needsMigration) {
        return <Navigate to="/migrate" />;
    }

    if (needsSetup) {
        return <Navigate to="/setup" />;
    }

    return isAuthenticated ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
    const { isAuthenticated, loading, needsSetup, needsMigration } = useAuth();

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    // Priority: migrations > setup > auth
    if (needsMigration) {
        return <Navigate to="/migrate" />;
    }

    if (needsSetup) {
        return <Navigate to="/setup" />;
    }

    return isAuthenticated ? <Navigate to="/" /> : children;
}

function SetupRoute({ children }) {
    const { loading, needsSetup, isAuthenticated } = useAuth();

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    // If setup is not needed, redirect appropriately
    if (!needsSetup) {
        return isAuthenticated ? <Navigate to="/" /> : <Navigate to="/login" />;
    }

    return children;
}

function LegacyGitExtRedirect() {
    const { tab } = useParams();
    return <Navigate to={tab ? `/git/${tab}` : '/git'} replace />;
}

function AppRoutes() {
    const { dashboardRoutes, standaloneGroups } = useExtensionRoutes();
    return (
        <Routes>
            <Route path="/migrate" element={<DatabaseMigration />} />
            <Route path="/setup" element={
                <SetupRoute>
                    <Setup />
                </SetupRoute>
            } />
            <Route path="/login" element={
                <PublicRoute>
                    <Login />
                </PublicRoute>
            } />
            <Route path="/login/callback/:provider" element={
                <PublicRoute>
                    <SSOCallback />
                </PublicRoute>
            } />
            <Route path="/register" element={
                <PublicRoute>
                    <Register />
                </PublicRoute>
            } />
            <Route path="/connections/callback/:provider" element={
                <PrivateRoute>
                    <SourceConnectionCallback />
                </PrivateRoute>
            } />
            <Route path="/status/:slug" element={<PublicStatusPage />} />
            {/* Standalone plugin layouts — bare or custom. Each group is
                a sibling top-level Route under PrivateRoute, so the
                plugin owns the chrome (no DashboardLayout sidebar). */}
            {standaloneGroups.map((group) => {
                const Layout = group.LayoutComponent;
                return (
                    <Route
                        key={`standalone:${group.layoutId}`}
                        element={<PrivateRoute><Layout /></PrivateRoute>}
                    >
                        {group.routes}
                    </Route>
                );
            })}
            <Route path="/" element={
                <PrivateRoute>
                    <DashboardLayout />
                </PrivateRoute>
            }>
                <Route index element={<Dashboard />} />
                {/* Tab groups — each parent TabGroupLayout renders the shared
                    PageTopbar + sub-nav once and swaps only the routed content
                    below, so the tabs act like real tabs (no full-page remount)
                    and keep the group's sidebar item lit. Detail / full-bleed
                    routes (services/:id, wordpress/:id, …) stay outside. */}
                <Route element={<TabGroupLayout tabs={SERVICE_TABS} />}>
                    <Route path="services" element={<Services />} />
                    <Route path="services/new" element={<NewService />} />
                    <Route path="templates" element={<Templates />} />
                    <Route path="deployments" element={<Deployments />} />
                    <Route path="deployments/:jobId" element={<Deployments />} />
                </Route>
                <Route path="services/:id" element={<ServiceDetail />} />
                <Route path="services/:id/:tab" element={<ServiceDetail />} />
                {/* Settings sub-section in the URL (e.g. .../settings/git)
                    so the Settings left-nav is shareable and survives a refresh. */}
                <Route path="services/:id/:tab/:section" element={<ServiceDetail />} />
                <Route path="apps" element={<Navigate to="/services" replace />} />
                <Route path="apps/:id" element={<ApplicationDetail />} />
                <Route path="apps/:id/:tab" element={<ApplicationDetail />} />
                <Route element={<TabGroupLayout tabs={WORDPRESS_TABS} />}>
                    <Route path="wordpress" element={<WordPress />} />
                    <Route path="wordpress/projects" element={<WordPressProjects />} />
                </Route>
                <Route path="wordpress/projects/:id" element={<WordPressProject />} />
                <Route path="wordpress/projects/:id/:tab" element={<WordPressProject />} />
                <Route path="wordpress/:id" element={<WordPressDetail />} />
                <Route path="wordpress/:id/:tab" element={<WordPressDetail />} />
                {/* Settings sub-section in the URL (e.g. .../settings/git) so the
                    Settings left-nav is shareable and survives a refresh. */}
                <Route path="wordpress/:id/:tab/:section" element={<WordPressDetail />} />
                <Route path="workflow" element={<WorkflowBuilder />} />
                <Route element={<TabGroupLayout tabs={DOMAIN_TABS} />}>
                    <Route path="domains" element={<Domains />} />
                    <Route path="dns" element={<DNSZones />} />
                    <Route path="ssl" element={<SSLCertificates />} />
                    <Route path="dynamic-dns" element={<DynamicDns />} />
                </Route>
                <Route path="databases" element={<Databases />} />
                <Route path="databases/:tab" element={<Databases />} />
                <Route path="docker" element={<Docker />} />
                <Route path="docker/:tab" element={<Docker />} />
                <Route element={<TabGroupLayout tabs={SERVER_TABS} />}>
                    <Route path="servers" element={<Servers />} />
                    <Route path="fleet" element={<AgentFleet />} />
                    <Route path="fleet-monitor" element={<FleetMonitor />} />
                    <Route path="cloud" element={<CloudProvision />} />
                    <Route path="remote-access" element={<RemoteAccess />} />
                    <Route path="server-templates" element={<ServerTemplates />} />
                </Route>
                <Route path="servers/:id" element={<ServerDetail />} />
                <Route path="servers/:id/:tab" element={<ServerDetail />} />
                <Route path="agent-plugins" element={<Navigate to="/marketplace" replace />} />
                <Route path="workspaces" element={<Workspaces />} />
                <Route path="workspaces/:id" element={<WorkspaceDetail />} />
                <Route path="workspaces/:id/:tab" element={<WorkspaceDetail />} />
                <Route path="workspaces/:id/:tab/:section" element={<WorkspaceDetail />} />
                <Route element={<TabGroupLayout tabs={MARKET_TABS} />}>
                    <Route path="marketplace" element={<Marketplace />} />
                    <Route path="downloads" element={<Downloads />} />
                </Route>
                <Route path="style-guide" element={<StyleGuide />} />
                <Route path="style-guide/:tab" element={<StyleGuide />} />
                <Route path="app-map" element={<AppMap />} />
                <Route path="app-map/:tab" element={<AppMap />} />
                <Route path="documentation" element={<Documentation />} />
                <Route path="firewall" element={<Navigate to="/security/firewall" replace />} />
                <Route path="git-ext" element={<LegacyGitExtRedirect />} />
                <Route path="git-ext/:tab" element={<LegacyGitExtRedirect />} />
                <Route element={<TabGroupLayout tabs={FILE_TABS} />}>
                    <Route path="files" element={<FileManager />} />
                    <Route path="ftp" element={<FTPServer />} />
                    <Route path="ftp/:tab" element={<FTPServer />} />
                </Route>
                <Route element={<TabGroupLayout tabs={MONITOR_TABS} />}>
                    <Route path="monitoring" element={<Monitoring />} />
                    <Route path="monitoring/:tab" element={<Monitoring />} />
                    <Route path="status-pages" element={<StatusPages />} />
                </Route>
                <Route path="gpu" element={<GpuMonitor />} />
                <Route element={<TabGroupLayout tabs={BACKUP_TABS} />}>
                    <Route path="backups" element={<Backups />} />
                    <Route path="backups/:tab" element={<Backups />} />
                </Route>
                <Route path="cron" element={<CronJobs />} />
                <Route element={<TabGroupLayout tabs={SECURITY_TABS} />}>
                    <Route path="security" element={<Security />} />
                    <Route path="security/:tab" element={<Security />} />
                </Route>
                <Route path="email" element={<Email />} />
                <Route path="email/:tab" element={<Email />} />
                <Route path="terminal" element={<Terminal />} />
                <Route path="terminal/terminal" element={<Navigate to="/terminal/shell" replace />} />
                <Route path="terminal/:tab" element={<Terminal />} />
                <Route path="secrets" element={<SecretsWebhooks />} />
                <Route path="secrets/:tab" element={<SecretsWebhooks />} />
                <Route path="queue" element={<QueueOperations />} />
                <Route path="queue/:groupSlug/:queueSlug" element={<QueueDetail />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="admin/notifications" element={<DeliveryLog />} />
                <Route path="telemetry" element={<Telemetry />} />
                <Route path="jobs" element={<Jobs />} />
                <Route path="settings" element={<Settings />} />
                <Route path="settings/:tab" element={<Settings />} />
                {dashboardRoutes}
            </Route>
        </Routes>
    );
}

function App() {
    return (
        <Router>
            <PageTitleUpdater />
            <ThemeProvider>
                <LayoutProvider>
                    <AuthProvider>
                        <ResourceTierProvider>
                            <ToastProvider>
                                <NotificationsProvider>
                                    <AppRoutes />
                                </NotificationsProvider>
                                <Toaster />
                            </ToastProvider>
                        </ResourceTierProvider>
                    </AuthProvider>
                </LayoutProvider>
            </ThemeProvider>
        </Router>
    );
}

export default App;
