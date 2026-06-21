import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import {
    OverviewTab,
    FirewallTab,
    Fail2banTab,
    SSHKeysTab,
    IPListsTab,
    ScannerTab,
    QuarantineTab,
    IntegrityTab,
    AuditTab,
    VulnerabilityTab,
    AutoUpdatesTab,
    EventsTab,
    SecurityConfigTab,
} from '../components/security';
import EmptyState from '../components/EmptyState';
import { MetricCard } from '@/components/ds';
import { Siren, Bug, ShieldCheck, Radar } from 'lucide-react';

const VALID_TABS = ['overview', 'firewall', 'fail2ban', 'ssh-keys', 'ip-lists', 'scanner', 'quarantine', 'integrity', 'audit', 'vulnerability', 'updates', 'events', 'settings'];

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const Security = () => {
    const { isAdmin } = useAuth();
    const [activeTab] = useTabParam('/security', VALID_TABS);
    const [status, setStatus] = useState(null);
    const [clamav, setClamav] = useState(null);
    const [clamavLoading, setClamavLoading] = useState(true);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadStatus();
        loadClamav();
    }, []);

    async function loadStatus() {
        try {
            const data = await api.getSecurityStatus();
            setStatus(data);
        } catch (err) {
            console.error('Failed to load security status:', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadClamav() {
        try {
            const data = await api.getClamAVStatus();
            setClamav(data);
        } catch (err) {
            console.error('Failed to load ClamAV status:', err);
        } finally {
            setClamavLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="sk-tabgroup__inner security-page">
                <EmptyState loading title="Loading security status..." />
            </div>
        );
    }

    const alerts = status?.recent_alerts || {};
    const scanRunning = status?.scan_status === 'running';

    return (
        <div className="sk-tabgroup__inner security-page">
            <div className="sec-kpis" role="group" aria-label="Security overview">
                <MetricCard
                    tone={alerts.total > 0 ? 'amber' : 'green'}
                    icon={<Siren size={16} />}
                    value={alerts.total || 0}
                    label="Alerts (24h)"
                />
                <MetricCard
                    tone={alerts.malware_detections > 0 ? 'red' : 'green'}
                    icon={<Bug size={16} />}
                    value={alerts.malware_detections || 0}
                    label="Malware detected"
                />
                <MetricCard
                    className="sec-kpi-text"
                    tone={clamav?.installed ? 'green' : 'amber'}
                    icon={<ShieldCheck size={16} />}
                    value={clamav?.installed ? 'Active' : 'Not installed'}
                    label="ClamAV"
                />
                <MetricCard
                    className="sec-kpi-text"
                    tone={scanRunning ? 'cyan' : 'accent'}
                    icon={<Radar size={16} />}
                    value={capitalize(status?.scan_status) || 'Idle'}
                    label="Scan status"
                />
            </div>

            <div className="tab-content">
                {activeTab === 'overview' && <OverviewTab status={status} clamavStatus={clamav} clamavLoading={clamavLoading} onRefreshClamav={loadClamav} />}
                {activeTab === 'firewall' && <FirewallTab />}
                {activeTab === 'fail2ban' && <Fail2banTab />}
                {activeTab === 'ssh-keys' && <SSHKeysTab />}
                {activeTab === 'ip-lists' && <IPListsTab />}
                {activeTab === 'scanner' && <ScannerTab />}
                {activeTab === 'quarantine' && <QuarantineTab />}
                {activeTab === 'integrity' && <IntegrityTab />}
                {activeTab === 'audit' && <AuditTab />}
                {activeTab === 'vulnerability' && <VulnerabilityTab />}
                {activeTab === 'updates' && <AutoUpdatesTab />}
                {activeTab === 'events' && <EventsTab />}
                {activeTab === 'settings' && <SecurityConfigTab />}
            </div>
        </div>
    );
};

export default Security;
