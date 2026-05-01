import React, { useState, useEffect } from 'react';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { StatCard, StatsGrid } from '../components/StatCard';
import { Circle, Bell, Clock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const VALID_TABS = ['overview', 'alerts', 'config', 'thresholds'];

const Monitoring = () => {
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [config, setConfig] = useState(null);
    const [thresholds, setThresholds] = useState(null);
    const [alertHistory, setAlertHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useTabParam('/monitoring', VALID_TABS);

    // Config form state
    const [configForm, setConfigForm] = useState({
        enabled: false,
        check_interval: 60,
        alert_email: '',
        alert_webhook: ''
    });

    // Threshold form state
    const [thresholdForm, setThresholdForm] = useState({
        cpu_percent: 90,
        memory_percent: 90,
        disk_percent: 90,
        load_average: 5.0
    });

    const [testEmail, setTestEmail] = useState('');
    const [testWebhook, setTestWebhook] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [statusRes, configRes, thresholdsRes, historyRes] = await Promise.all([
                api.getMonitoringStatus(),
                api.getMonitoringConfig(),
                api.getMonitoringThresholds(),
                api.getAlertHistory(50)
            ]);

            setStatus(statusRes);
            setConfig(configRes);
            setThresholds(thresholdsRes.thresholds);
            setAlertHistory(historyRes.alerts || []);

            if (configRes) {
                setConfigForm({
                    enabled: configRes.enabled || false,
                    check_interval: configRes.check_interval || 60,
                    alert_email: configRes.alert_email || '',
                    alert_webhook: configRes.alert_webhook || ''
                });
            }

            if (thresholdsRes.thresholds) {
                setThresholdForm(thresholdsRes.thresholds);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleMonitoring = async () => {
        try {
            if (status?.monitoring_active) {
                await api.stopMonitoring();
            } else {
                await api.startMonitoring();
            }
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        try {
            await api.updateMonitoringConfig(configForm);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSaveThresholds = async (e) => {
        e.preventDefault();
        try {
            await api.updateMonitoringThresholds(thresholdForm);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleTestEmail = async () => {
        try {
            await api.testEmailAlert(testEmail || configForm.alert_email);
            toast.success('Test email sent successfully');
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleTestWebhook = async () => {
        try {
            await api.testWebhookAlert(testWebhook || configForm.alert_webhook);
            toast.success('Test webhook sent successfully');
        } catch (err) {
            toast.error(err.message);
        }
    };

    const getAlertSeverityVariant = (severity) => {
        switch (severity) {
            case 'critical': return 'destructive';
            case 'warning': return 'warning';
            case 'info': return 'info';
            default: return 'secondary';
        }
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };

    if (loading) {
        return <div className="page"><div className="loading">Loading monitoring data...</div></div>;
    }

    return (
        <div className="page-container monitoring-page">
            <div className="page-header">
                <div>
                    <h1>Monitoring & Alerts</h1>
                    <p className="page-subtitle">System monitoring and alert configuration</p>
                </div>
                <div className="page-actions">
                    <Button
                        variant={status?.monitoring_active ? 'destructive' : 'default'}
                        onClick={handleToggleMonitoring}
                    >
                        {status?.monitoring_active ? (
                            <>
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <rect x="6" y="4" width="4" height="16"/>
                                    <rect x="14" y="4" width="4" height="16"/>
                                </svg>
                                Stop Monitoring
                            </>
                        ) : (
                            <>
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                </svg>
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
                    <TabsTrigger value="alerts">Alert History</TabsTrigger>
                    <TabsTrigger value="config">Configuration</TabsTrigger>
                    <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                    <div className="monitoring-overview">
                        <StatsGrid>
                            <StatCard
                                icon={Circle}
                                iconVariant="status"
                                label="Monitoring Status"
                                value={status?.monitoring_active ? 'Active' : 'Inactive'}
                                valueClassName={status?.monitoring_active ? 'text-success' : 'text-muted'}
                            />
                            <StatCard icon={Bell} iconVariant="alerts" label="Recent Alerts" value={alertHistory.length} />
                            <StatCard icon={Clock} iconVariant="interval" label="Check Interval" value={`${config?.check_interval || 60}s`} />
                            <StatCard
                                icon={Mail}
                                iconVariant="notifications"
                                label="Notifications"
                                value={
                                    config?.alert_email && config?.alert_webhook
                                        ? 'Email + Webhook'
                                        : config?.alert_email
                                            ? 'Email'
                                            : config?.alert_webhook
                                                ? 'Webhook'
                                                : 'None'
                                }
                            />
                        </StatsGrid>

                        <div className="card">
                            <div className="card-header">
                                <h3>Current Thresholds</h3>
                            </div>
                            <div className="card-body">
                                <div className="threshold-grid">
                                    <div className="threshold-item">
                                        <span className="threshold-label">CPU Usage</span>
                                        <span className="threshold-value">{thresholds?.cpu_percent || 90}%</span>
                                    </div>
                                    <div className="threshold-item">
                                        <span className="threshold-label">Memory Usage</span>
                                        <span className="threshold-value">{thresholds?.memory_percent || 90}%</span>
                                    </div>
                                    <div className="threshold-item">
                                        <span className="threshold-label">Disk Usage</span>
                                        <span className="threshold-value">{thresholds?.disk_percent || 90}%</span>
                                    </div>
                                    <div className="threshold-item">
                                        <span className="threshold-label">Load Average</span>
                                        <span className="threshold-value">{thresholds?.load_average || 5.0}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {alertHistory.length > 0 && (
                            <div className="card">
                                <div className="card-header">
                                    <h3>Recent Alerts</h3>
                                </div>
                                <div className="card-body">
                                    <div className="alert-list">
                                        {alertHistory.slice(0, 5).map((alert, index) => (
                                            <div key={index} className="alert-item">
                                                <Badge variant={getAlertSeverityVariant(alert.severity)}>
                                                    {alert.severity}
                                                </Badge>
                                                <span className="alert-message">{alert.message}</span>
                                                <span className="alert-time">{formatTimestamp(alert.timestamp)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="alerts">
                    <div className="card">
                        <div className="card-header">
                            <h3>Alert History</h3>
                            <Button variant="outline" size="sm" onClick={loadData}>
                                Refresh
                            </Button>
                        </div>
                        <div className="card-body">
                            {alertHistory.length === 0 ? (
                                <div className="empty-state">
                                    <svg viewBox="0 0 24 24" width="48" height="48">
                                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                                        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                                    </svg>
                                    <h3>No Alerts</h3>
                                    <p>No alerts have been triggered yet.</p>
                                </div>
                            ) : (
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Severity</th>
                                            <th>Type</th>
                                            <th>Message</th>
                                            <th>Value</th>
                                            <th>Threshold</th>
                                            <th>Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {alertHistory.map((alert, index) => (
                                            <tr key={index}>
                                                <td>
                                                    <Badge variant={getAlertSeverityVariant(alert.severity)}>
                                                        {alert.severity}
                                                    </Badge>
                                                </td>
                                                <td>{alert.type}</td>
                                                <td>{alert.message}</td>
                                                <td>{alert.value?.toFixed(1)}</td>
                                                <td>{alert.threshold}</td>
                                                <td>{formatTimestamp(alert.timestamp)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="config">
                    <div className="card">
                        <div className="card-header">
                            <h3>Monitoring Configuration</h3>
                        </div>
                        <div className="card-body">
                            <form onSubmit={handleSaveConfig}>
                                <div className="form-group">
                                    <label className="checkbox-label">
                                        <Checkbox
                                            checked={configForm.enabled}
                                            onCheckedChange={(checked) => setConfigForm({...configForm, enabled: checked})}
                                        />
                                        <span>Enable Monitoring</span>
                                    </label>
                                </div>

                                <div className="form-group">
                                    <Label>Check Interval (seconds)</Label>
                                    <Input
                                        type="number"
                                        value={configForm.check_interval}
                                        onChange={(e) => setConfigForm({...configForm, check_interval: parseInt(e.target.value)})}
                                        min="10"
                                        max="3600"
                                    />
                                </div>

                                <div className="form-group">
                                    <Label>Alert Email</Label>
                                    <div className="input-group">
                                        <Input
                                            type="email"
                                            value={configForm.alert_email}
                                            onChange={(e) => setConfigForm({...configForm, alert_email: e.target.value})}
                                            placeholder="alerts@example.com"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleTestEmail}
                                            disabled={!configForm.alert_email}
                                        >
                                            Test
                                        </Button>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <Label>Webhook URL</Label>
                                    <div className="input-group">
                                        <Input
                                            type="url"
                                            value={configForm.alert_webhook}
                                            onChange={(e) => setConfigForm({...configForm, alert_webhook: e.target.value})}
                                            placeholder="https://hooks.slack.com/..."
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleTestWebhook}
                                            disabled={!configForm.alert_webhook}
                                        >
                                            Test
                                        </Button>
                                    </div>
                                </div>

                                <div className="form-actions">
                                    <Button type="submit">Save Configuration</Button>
                                </div>
                            </form>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="thresholds">
                    <div className="card">
                        <div className="card-header">
                            <h3>Alert Thresholds</h3>
                        </div>
                        <div className="card-body">
                            <form onSubmit={handleSaveThresholds}>
                                <div className="threshold-form-grid">
                                    <div className="form-group">
                                        <Label>CPU Usage (%)</Label>
                                        <Input
                                            type="number"
                                            value={thresholdForm.cpu_percent}
                                            onChange={(e) => setThresholdForm({...thresholdForm, cpu_percent: parseInt(e.target.value)})}
                                            min="1"
                                            max="100"
                                        />
                                        <span className="form-help">Alert when CPU exceeds this percentage</span>
                                    </div>

                                    <div className="form-group">
                                        <Label>Memory Usage (%)</Label>
                                        <Input
                                            type="number"
                                            value={thresholdForm.memory_percent}
                                            onChange={(e) => setThresholdForm({...thresholdForm, memory_percent: parseInt(e.target.value)})}
                                            min="1"
                                            max="100"
                                        />
                                        <span className="form-help">Alert when memory exceeds this percentage</span>
                                    </div>

                                    <div className="form-group">
                                        <Label>Disk Usage (%)</Label>
                                        <Input
                                            type="number"
                                            value={thresholdForm.disk_percent}
                                            onChange={(e) => setThresholdForm({...thresholdForm, disk_percent: parseInt(e.target.value)})}
                                            min="1"
                                            max="100"
                                        />
                                        <span className="form-help">Alert when disk exceeds this percentage</span>
                                    </div>

                                    <div className="form-group">
                                        <Label>Load Average</Label>
                                        <Input
                                            type="number"
                                            step="0.1"
                                            value={thresholdForm.load_average}
                                            onChange={(e) => setThresholdForm({...thresholdForm, load_average: parseFloat(e.target.value)})}
                                            min="0.1"
                                            max="100"
                                        />
                                        <span className="form-help">Alert when load average exceeds this value</span>
                                    </div>
                                </div>

                                <div className="form-actions">
                                    <Button type="submit">Save Thresholds</Button>
                                </div>
                            </form>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default Monitoring;
