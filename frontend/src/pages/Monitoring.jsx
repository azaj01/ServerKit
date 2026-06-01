import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import EmptyState from '../components/EmptyState';
import { StatStrip, Stat } from '../components/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Activity,
    Bell,
    CheckCircle2,
    Clock,
    Cpu,
    Gauge,
    HardDrive,
    Mail,
    MemoryStick,
    PlayCircle,
    RefreshCw,
    Settings,
    Siren,
    Webhook,
} from 'lucide-react';

const VALID_TABS = ['overview', 'alerts', 'config', 'thresholds'];

const DEFAULT_THRESHOLDS = {
    cpu_percent: 80,
    memory_percent: 85,
    disk_percent: 90,
    load_average: 5.0,
};

const CHANNEL_META = {
    discord: { label: 'Discord', icon: Webhook },
    slack: { label: 'Slack', icon: Webhook },
    telegram: { label: 'Telegram', icon: Bell },
    email: { label: 'Email', icon: Mail },
    generic_webhook: { label: 'Webhook', icon: Webhook },
};

function formatTimestamp(timestamp) {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
}

function formatNumber(value, digits = 1) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    return value.toFixed(digits);
}

function formatMetric(value, unit = '%') {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    return `${value.toFixed(unit === '' ? 2 : 1)}${unit}`;
}

function getAlertSeverityVariant(severity) {
    switch (severity) {
        case 'critical':
            return 'destructive';
        case 'warning':
            return 'warning';
        case 'info':
            return 'info';
        default:
            return 'secondary';
    }
}

