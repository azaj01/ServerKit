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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const VALID_TABS = ['overview', 'firewall', 'fail2ban', 'ssh-keys', 'ip-lists', 'scanner', 'quarantine', 'integrity', 'audit', 'vulnerability', 'updates', 'events', 'settings'];

const Security = () => {
    const { isAdmin } = useAuth();
    const [activeTab, setActiveTab] = useTabParam('/security', VALID_TABS);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadStatus();
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

    if (loading) {
        return <div className="page"><div className="loading">Loading security status...</div></div>;
    }

    return (
        <div className="page-container security-page">
            <div className="page-header">
                <div>
                    <h1>Security</h1>
                    <p className="page-subtitle">Firewall, malware scanning, file integrity, and security alerts</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="firewall">Firewall</TabsTrigger>
                    <TabsTrigger value="fail2ban">Fail2ban</TabsTrigger>
                    <TabsTrigger value="ssh-keys">SSH Keys</TabsTrigger>
                    <TabsTrigger value="ip-lists">IP Lists</TabsTrigger>
                    <TabsTrigger value="scanner">Malware Scanner</TabsTrigger>
                    <TabsTrigger value="quarantine">Quarantine</TabsTrigger>
                    <TabsTrigger value="integrity">File Integrity</TabsTrigger>
                    <TabsTrigger value="audit">Audit</TabsTrigger>
                    <TabsTrigger value="vulnerability">Vulnerability Scan</TabsTrigger>
                    <TabsTrigger value="updates">Auto Updates</TabsTrigger>
                    <TabsTrigger value="events">Events</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                <div className="tab-content">
                    <TabsContent value="overview"><OverviewTab status={status} onRefresh={loadStatus} /></TabsContent>
                    <TabsContent value="firewall"><FirewallTab /></TabsContent>
                    <TabsContent value="fail2ban"><Fail2banTab /></TabsContent>
                    <TabsContent value="ssh-keys"><SSHKeysTab /></TabsContent>
                    <TabsContent value="ip-lists"><IPListsTab /></TabsContent>
                    <TabsContent value="scanner"><ScannerTab /></TabsContent>
                    <TabsContent value="quarantine"><QuarantineTab /></TabsContent>
                    <TabsContent value="integrity"><IntegrityTab /></TabsContent>
                    <TabsContent value="audit"><AuditTab /></TabsContent>
                    <TabsContent value="vulnerability"><VulnerabilityTab /></TabsContent>
                    <TabsContent value="updates"><AutoUpdatesTab /></TabsContent>
                    <TabsContent value="events"><EventsTab /></TabsContent>
                    <TabsContent value="settings"><SecurityConfigTab /></TabsContent>
                </div>
            </Tabs>
        </div>
    );
};

export default Security;
