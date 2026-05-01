import React, { useState, useEffect, useRef, useMemo } from 'react';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProcessTable, ProcessDetailsPanel } from '../components/ProcessTable';
import { ServiceCard, ServicesGrid } from '../components/ServiceCard';
import { JournalControls } from '../components/JournalControls';
import TargetPicker from '../components/TargetPicker';
import LogFileList from '../components/log-viewer/LogFileList';
import LogToolbar from '../components/log-viewer/LogToolbar';
import LogContent from '../components/log-viewer/LogContent';
import { formatBytes, logKindFromPath } from '../components/log-viewer/logHelpers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileText, Clock, AlertCircle } from 'lucide-react';

const VALID_TABS = ['logs', 'journal', 'processes', 'services'];

const Terminal = () => {
    const [activeTab, setActiveTab] = useTabParam('/terminal', VALID_TABS);

    return (
        <div className="page-container terminal-page">
            <div className="page-header">
                <div>
                    <h1>Terminal & Logs</h1>
                    <p className="page-subtitle">View logs, manage processes and services</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="logs">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                        Log Files
                    </TabsTrigger>
                    <TabsTrigger value="journal">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <line x1="9" y1="9" x2="15" y2="9"/>
                            <line x1="9" y1="13" x2="15" y2="13"/>
                            <line x1="9" y1="17" x2="11" y2="17"/>
                        </svg>
                        System Journal
                    </TabsTrigger>
                    <TabsTrigger value="processes">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                        Processes
                    </TabsTrigger>
                    <TabsTrigger value="services">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                        Services
                    </TabsTrigger>
                </TabsList>

                <div className="tab-content">
                    <TabsContent value="logs">
                        <LogFilesTab />
                    </TabsContent>
                    <TabsContent value="journal">
                        <JournalTab />
                    </TabsContent>
                    <TabsContent value="processes">
                        <ProcessesTab />
                    </TabsContent>
                    <TabsContent value="services">
                        <ServicesTab />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
};

const LOG_PREFS = {
    showLineNumbers: 'serverkit-logs-line-numbers',
    wrapLines: 'serverkit-logs-wrap',
    lineCount: 'serverkit-logs-line-count',
};

// Operations supported by the agent for remote targets. Only `read` is
// likely available today; everything else is panel-host-only until the
// matching agent verbs land. Mirrors the FileManager pattern.
const REMOTE_LOG_SUPPORTED = new Set(['list', 'read']);

const LogFilesTab = () => {
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();

    const [target, setTarget] = useState({ kind: 'local' });
    const isRemote = target.kind === 'agent';

    const [logFiles, setLogFiles] = useState([]);
    const [selectedLog, setSelectedLog] = useState(null);
    const [logContent, setLogContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingContent, setLoadingContent] = useState(false);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    const [lineCount, setLineCount] = useState(() => {
        const v = parseInt(localStorage.getItem(LOG_PREFS.lineCount), 10);
        return Number.isFinite(v) ? v : 200;
    });
    const [searchPattern, setSearchPattern] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [showLineNumbers, setShowLineNumbers] = useState(() => localStorage.getItem(LOG_PREFS.showLineNumbers) !== 'false');
    const [wrapLines, setWrapLines] = useState(() => localStorage.getItem(LOG_PREFS.wrapLines) !== 'false');
    const [isFullscreen, setIsFullscreen] = useState(false);

    const contentRef = useRef(null);
    const intervalRef = useRef(null);
    const selectedLogObj = useMemo(
        () => logFiles.find((l) => l.path === selectedLog) || null,
        [logFiles, selectedLog]
    );

    useEffect(() => { localStorage.setItem(LOG_PREFS.showLineNumbers, showLineNumbers); }, [showLineNumbers]);
    useEffect(() => { localStorage.setItem(LOG_PREFS.wrapLines, wrapLines); }, [wrapLines]);
    useEffect(() => { localStorage.setItem(LOG_PREFS.lineCount, lineCount); }, [lineCount]);

    // Reset when the target changes (clears previous server's selection)
    useEffect(() => {
        setSelectedLog(null);
        setLogContent('');
        setAutoRefresh(false);
        loadLogFiles();
    }, [target.kind, target.server_id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (autoRefresh && selectedLog) {
            intervalRef.current = setInterval(() => {
                loadLogContent(selectedLog, false);
            }, 3000);
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [autoRefresh, selectedLog, lineCount, appliedSearch]); // eslint-disable-line

    function ensureSupported(op) {
        if (isRemote && !REMOTE_LOG_SUPPORTED.has(op)) {
            toast.error(`This action isn't available on remote targets yet.`);
            return false;
        }
        return true;
    }

    async function loadLogFiles() {
        if (isRemote) {
            // No remote log-file listing yet — gracefully empty out so the
            // panel doesn't get confused with stale local entries.
            setLogFiles([]);
            setLoading(false);
            setError(`Remote log listing isn't available yet for ${target.name}.`);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const data = await api.getLogFiles();
            setLogFiles(data.logs || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function loadLogContent(logPath, showLoading = true) {
        if (showLoading) setLoadingContent(true);
        try {
            let data;
            if (appliedSearch.trim()) {
                data = await api.searchLog(logPath, appliedSearch, lineCount);
            } else {
                data = await api.readLog(logPath, lineCount);
            }
            setLogContent(data.content || data.lines?.join('\n') || '');
            setSelectedLog(logPath);
            setLastUpdated(new Date());

            if (autoRefresh && contentRef.current) {
                contentRef.current.scrollTop = contentRef.current.scrollHeight;
            }
        } catch (err) {
            setLogContent(`Error loading log: ${err.message}`);
        } finally {
            setLoadingContent(false);
        }
    }

    function handleSelectFile(log) {
        loadLogContent(log.path);
    }

    function handleSearchSubmit() {
        setAppliedSearch(searchPattern);
        if (selectedLog) {
            // Re-fetch with new search.
            (async () => {
                setLoadingContent(true);
                try {
                    const data = searchPattern.trim()
                        ? await api.searchLog(selectedLog, searchPattern, lineCount)
                        : await api.readLog(selectedLog, lineCount);
                    setLogContent(data.content || data.lines?.join('\n') || '');
                    setLastUpdated(new Date());
                } catch (err) {
                    setLogContent(`Error: ${err.message}`);
                } finally {
                    setLoadingContent(false);
                }
            })();
        }
    }

    function handleSearchClear() {
        setSearchPattern('');
        setAppliedSearch('');
        if (selectedLog) loadLogContent(selectedLog);
    }

    function scrollToBottom() {
        if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }

    async function handleClearLog() {
        if (!ensureSupported('clear')) return;
        if (!selectedLog) return;
        const confirmed = await confirm({
            title: 'Truncate log file',
            message: `This will permanently empty ${selectedLog}. Continue?`,
            variant: 'danger',
            confirmText: 'Truncate',
        });
        if (!confirmed) return;
        try {
            await api.clearLog(selectedLog);
            setLogContent('');
            toast.success('Log file truncated');
            loadLogFiles();
        } catch (err) {
            toast.error(`Failed: ${err.message}`);
        }
    }

    function handleDownload() {
        if (!logContent) return;
        const blob = new Blob([logContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = selectedLog ? selectedLog.split('/').pop() : 'log.txt';
        a.click();
        URL.revokeObjectURL(url);
    }

    const visibleLineCount = useMemo(() => {
        if (!logContent) return 0;
        return logContent.split('\n').filter(Boolean).length;
    }, [logContent]);

    return (
        <div className={`lv-page ${isFullscreen ? 'fullscreen' : ''}`}>
            <div className="lv-header">
                <div className="lv-header-target">
                    <span className="lv-header-label">Source</span>
                    <TargetPicker
                        feature="logs"
                        value={target}
                        onChange={setTarget}
                    />
                    {isRemote && (
                        <span className="lv-header-hint">
                            <AlertCircle size={12} />
                            Read-only. Most actions require panel-host access.
                        </span>
                    )}
                </div>
                <div className="lv-header-stats">
                    {selectedLogObj && (
                        <>
                            <span className="lv-stat">
                                <FileText size={12} />
                                {selectedLogObj.name}
                            </span>
                            <span className="lv-stat-divider" />
                            <span className="lv-stat">
                                <span className="lv-stat-label">Size</span>
                                <span className="lv-stat-value">{formatBytes(selectedLogObj.size)}</span>
                            </span>
                            <span className="lv-stat">
                                <span className="lv-stat-label">Showing</span>
                                <span className="lv-stat-value">{visibleLineCount.toLocaleString()} lines</span>
                            </span>
                            {lastUpdated && (
                                <span className="lv-stat">
                                    <Clock size={12} />
                                    {lastUpdated.toLocaleTimeString()}
                                </span>
                            )}
                        </>
                    )}
                </div>
            </div>

            {error && (
                <div className="lv-error">
                    <AlertCircle size={14} />
                    <span>{error}</span>
                    <button onClick={() => setError(null)}>&times;</button>
                </div>
            )}

            <div className="lv-layout">
                <LogFileList
                    files={logFiles}
                    selectedPath={selectedLog}
                    onSelect={handleSelectFile}
                    onRefresh={loadLogFiles}
                    loading={loading}
                />

                <div className="lv-viewer">
                    {selectedLog && (
                        <div className="lv-viewer-path">
                            <span className={`lv-viewer-path-dot kind-${logKindFromPath(selectedLog)}`} />
                            <code>{selectedLog}</code>
                        </div>
                    )}

                    <LogToolbar
                        searchPattern={searchPattern}
                        onSearchChange={setSearchPattern}
                        onSearchSubmit={handleSearchSubmit}
                        onSearchClear={handleSearchClear}
                        lineCount={lineCount}
                        onLineCountChange={(n) => { setLineCount(n); if (selectedLog) setTimeout(() => loadLogContent(selectedLog), 0); }}
                        autoRefresh={autoRefresh}
                        onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
                        showLineNumbers={showLineNumbers}
                        onToggleLineNumbers={() => setShowLineNumbers(!showLineNumbers)}
                        wrapLines={wrapLines}
                        onToggleWrap={() => setWrapLines(!wrapLines)}
                        isFullscreen={isFullscreen}
                        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
                        onRefresh={() => selectedLog && loadLogContent(selectedLog)}
                        onDownload={handleDownload}
                        onClear={handleClearLog}
                        onScrollToBottom={scrollToBottom}
                        canAct={!!selectedLog && !loadingContent}
                    />

                    <LogContent
                        ref={contentRef}
                        content={selectedLog ? logContent : ''}
                        loading={loadingContent}
                        emptyMessage={
                            isRemote && logFiles.length === 0
                                ? `Remote log browsing isn't supported yet for ${target.name}.`
                                : logFiles.length === 0
                                    ? 'No log files were found on this server.'
                                    : 'Select a log file from the list to view its contents.'
                        }
                        showLineNumbers={showLineNumbers}
                        wrapLines={wrapLines}
                        searchPattern={appliedSearch}
                    />
                </div>
            </div>

            <ConfirmDialog
                isOpen={confirmState.isOpen}
                title={confirmState.title}
                message={confirmState.message}
                confirmText={confirmState.confirmText}
                cancelText={confirmState.cancelText}
                variant={confirmState.variant}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </div>
    );
};

const JournalTab = () => {
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const [unit, setUnit] = useState('');
    const [lineCount, setLineCount] = useState(100);
    const [priority, setPriority] = useState('');
    const [source, setSource] = useState('');
    const [sourceLabel, setSourceLabel] = useState('');
    const [commonUnits] = useState([
        'nginx', 'apache2', 'mysql', 'mariadb', 'postgresql',
        'php-fpm', 'docker', 'sshd', 'cron', 'systemd'
    ]);

    const isJournalctl = source === 'journalctl' || source === '';

    async function loadJournalLogs() {
        setLoading(true);
        setUnavailable(false);
        try {
            const data = await api.getJournalLogs(unit || null, lineCount);
            setLogs(data.lines?.join('\n') || 'No logs available');
            setSource(data.source || '');
            setSourceLabel(data.source_label || '');
        } catch (err) {
            const msg = err.message || '';
            if (msg.includes('No system log source available') || msg.includes('unavailable')) {
                setUnavailable(true);
            } else {
                setLogs(`Error: ${msg}`);
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadJournalLogs();
    }, []);

    if (unavailable) {
        return (
            <div className="journal-container">
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="9" y1="9" x2="15" y2="9"/>
                        <line x1="9" y1="13" x2="15" y2="13"/>
                        <line x1="9" y1="17" x2="11" y2="17"/>
                    </svg>
                    <h3>System Logs Unavailable</h3>
                    <p>
                        No system log source was found on this server.
                        Neither <code>journalctl</code>, <code>/var/log/syslog</code>,
                        nor the Windows Event Log are available.
                    </p>
                    <p className="text-muted">
                        Use the <strong>Log Files</strong> tab to browse available log files instead.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="journal-container">
            <JournalControls
                unit={unit}
                onUnitChange={setUnit}
                unitLabel={isJournalctl ? 'Service/Unit' : 'Filter by service'}
                quickUnits={commonUnits}
                showQuickUnits={isJournalctl}
                lineCount={lineCount}
                onLineCountChange={setLineCount}
                priority={priority}
                onPriorityChange={setPriority}
                showPriority={isJournalctl}
                loading={loading}
                onLoad={loadJournalLogs}
            />

            {!isJournalctl && source && (
                <div className="journal-source-notice">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="16" x2="12" y2="12"/>
                        <line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                    <span>
                        Reading from <strong>{sourceLabel}</strong> — journalctl is not available on this system
                    </span>
                </div>
            )}

            <div className="journal-viewer">
                <pre>{loading ? 'Loading journal logs...' : logs}</pre>
            </div>
        </div>
    );
};

const ProcessesTab = () => {
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const [processes, setProcesses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sortBy, setSortBy] = useState('cpu');
    const [limit, setLimit] = useState(50);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProcess, setSelectedProcess] = useState(null);

    useEffect(() => {
        loadProcesses();
    }, [sortBy, limit]);

    async function loadProcesses() {
        try {
            const data = await api.getProcesses(limit, sortBy);
            setProcesses(data.processes || []);
        } catch (err) {
            console.error('Failed to load processes:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleKillProcess(pid, force = false) {
        const confirmMsg = force
            ? `Force kill process ${pid}? This may cause data loss.`
            : `Kill process ${pid}?`;
        const confirmed = await confirm({ title: force ? 'Force Kill Process' : 'Kill Process', message: confirmMsg, variant: force ? 'danger' : 'warning' });
        if (!confirmed) return;

        try {
            await api.killProcess(pid, force);
            toast.success(`Process ${pid} killed successfully`);
            loadProcesses();
            setSelectedProcess(null);
        } catch (err) {
            toast.error(`Failed to kill process: ${err.message}`);
        }
    }

    const filteredProcesses = processes.filter(p =>
        p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.command?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(p.pid).includes(searchTerm)
    );

    if (loading) {
        return <div className="loading">Loading processes...</div>;
    }

    return (
        <div className="processes-container">
            <div className="processes-toolbar">
                <div className="toolbar-left">
                    <div className="search-input">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <Input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search processes..."
                        />
                    </div>
                </div>
                <div className="toolbar-right">
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                        <option value="cpu">Sort by CPU</option>
                        <option value="memory">Sort by Memory</option>
                        <option value="pid">Sort by PID</option>
                        <option value="name">Sort by Name</option>
                    </select>
                    <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value))}>
                        <option value={25}>25 processes</option>
                        <option value={50}>50 processes</option>
                        <option value={100}>100 processes</option>
                    </select>
                    <Button variant="outline" size="sm" onClick={loadProcesses}>
                        Refresh
                    </Button>
                </div>
            </div>

            <ProcessTable
                processes={filteredProcesses}
                selectedPid={selectedProcess?.pid}
                onSelect={setSelectedProcess}
                onKill={(p) => handleKillProcess(p.pid)}
                onForceKill={(p) => handleKillProcess(p.pid, true)}
                formatMemory={formatMemory}
                getStatusVariant={getStatusVariant}
            />

            <ProcessDetailsPanel
                process={selectedProcess}
                onClose={() => setSelectedProcess(null)}
                formatMemory={formatMemory}
            />
            <ConfirmDialog
                isOpen={confirmState.isOpen}
                title={confirmState.title}
                message={confirmState.message}
                confirmText={confirmState.confirmText}
                cancelText={confirmState.cancelText}
                variant={confirmState.variant}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </div>
    );
};

const ServicesTab = () => {
    const toast = useToast();
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [selectedService, setSelectedService] = useState(null);
    const [serviceLogs, setServiceLogs] = useState('');
    const [showLogsModal, setShowLogsModal] = useState(false);

    useEffect(() => {
        loadServices();
    }, []);

    async function loadServices() {
        try {
            const data = await api.getServicesStatus();
            setServices(data.services || []);
        } catch (err) {
            console.error('Failed to load services:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleServiceAction(serviceName, action) {
        setActionLoading(`${serviceName}-${action}`);
        try {
            await api.controlService(serviceName, action);
            toast.success(`Service ${serviceName} ${action}ed successfully`);
            await loadServices();
        } catch (err) {
            toast.error(`Failed to ${action} ${serviceName}: ${err.message}`);
        } finally {
            setActionLoading(null);
        }
    }

    async function viewServiceLogs(serviceName) {
        setSelectedService(serviceName);
        setShowLogsModal(true);
        try {
            const data = await api.getJournalLogs(serviceName, 100);
            setServiceLogs(data.lines?.join('\n') || 'No logs available');
        } catch (err) {
            setServiceLogs(`Error loading logs: ${err.message}`);
        }
    }

    function getServiceStatusVariant(status) {
        if (status === 'running' || status === 'active') return 'success';
        if (status === 'stopped' || status === 'inactive') return 'secondary';
        if (status === 'failed') return 'destructive';
        return 'warning';
    }

    if (loading) {
        return <div className="loading">Loading services...</div>;
    }

    return (
        <div className="services-container">
            <div className="services-toolbar">
                <Button variant="outline" size="sm" onClick={loadServices}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                    Refresh
                </Button>
            </div>

            {services.length === 0 ? (
                <div className="empty-state">
                    <p>No services found</p>
                </div>
            ) : (
                <ServicesGrid>
                    {services.map(service => {
                        const meta = [
                            service.pid && { label: 'PID', value: service.pid },
                            service.memory && { label: 'Memory', value: service.memory },
                        ].filter(Boolean);
                        const isRunning = service.status === 'running' || service.status === 'active';
                        return (
                            <ServiceCard
                                key={service.name}
                                name={service.name}
                                description={service.description}
                                status={service.status}
                                statusVariant={getServiceStatusVariant(service.status)}
                                meta={meta}
                                actions={
                                    <>
                                        {isRunning ? (
                                            <>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleServiceAction(service.name, 'restart')}
                                                    disabled={actionLoading === `${service.name}-restart`}
                                                >
                                                    {actionLoading === `${service.name}-restart` ? '...' : 'Restart'}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleServiceAction(service.name, 'stop')}
                                                    disabled={actionLoading === `${service.name}-stop`}
                                                >
                                                    {actionLoading === `${service.name}-stop` ? '...' : 'Stop'}
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                size="sm"
                                                onClick={() => handleServiceAction(service.name, 'start')}
                                                disabled={actionLoading === `${service.name}-start`}
                                            >
                                                {actionLoading === `${service.name}-start` ? '...' : 'Start'}
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => viewServiceLogs(service.name)}
                                        >
                                            Logs
                                        </Button>
                                    </>
                                }
                            />
                        );
                    })}
                </ServicesGrid>
            )}

            {/* Service Logs Modal */}
            {showLogsModal && (
                <div className="modal-overlay" onClick={() => setShowLogsModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Logs: {selectedService}</h2>
                            <button className="modal-close" onClick={() => setShowLogsModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="modal-log-viewer">
                                <pre>{serviceLogs}</pre>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowLogsModal(false)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper functions
function formatMemory(bytes) {
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
}

function getStatusVariant(status) {
    switch (status?.toLowerCase()) {
        case 'running':
        case 'sleeping':
            return 'success';
        case 'stopped':
        case 'zombie':
            return 'destructive';
        case 'idle':
        case 'disk-sleep':
            return 'warning';
        default:
            return 'secondary';
    }
}

export default Terminal;