const Monitoring = () => {
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
    const [alertHistory, setAlertHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [savingConfig, setSavingConfig] = useState(false);
    const [savingThresholds, setSavingThresholds] = useState(false);
    const [checkingAlerts, setCheckingAlerts] = useState(false);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useTabParam('/monitoring', VALID_TABS);

    const [configForm, setConfigForm] = useState({
        enabled: false,
        check_interval: 60,
    });

    const [thresholdForm, setThresholdForm] = useState(DEFAULT_THRESHOLDS);

    const loadData = async () => {
        try {
            setLoading(true);
            setError(null);
            const [statusRes, configRes, thresholdsRes, historyRes] = await Promise.all([
                api.getMonitoringStatus(),
                api.getMonitoringConfig(),
                api.getMonitoringThresholds(),
                api.getAlertHistory(50),
            ]);

            const nextThresholds = { ...DEFAULT_THRESHOLDS, ...(thresholdsRes.thresholds || {}) };
            setStatus(statusRes);
            setThresholds(nextThresholds);
            setThresholdForm(nextThresholds);
            setAlertHistory(historyRes.alerts || []);
            setConfigForm({
                enabled: Boolean(configRes.enabled),
                check_interval: configRes.check_interval || 60,
            });
        } catch (err) {
            setError(err.message || 'Failed to load monitoring data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const metricRules = useMemo(() => {
        const metrics = status?.current_metrics || {};
        return [
            {
                key: 'cpu_percent',
                label: 'CPU usage',
                description: 'cpu',
                icon: Cpu,
                unit: '%',
                current: metrics.cpu?.percent,
                threshold: thresholdForm.cpu_percent,
                persistedThreshold: thresholds.cpu_percent,
            },
            {
                key: 'memory_percent',
                label: 'Memory usage',
                description: 'memory',
                icon: MemoryStick,
                unit: '%',
                current: metrics.memory?.percent,
                threshold: thresholdForm.memory_percent,
                persistedThreshold: thresholds.memory_percent,
            },
            {
                key: 'disk_percent',
                label: 'Disk usage',
                description: 'disk',
                icon: HardDrive,
                unit: '%',
                current: metrics.disk?.percent,
                threshold: thresholdForm.disk_percent,
                persistedThreshold: thresholds.disk_percent,
            },
            {
                key: 'load_average',
                label: 'Load average',
                description: 'load',
                icon: Gauge,
                unit: '',
                current: metrics.load_average?.['1min'],
                threshold: thresholdForm.load_average,
                persistedThreshold: thresholds.load_average,
            },
        ];
    }, [status, thresholdForm, thresholds]);

    const notificationChannels = useMemo(() => {
        return Object.entries(status?.notifications || {}).map(([key, channel]) => ({
            key,
            ...channel,
            ...(CHANNEL_META[key] || { label: key, icon: Bell }),
        }));
    }, [status]);

    const activeAlerts = status?.active_alerts || [];
    const enabledChannelCount = notificationChannels.filter((channel) => channel.enabled && channel.configured).length;
    const alertRuleCount = metricRules.length;

    const handleToggleMonitoring = async () => {
        try {
            if (status?.enabled) {
                await api.stopMonitoring();
                toast.success('Monitoring stopped');
            } else {
                await api.startMonitoring();
                toast.success('Monitoring started');
            }
            await loadData();
        } catch (err) {
            setError(err.message || 'Failed to update monitoring state');
        }
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        try {
            setSavingConfig(true);
            const wasEnabled = Boolean(status?.enabled);
            await api.updateMonitoringConfig({
                enabled: configForm.enabled,
                check_interval: Number(configForm.check_interval) || 60,
            });

            if (configForm.enabled !== wasEnabled) {
                if (configForm.enabled) {
                    await api.startMonitoring();
                } else {
                    await api.stopMonitoring();
                }
            }

            toast.success('Monitoring delivery saved');
            await loadData();
        } catch (err) {
            toast.error(err.message || 'Failed to save monitoring settings');
        } finally {
            setSavingConfig(false);
        }
    };

    const handleSaveThresholds = async (e) => {
        e.preventDefault();
        try {
            setSavingThresholds(true);
            await api.updateMonitoringThresholds({
                cpu_percent: Number(thresholdForm.cpu_percent),
                memory_percent: Number(thresholdForm.memory_percent),
                disk_percent: Number(thresholdForm.disk_percent),
                load_average: Number(thresholdForm.load_average),
            });
            toast.success('Alert rules saved');
            await loadData();
        } catch (err) {
            toast.error(err.message || 'Failed to save alert rules');
        } finally {
            setSavingThresholds(false);
        }
    };

    const handleCheckAlerts = async () => {
        try {
            setCheckingAlerts(true);
            const result = await api.checkAlerts();
            const count = result.alerts?.length || 0;
            toast[count > 0 ? 'warning' : 'success'](`${count} active alert${count !== 1 ? 's' : ''}`);
            await loadData();
        } catch (err) {
            toast.error(err.message || 'Alert check failed');
        } finally {
            setCheckingAlerts(false);
        }
    };

    const updateThreshold = (key, value) => {
        setThresholdForm((current) => ({
            ...current,
            [key]: value,
        }));
    };

    if (loading) {
        return (
            <div className="page-container monitoring-page">
                <EmptyState loading size="lg" title="Loading monitoring data" />
            </div>
        );
    }

    return (
        <div className="page-container monitoring-page">
            <div className="page-header">
                <div>
                    <h1>Monitoring & Alerts</h1>
                    <p className="page-subtitle">System resource alerts and delivery</p>
                </div>
                <div className="page-actions">
                    <Button variant="outline" onClick={loadData}>
                        <RefreshCw size={16} />
                        Refresh
                    </Button>
                    <Button
                        variant={status?.enabled ? 'destructive' : 'default'}
                        onClick={handleToggleMonitoring}
                    >
                        {status?.enabled ? (
                            <>
                                <Activity size={16} />
                                Stop Monitoring
                            </>
                        ) : (
                            <>
                                <PlayCircle size={16} />
                                Start Monitoring
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="thresholds">Alert Rules</TabsTrigger>
                    <TabsTrigger value="config">Delivery</TabsTrigger>
                    <TabsTrigger value="alerts">History</TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                    <div className="monitoring-overview">
                        <section className={`monitoring-hero ${status?.enabled ? 'is-active' : ''}`}>
                            <div>
                                <Badge variant={status?.enabled ? 'success' : 'secondary'}>
                                    {status?.enabled ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                                    {status?.enabled ? 'Monitoring active' : 'Monitoring paused'}
                                </Badge>
                                <h2>{activeAlerts.length > 0 ? `${activeAlerts.length} active alert${activeAlerts.length !== 1 ? 's' : ''}` : 'No active alerts'}</h2>
                                <p>
                                    Checks run every {status?.check_interval || configForm.check_interval || 60} seconds.
                                </p>
                            </div>
                            <div className="monitoring-hero__actions">
                                <Button variant="outline" onClick={handleCheckAlerts} disabled={checkingAlerts}>
                                    <Siren size={16} />
                                    {checkingAlerts ? 'Checking...' : 'Check Now'}
                                </Button>
                            </div>
                        </section>

                        <StatStrip ariaLabel="Monitoring summary">
                            <Stat label="Alert rules" value={alertRuleCount} />
                            <Stat label="Delivery channels" value={enabledChannelCount} />
                            <Stat label="History" value={alertHistory.length} />
                        </StatStrip>

                        <section className="monitoring-panel">
                            <div className="monitoring-panel__header">
                                <h3>Current Metrics</h3>
                                <Button size="sm" variant="outline" onClick={() => setActiveTab('thresholds')}>
                                    <Settings size={14} />
                                    Rules
                                </Button>
                            </div>
                            <div className="metric-rule-grid metric-rule-grid--compact">
                                {metricRules.map((rule) => {
                                    const Icon = rule.icon;
                                    const isTriggered = typeof rule.current === 'number' && rule.current > rule.persistedThreshold;
                                    return (
                                        <article key={rule.key} className={`metric-rule-card ${isTriggered ? 'is-triggered' : ''}`}>
                                            <div className="metric-rule-card__icon">
                                                <Icon size={18} />
                                            </div>
                                            <div>
                                                <span>{rule.label}</span>
                                                <strong>{formatMetric(rule.current, rule.unit)}</strong>
                                            </div>
                                            <Badge variant={isTriggered ? 'warning' : 'success'}>
                                                {isTriggered ? 'Alerting' : `Under ${formatMetric(rule.persistedThreshold, rule.unit)}`}
                                            </Badge>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>

                        {activeAlerts.length > 0 && (
                            <section className="monitoring-panel monitoring-panel--warning">
                                <div className="monitoring-panel__header">
                                    <h3>Active Alerts</h3>
                                </div>
                                <div className="alert-list">
                                    {activeAlerts.map((alert, index) => (
                                        <div key={`${alert.type}-${index}`} className="alert-item">
                                            <Badge variant={getAlertSeverityVariant(alert.severity)}>
                                                {alert.severity}
                                            </Badge>
                                            <span className="alert-message">{alert.message}</span>
                                            <span className="alert-time">{formatNumber(alert.value)} / {alert.threshold}</span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="thresholds">
                    <form className="monitoring-panel" onSubmit={handleSaveThresholds}>
                        <div className="monitoring-panel__header">
                            <h3>Alert Rules</h3>
                            <Button type="submit" disabled={savingThresholds}>
                                {savingThresholds ? 'Saving...' : 'Save Rules'}
                            </Button>
                        </div>
                        <div className="metric-rule-grid">
                            {metricRules.map((rule) => {
                                const Icon = rule.icon;
                                const isTriggered = typeof rule.current === 'number' && rule.current > rule.threshold;
                                return (
                                    <article key={rule.key} className={`metric-rule-editor ${isTriggered ? 'is-triggered' : ''}`}>
                                        <div className="metric-rule-editor__main">
                                            <div className="metric-rule-card__icon">
                                                <Icon size={18} />
                                            </div>
                                            <div>
                                                <h4>{rule.label}</h4>
                                                <span>Current: {formatMetric(rule.current, rule.unit)}</span>
                                            </div>
                                        </div>
                                        <div className="metric-rule-editor__threshold">
                                            <Label htmlFor={`threshold-${rule.key}`}>Trigger above</Label>
                                            <Input
                                                id={`threshold-${rule.key}`}
                                                type="number"
                                                min={rule.key === 'load_average' ? '0.1' : '1'}
                                                max={rule.key === 'load_average' ? '100' : '100'}
                                                step={rule.key === 'load_average' ? '0.1' : '1'}
                                                value={rule.threshold}
                                                onChange={(e) => updateThreshold(rule.key, e.target.value)}
                                            />
                                        </div>
                                        <Badge variant={isTriggered ? 'warning' : 'secondary'}>
                                            {isTriggered ? 'Would alert now' : 'Quiet'}
                                        </Badge>
                                    </article>
                                );
                            })}
                        </div>
                    </form>
                </TabsContent>

                <TabsContent value="config">
                    <div className="monitoring-delivery-layout">
                        <form className="monitoring-panel" onSubmit={handleSaveConfig}>
                            <div className="monitoring-panel__header">
                                <h3>Scheduler</h3>
                                <Button type="submit" disabled={savingConfig}>
                                    {savingConfig ? 'Saving...' : 'Save Delivery'}
                                </Button>
                            </div>
                            <div className="monitoring-switch-row">
                                <div>
                                    <strong>Run resource checks</strong>
                                    <span>{configForm.enabled ? 'Enabled' : 'Paused'}</span>
                                </div>
                                <Switch
                                    checked={configForm.enabled}
                                    onCheckedChange={(checked) => setConfigForm({ ...configForm, enabled: checked })}
                                />
                            </div>
                            <div className="form-group">
                                <Label htmlFor="monitoring-interval">Check interval</Label>
                                <Input
                                    id="monitoring-interval"
                                    type="number"
                                    min="10"
                                    max="3600"
                                    value={configForm.check_interval}
                                    onChange={(e) => setConfigForm({ ...configForm, check_interval: e.target.value })}
                                />
                                <span className="form-help">Seconds between checks.</span>
                            </div>
                        </form>

                        <section className="monitoring-panel">
                            <div className="monitoring-panel__header">
                                <h3>Notification Channels</h3>
                                <Button size="sm" asChild>
                                    <Link to="/settings/notifications">
                                        <Settings size={14} />
                                        Configure
                                    </Link>
                                </Button>
                            </div>
                            <div className="notification-channel-grid">
                                {notificationChannels.map((channel) => {
                                    const Icon = channel.icon;
                                    const ready = channel.enabled && channel.configured;
                                    return (
                                        <article key={channel.key} className={`notification-channel-tile ${ready ? 'is-ready' : ''}`}>
                                            <Icon size={18} />
                                            <div>
                                                <strong>{channel.label}</strong>
                                                <span>{ready ? 'Enabled' : channel.configured ? 'Configured' : 'Not configured'}</span>
                                            </div>
                                            <Badge variant={ready ? 'success' : 'secondary'}>
                                                {ready ? 'Ready' : 'Off'}
                                            </Badge>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    </div>
                </TabsContent>

                <TabsContent value="alerts">
                    <section className="monitoring-panel">
                        <div className="monitoring-panel__header">
                            <h3>Alert History</h3>
                            <div>
                                <Button variant="outline" size="sm" onClick={handleCheckAlerts} disabled={checkingAlerts}>
                                    <Siren size={14} />
                                    Check Now
                                </Button>
                                <Button variant="outline" size="sm" onClick={loadData}>
                                    <RefreshCw size={14} />
                                    Refresh
                                </Button>
                            </div>
                        </div>
                        {alertHistory.length === 0 ? (
                            <EmptyState
                                icon={Bell}
                                title="No alerts yet"
                                description="Alerts will appear here once a threshold is crossed."
                            />
                        ) : (
                            <div className="monitoring-history-list">
                                {alertHistory.map((alert, index) => (
                                    <article key={`${alert.timestamp}-${index}`} className="monitoring-history-row">
                                        <Badge variant={getAlertSeverityVariant(alert.severity)}>
                                            {alert.severity}
                                        </Badge>
                                        <div>
                                            <strong>{alert.type}</strong>
                                            <span>{alert.message}</span>
                                        </div>
                                        <div className="monitoring-history-row__meta">
                                            <span>{formatNumber(alert.value)} / {alert.threshold}</span>
                                            <span>{formatTimestamp(alert.timestamp)}</span>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default Monitoring;
