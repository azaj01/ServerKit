import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ResourceTierProvider } from './contexts/ResourceTierContext';
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
import Workspaces from './pages/Workspaces';
import DNSZones from './pages/DNSZones';
import StatusPages from './pages/StatusPages';
import PublicStatusPage from './pages/PublicStatusPage';
import CloudProvision from './pages/CloudProvision';
import Marketplace from './pages/Marketplace';
import StyleGuide from './pages/StyleGuide';
import AppMap from './pages/AppMap';
import Documentation from './pages/Documentation';
import Deployments from './pages/Deployments';
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
    '/dns': 'DNS Zones',
    '/status-pages': 'Status Pages',
    '/cloud': 'Cloud Provisioning',
    '/marketplace': 'Marketplace',
    '/style-guide': 'Style Guide',
    '/app-map': 'App Map',
    '/documentation': 'Documentation',
};

function PageTitleUpdater() {
    const location = useLocation();
    const { page_titles: pluginTitles } = useContributions();

    useEffect(() => {
        const path = location.pathname;
        let title = PAGE_TITLES[path] || (pluginTitles && pluginTitles[path]);

        // Handle dynamic routes and tab sub-routes
        if (!title) {
            // Check if it's a base page with a tab suffix (e.g., /security/firewall)
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
                <Route path="services" element={<Services />} />
                <Route path="services/new" element={<NewService />} />
                <Route path="services/:id" element={<ServiceDetail />} />
                <Route path="apps" element={<Navigate to="/services" replace />} />
                <Route path="apps/:id" element={<ApplicationDetail />} />
                <Route path="apps/:id/:tab" element={<ApplicationDetail />} />
                <Route path="wordpress" element={<WordPress />} />
                <Route path="wordpress/projects" element={<WordPressProjects />} />
                <Route path="wordpress/projects/:id" element={<WordPressProject />} />
                <Route path="wordpress/projects/:id/:tab" element={<WordPressProject />} />
                <Route path="wordpress/:id" element={<WordPressDetail />} />
                <Route path="wordpress/:id/:tab" element={<WordPressDetail />} />
                <Route path="templates" element={<Templates />} />
                <Route path="deployments" element={<Deployments />} />
                <Route path="deployments/:jobId" element={<Deployments />} />
                <Route path="workflow" element={<WorkflowBuilder />} />
                <Route path="domains" element={<Domains />} />
                <Route path="databases" element={<Databases />} />
                <Route path="databases/:tab" element={<Databases />} />
                <Route path="ssl" element={<SSLCertificates />} />
                <Route path="docker" element={<Docker />} />
                <Route path="docker/:tab" element={<Docker />} />
                <Route path="servers" element={<Servers />} />
                <Route path="servers/:id" element={<ServerDetail />} />
                <Route path="servers/:id/:tab" element={<ServerDetail />} />
                <Route path="fleet" element={<AgentFleet />} />
                <Route path="fleet-monitor" element={<FleetMonitor />} />
                <Route path="agent-plugins" element={<Navigate to="/marketplace" replace />} />
                <Route path="server-templates" element={<ServerTemplates />} />
                <Route path="workspaces" element={<Workspaces />} />
                <Route path="dns" element={<DNSZones />} />
                <Route path="status-pages" element={<StatusPages />} />
                <Route path="cloud" element={<CloudProvision />} />
                <Route path="marketplace" element={<Marketplace />} />
                <Route path="style-guide" element={<StyleGuide />} />
                <Route path="style-guide/:tab" element={<StyleGuide />} />
                <Route path="app-map" element={<AppMap />} />
                <Route path="app-map/:tab" element={<AppMap />} />
                <Route path="documentation" element={<Documentation />} />
                <Route path="downloads" element={<Downloads />} />
                <Route path="firewall" element={<Navigate to="/security/firewall" replace />} />
                <Route path="git-ext" element={<LegacyGitExtRedirect />} />
                <Route path="git-ext/:tab" element={<LegacyGitExtRedirect />} />
                <Route path="files" element={<FileManager />} />
                <Route path="ftp" element={<FTPServer />} />
                <Route path="ftp/:tab" element={<FTPServer />} />
                <Route path="monitoring" element={<Monitoring />} />
                <Route path="monitoring/:tab" element={<Monitoring />} />
                <Route path="backups" element={<Backups />} />
                <Route path="backups/:tab" element={<Backups />} />
                <Route path="cron" element={<CronJobs />} />
                <Route path="security" element={<Security />} />
                <Route path="security/:tab" element={<Security />} />
                <Route path="email" element={<Email />} />
                <Route path="email/:tab" element={<Email />} />
                <Route path="terminal" element={<Terminal />} />
                <Route path="terminal/:tab" element={<Terminal />} />
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
                <AuthProvider>
                    <ResourceTierProvider>
                        <ToastProvider>
                            <AppRoutes />
                            <Toaster />
                        </ToastProvider>
                    </ResourceTierProvider>
                </AuthProvider>
            </ThemeProvider>
        </Router>
    );
}

export default App;
