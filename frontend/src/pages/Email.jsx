import { useState, useEffect, useCallback } from 'react';
import useTabParam from '../hooks/useTabParam';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const VALID_TABS = ['status', 'domains', 'accounts', 'aliases', 'forwarding', 'dns-providers', 'spam', 'webmail', 'queue'];

function Email() {
    const [activeTab, setActiveTab] = useTabParam('/email', VALID_TABS);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);

    // Domains
    const [domains, setDomains] = useState([]);
    const [showDomainForm, setShowDomainForm] = useState(false);
    const [newDomain, setNewDomain] = useState({ name: '', dns_provider_id: '', dns_zone_id: '' });

    // Accounts
    const [selectedDomainId, setSelectedDomainId] = useState('');
    const [accounts, setAccounts] = useState([]);
    const [showAccountForm, setShowAccountForm] = useState(false);
    const [newAccount, setNewAccount] = useState({ username: '', password: '', quota_mb: 1024 });
    const [showPasswordModal, setShowPasswordModal] = useState(null);
    const [newPassword, setNewPassword] = useState('');

    // Aliases
    const [aliases, setAliases] = useState([]);
    const [showAliasForm, setShowAliasForm] = useState(false);
    const [newAlias, setNewAlias] = useState({ source: '', destination: '' });
    const [aliasDomainId, setAliasDomainId] = useState('');

    // Forwarding
    const [allAccounts, setAllAccounts] = useState([]);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [forwardingRules, setForwardingRules] = useState([]);
    const [showForwardForm, setShowForwardForm] = useState(false);
    const [newForward, setNewForward] = useState({ destination: '', keep_copy: true });

    // DNS Providers
    const [providers, setProviders] = useState([]);
    const [showProviderForm, setShowProviderForm] = useState(false);
    const [newProvider, setNewProvider] = useState({ name: '', provider: 'cloudflare', api_key: '', api_secret: '', api_email: '', is_default: false });
    const [providerZones, setProviderZones] = useState({});

    // Spam
    const [spamConfig, setSpamConfig] = useState(null);

    // Webmail
    const [webmailStatus, setWebmailStatus] = useState(null);
    const [proxyDomain, setProxyDomain] = useState('');
    const [installHostname, setInstallHostname] = useState('');

    // Queue & Logs
    const [queue, setQueue] = useState([]);
    const [logs, setLogs] = useState([]);
    const [logLines, setLogLines] = useState(100);

    const toast = useToast();

    useEffect(() => { loadStatus(); }, []);

    const loadStatus = async () => {
        setLoading(true);
        try {
            const data = await api.getEmailStatus();
            setStatus(data);
        } catch (err) {
            console.error('Failed to load email status:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadDomains = useCallback(async () => {
        try {
            const data = await api.getEmailDomains();
            setDomains(data.domains || []);
        } catch (err) { toast.error('Failed to load domains'); }
    }, []);

    useEffect(() => { if (activeTab === 'domains') loadDomains(); }, [activeTab]);

    const loadAccounts = useCallback(async (domainId) => {
        if (!domainId) return;
        try {
            const data = await api.getEmailAccounts(domainId);
            setAccounts(data.accounts || []);
        } catch (err) { toast.error('Failed to load accounts'); }
    }, []);

    useEffect(() => { if (activeTab === 'accounts' && selectedDomainId) loadAccounts(selectedDomainId); }, [activeTab, selectedDomainId]);
    useEffect(() => {
        if (activeTab === 'accounts' && domains.length === 0) loadDomains();
    }, [activeTab]);

    const loadAliases = useCallback(async (domainId) => {
        if (!domainId) return;
        try {
            const data = await api.getEmailAliases(domainId);
            setAliases(data.aliases || []);
        } catch (err) { toast.error('Failed to load aliases'); }
    }, []);

    useEffect(() => { if (activeTab === 'aliases' && aliasDomainId) loadAliases(aliasDomainId); }, [activeTab, aliasDomainId]);
    useEffect(() => {
        if (activeTab === 'aliases' && domains.length === 0) loadDomains();
    }, [activeTab]);

    const loadForwarding = useCallback(async (accountId) => {
        if (!accountId) return;
        try {
            const data = await api.getEmailForwarding(accountId);
            setForwardingRules(data.rules || []);
        } catch (err) { toast.error('Failed to load forwarding rules'); }
    }, []);

    useEffect(() => {
        if (activeTab === 'forwarding') {
            if (domains.length === 0) loadDomains();
            // Load all accounts from all domains
            const loadAll = async () => {
                try {
                    const d = await api.getEmailDomains();
                    const all = [];
                    for (const dom of (d.domains || [])) {
                        const accts = await api.getEmailAccounts(dom.id);
                        all.push(...(accts.accounts || []).map(a => ({ ...a, domain_name: dom.name })));
                    }
                    setAllAccounts(all);
                } catch (err) { console.error(err); }
            };
            loadAll();
        }
    }, [activeTab]);

    useEffect(() => { if (selectedAccountId) loadForwarding(selectedAccountId); }, [selectedAccountId]);

    useEffect(() => {
        if (activeTab === 'dns-providers') {
            api.getEmailDNSProviders().then(d => setProviders(d.providers || [])).catch(() => {});
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'spam') {
            api.getSpamConfig().then(d => setSpamConfig(d.config || null)).catch(() => {});
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'webmail') {
            api.getWebmailStatus().then(d => setWebmailStatus(d)).catch(() => {});
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'queue') {
            api.getMailQueue().then(d => setQueue(d.queue || [])).catch(() => {});
            api.getMailLogs(logLines).then(d => setLogs(d.logs || [])).catch(() => {});
        }
    }, [activeTab, logLines]);

    // ── Actions ──

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installEmailServer({ hostname: installHostname || undefined });
            toast.success('Email server installed');
            loadStatus();
        } catch (err) { toast.error(err.message || 'Installation failed'); }
        finally { setActionLoading(false); }
    };

    const handleServiceControl = async (component, action) => {
        setActionLoading(true);
        try {
            await api.controlEmailService(component, action);
            toast.success(`${component} ${action} successful`);
            loadStatus();
        } catch (err) { toast.error(err.message || `Failed to ${action} ${component}`); }
        finally { setActionLoading(false); }
    };

    const handleAddDomain = async (e) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            await api.addEmailDomain(newDomain);
            toast.success('Domain added');
            setShowDomainForm(false);
            setNewDomain({ name: '', dns_provider_id: '', dns_zone_id: '' });
            loadDomains();
        } catch (err) { toast.error(err.message || 'Failed to add domain'); }
        finally { setActionLoading(false); }
    };

    const handleDeleteDomain = (domainId, name) => {
        setConfirmDialog({
            message: `Delete domain "${name}" and all its accounts and aliases?`,
            onConfirm: async () => {
                try {
                    await api.deleteEmailDomain(domainId);
                    toast.success('Domain deleted');
                    loadDomains();
                } catch (err) { toast.error('Failed to delete domain'); }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleVerifyDNS = async (domainId) => {
        setActionLoading(true);
        try {
            const result = await api.verifyEmailDNS(domainId);
            if (result.all_verified) toast.success('All DNS records verified');
            else toast.error('Some DNS records are missing');
            loadDomains();
        } catch (err) { toast.error('DNS verification failed'); }
        finally { setActionLoading(false); }
    };

    const handleDeployDNS = async (domainId) => {
        setActionLoading(true);
        try {
            await api.deployEmailDNS(domainId);
            toast.success('DNS records deployed');
        } catch (err) { toast.error(err.message || 'DNS deployment failed'); }
        finally { setActionLoading(false); }
    };

    const handleCreateAccount = async (e) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            await api.createEmailAccount(selectedDomainId, newAccount);
            toast.success('Account created');
            setShowAccountForm(false);
            setNewAccount({ username: '', password: '', quota_mb: 1024 });
            loadAccounts(selectedDomainId);
        } catch (err) { toast.error(err.message || 'Failed to create account'); }
        finally { setActionLoading(false); }
    };

    const handleDeleteAccount = (accountId, email) => {
        setConfirmDialog({
            message: `Delete account "${email}"? This will remove the mailbox.`,
            onConfirm: async () => {
                try {
                    await api.deleteEmailAccount(accountId);
                    toast.success('Account deleted');
                    loadAccounts(selectedDomainId);
                } catch (err) { toast.error('Failed to delete account'); }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleChangePassword = async () => {
        if (!showPasswordModal || !newPassword) return;
        setActionLoading(true);
        try {
            await api.changeEmailPassword(showPasswordModal, newPassword);
            toast.success('Password changed');
            setShowPasswordModal(null);
            setNewPassword('');
        } catch (err) { toast.error('Failed to change password'); }
        finally { setActionLoading(false); }
    };

    const handleCreateAlias = async (e) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            await api.createEmailAlias(aliasDomainId, newAlias);
            toast.success('Alias created');
            setShowAliasForm(false);
            setNewAlias({ source: '', destination: '' });
            loadAliases(aliasDomainId);
        } catch (err) { toast.error(err.message || 'Failed to create alias'); }
        finally { setActionLoading(false); }
    };

    const handleDeleteAlias = (aliasId) => {
        setConfirmDialog({
            message: 'Delete this alias?',
            onConfirm: async () => {
                try {
                    await api.deleteEmailAlias(aliasId);
                    toast.success('Alias deleted');
                    loadAliases(aliasDomainId);
                } catch (err) { toast.error('Failed to delete alias'); }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleCreateForwarding = async (e) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            await api.createEmailForwarding(selectedAccountId, newForward);
            toast.success('Forwarding rule created');
            setShowForwardForm(false);
            setNewForward({ destination: '', keep_copy: true });
            loadForwarding(selectedAccountId);
        } catch (err) { toast.error(err.message || 'Failed to create forwarding rule'); }
        finally { setActionLoading(false); }
    };

    const handleDeleteForwarding = (ruleId) => {
        setConfirmDialog({
            message: 'Delete this forwarding rule?',
            onConfirm: async () => {
                try {
                    await api.deleteEmailForwarding(ruleId);
                    toast.success('Rule deleted');
                    loadForwarding(selectedAccountId);
                } catch (err) { toast.error('Failed to delete rule'); }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleAddProvider = async (e) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            await api.addEmailDNSProvider(newProvider);
            toast.success('DNS provider added');
            setShowProviderForm(false);
            setNewProvider({ name: '', provider: 'cloudflare', api_key: '', api_secret: '', api_email: '', is_default: false });
            const d = await api.getEmailDNSProviders();
            setProviders(d.providers || []);
        } catch (err) { toast.error(err.message || 'Failed to add provider'); }
        finally { setActionLoading(false); }
    };

    const handleDeleteProvider = (providerId) => {
        setConfirmDialog({
            message: 'Delete this DNS provider?',
            onConfirm: async () => {
                try {
                    await api.deleteEmailDNSProvider(providerId);
                    toast.success('Provider deleted');
                    const d = await api.getEmailDNSProviders();
                    setProviders(d.providers || []);
                } catch (err) { toast.error('Failed to delete provider'); }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleTestProvider = async (providerId) => {
        setActionLoading(true);
        try {
            const result = await api.testEmailDNSProvider(providerId);
            if (result.success) toast.success('Connection successful');
            else toast.error(result.error || 'Connection failed');
        } catch (err) { toast.error('Test failed'); }
        finally { setActionLoading(false); }
    };

    const handleListZones = async (providerId) => {
        try {
            const result = await api.getEmailDNSZones(providerId);
            setProviderZones(prev => ({ ...prev, [providerId]: result.zones || [] }));
        } catch (err) { toast.error('Failed to list zones'); }
    };

    const handleUpdateSpam = async () => {
        setActionLoading(true);
        try {
            await api.updateSpamConfig(spamConfig);
            toast.success('SpamAssassin config updated');
        } catch (err) { toast.error('Failed to update config'); }
        finally { setActionLoading(false); }
    };

    const handleUpdateSpamRules = async () => {
        setActionLoading(true);
        try {
            const result = await api.updateSpamRules();
            toast.success(result.message || 'Rules updated');
        } catch (err) { toast.error('Failed to update rules'); }
        finally { setActionLoading(false); }
    };

    const handleWebmailInstall = async () => {
        setActionLoading(true);
        try {
            await api.installWebmail({});
            toast.success('Roundcube installed');
            const d = await api.getWebmailStatus();
            setWebmailStatus(d);
        } catch (err) { toast.error('Installation failed'); }
        finally { setActionLoading(false); }
    };

    const handleWebmailControl = async (action) => {
        setActionLoading(true);
        try {
            await api.controlWebmail(action);
            toast.success(`Roundcube ${action} successful`);
            const d = await api.getWebmailStatus();
            setWebmailStatus(d);
        } catch (err) { toast.error(`Failed to ${action}`); }
        finally { setActionLoading(false); }
    };

    const handleConfigureProxy = async () => {
        if (!proxyDomain) return;
        setActionLoading(true);
        try {
            await api.configureWebmailProxy(proxyDomain);
            toast.success('Proxy configured');
        } catch (err) { toast.error('Failed to configure proxy'); }
        finally { setActionLoading(false); }
    };

    const handleFlushQueue = async () => {
        setActionLoading(true);
        try {
            await api.flushMailQueue();
            toast.success('Queue flushed');
            const d = await api.getMailQueue();
            setQueue(d.queue || []);
        } catch (err) { toast.error('Failed to flush queue'); }
        finally { setActionLoading(false); }
    };

    const handleDeleteQueueItem = async (queueId) => {
        try {
            await api.deleteMailQueueItem(queueId);
            toast.success('Message deleted');
            const d = await api.getMailQueue();
            setQueue(d.queue || []);
        } catch (err) { toast.error('Failed to delete message'); }
    };

    // ── Render ──

    if (loading) return <div className="page-container email-page"><div className="page-loading"><Spinner /></div></div>;

    const isInstalled = status?.installed;

    const ServiceCard = ({ name, data, component }) => (
        <div className="email-service-card">
            <div className="email-service-header">
                <div>
                    <h3>{name}</h3>
                    {data?.version && <span className="version">v{data.version}</span>}
                </div>
                <Badge variant={data?.running ? 'success' : 'secondary'}>
                    {data?.running ? 'Running' : data?.installed ? 'Stopped' : 'Not Installed'}
                </Badge>
            </div>
            {data?.installed && (
                <div className="email-service-actions">
                    <Button size="sm" variant="outline" onClick={() => handleServiceControl(component, 'restart')} disabled={actionLoading}>Restart</Button>
                    {data?.running
                        ? <Button size="sm" variant="outline" onClick={() => handleServiceControl(component, 'stop')} disabled={actionLoading}>Stop</Button>
                        : <Button size="sm" onClick={() => handleServiceControl(component, 'start')} disabled={actionLoading}>Start</Button>
                    }
                </div>
            )}
        </div>
    );

    return (
        <div className="page-container email-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Email Server</h1>
                    <p className="page-description">Manage Postfix, Dovecot, DKIM, SpamAssassin, and Roundcube</p>
                </div>
                <div className="page-header-actions">
                    <Button size="sm" variant="outline" onClick={loadStatus}>Refresh</Button>
                </div>
            </div>

            {!isInstalled ? (
                <div className="not-installed">
                    <div className="icon">&#9993;</div>
                    <h2>Email Server Not Installed</h2>
                    <p>Install Postfix, Dovecot, OpenDKIM, and SpamAssassin to enable email hosting.</p>
                    <div className="install-form">
                        <div className="form-group w-full">
                            <label>Hostname (e.g. mail.example.com)</label>
                            <Input type="text" value={installHostname} onChange={e => setInstallHostname(e.target.value)} placeholder="mail.example.com" />
                        </div>
                        <Button onClick={handleInstall} disabled={actionLoading}>
                            {actionLoading ? 'Installing...' : 'Install Email Server'}
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList>
                            {VALID_TABS.map(tab => (
                                <TabsTrigger key={tab} value={tab}>
                                    {tab === 'dns-providers' ? 'DNS Providers' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </TabsTrigger>
                            ))}
                        </TabsList>

                        {/* Status Tab */}
                        <TabsContent value="status">
                            <div className="email-status">
                                <div className="status-grid">
                                    <ServiceCard name="Postfix (SMTP)" data={status?.postfix} component="postfix" />
                                    <ServiceCard name="Dovecot (IMAP)" data={status?.dovecot} component="dovecot" />
                                    <ServiceCard name="OpenDKIM" data={status?.dkim} component="opendkim" />
                                    <ServiceCard name="SpamAssassin" data={status?.spamassassin} component="spamassassin" />
                                    <ServiceCard name="Roundcube" data={status?.roundcube} component="roundcube" />
                                </div>
                            </div>
                        </TabsContent>

                        {/* Domains Tab */}
                        <TabsContent value="domains">
                            <div className="email-domains">
                                <div className="section-header">
                                    <h2>Email Domains</h2>
                                    <Button size="sm" variant={showDomainForm ? 'outline' : 'default'} onClick={() => setShowDomainForm(!showDomainForm)}>
                                        {showDomainForm ? 'Cancel' : 'Add Domain'}
                                    </Button>
                                </div>
                                {showDomainForm && (
                                    <form className="email-form" onSubmit={handleAddDomain}>
                                        <div className="form-grid">
                                            <div className="form-group">
                                                <label>Domain Name</label>
                                                <Input type="text" value={newDomain.name} onChange={e => setNewDomain({ ...newDomain, name: e.target.value })} placeholder="example.com" required />
                                            </div>
                                        </div>
                                        <div className="form-actions">
                                            <Button type="submit" size="sm" disabled={actionLoading}>Add Domain</Button>
                                        </div>
                                    </form>
                                )}
                                <div className="domain-list">
                                    {domains.length === 0 ? (
                                        <div className="empty-state"><p>No domains configured</p></div>
                                    ) : domains.map(d => (
                                        <div key={d.id} className="domain-card">
                                            <div className="domain-header">
                                                <h3>{d.name}</h3>
                                                <Badge variant={d.is_active ? 'success' : 'secondary'}>
                                                    {d.is_active ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </div>
                                            <div className="domain-stats">
                                                <span>{d.accounts_count} accounts</span>
                                                <span>{d.aliases_count} aliases</span>
                                            </div>
                                            <div className="domain-dns">
                                                <span className={`dns-badge ${d.dkim_public_key ? 'verified' : 'missing'}`}>DKIM</span>
                                                <span className={`dns-badge ${d.spf_record ? 'verified' : 'missing'}`}>SPF</span>
                                                <span className={`dns-badge ${d.dmarc_record ? 'verified' : 'missing'}`}>DMARC</span>
                                            </div>
                                            <div className="domain-actions">
                                                <Button size="sm" variant="outline" onClick={() => handleVerifyDNS(d.id)} disabled={actionLoading}>Verify DNS</Button>
                                                {d.dns_provider_id && <Button size="sm" onClick={() => handleDeployDNS(d.id)} disabled={actionLoading}>Deploy DNS</Button>}
                                                <Button size="sm" variant="destructive" onClick={() => handleDeleteDomain(d.id, d.name)}>Delete</Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </TabsContent>

                        {/* Accounts Tab */}
                        <TabsContent value="accounts">
                            <div className="email-accounts">
                                <div className="domain-selector">
                                    <div className="form-group">
                                        <label>Select Domain</label>
                                        <select value={selectedDomainId} onChange={e => setSelectedDomainId(e.target.value)}>
                                            <option value="">-- Select --</option>
                                            {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                                {selectedDomainId && (
                                    <>
                                        <div className="section-header">
                                            <h2>Accounts</h2>
                                            <Button size="sm" variant={showAccountForm ? 'outline' : 'default'} onClick={() => setShowAccountForm(!showAccountForm)}>
                                                {showAccountForm ? 'Cancel' : 'Create Account'}
                                            </Button>
                                        </div>
                                        {showAccountForm && (
                                            <form className="email-form" onSubmit={handleCreateAccount}>
                                                <div className="form-grid">
                                                    <div className="form-group">
                                                        <label>Username</label>
                                                        <Input type="text" value={newAccount.username} onChange={e => setNewAccount({ ...newAccount, username: e.target.value })} placeholder="user" required />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>Password</label>
                                                        <Input type="password" value={newAccount.password} onChange={e => setNewAccount({ ...newAccount, password: e.target.value })} required />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>Quota (MB)</label>
                                                        <Input type="number" value={newAccount.quota_mb} onChange={e => setNewAccount({ ...newAccount, quota_mb: parseInt(e.target.value) || 1024 })} />
                                                    </div>
                                                </div>
                                                <div className="form-actions">
                                                    <Button type="submit" size="sm" disabled={actionLoading}>Create</Button>
                                                </div>
                                            </form>
                                        )}
                                        <div className="accounts-list">
                                            {accounts.length === 0 ? (
                                                <div className="empty-state"><p>No accounts for this domain</p></div>
                                            ) : accounts.map(a => (
                                                <div key={a.id} className="account-card">
                                                    <div className="account-info">
                                                        <div className="account-email">{a.email}</div>
                                                        <div className="account-meta">
                                                            <span>Quota: {a.quota_mb}MB</span>
                                                            <Badge variant={a.is_active ? 'success' : 'secondary'}>
                                                                {a.is_active ? 'Active' : 'Disabled'}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                    <div className="account-actions">
                                                        <Button size="sm" variant="outline" onClick={() => { setShowPasswordModal(a.id); setNewPassword(''); }}>Password</Button>
                                                        <Button size="sm" variant="destructive" onClick={() => handleDeleteAccount(a.id, a.email)}>Delete</Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                                {showPasswordModal && (
                                    <div className="modal-overlay" onClick={() => setShowPasswordModal(null)}>
                                        <div className="modal-content" onClick={e => e.stopPropagation()}>
                                            <h3>Change Password</h3>
                                            <div className="form-group">
                                                <label>New Password</label>
                                                <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                                            </div>
                                            <div className="form-actions">
                                                <Button size="sm" variant="outline" onClick={() => setShowPasswordModal(null)}>Cancel</Button>
                                                <Button size="sm" onClick={handleChangePassword} disabled={actionLoading || !newPassword}>Change</Button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        {/* Aliases Tab */}
                        <TabsContent value="aliases">
                            <div className="email-aliases">
                                <div className="domain-selector">
                                    <div className="form-group">
                                        <label>Select Domain</label>
                                        <select value={aliasDomainId} onChange={e => setAliasDomainId(e.target.value)}>
                                            <option value="">-- Select --</option>
                                            {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                                {aliasDomainId && (
                                    <>
                                        <div className="section-header">
                                            <h2>Aliases</h2>
                                            <Button size="sm" variant={showAliasForm ? 'outline' : 'default'} onClick={() => setShowAliasForm(!showAliasForm)}>
                                                {showAliasForm ? 'Cancel' : 'Create Alias'}
                                            </Button>
                                        </div>
                                        {showAliasForm && (
                                            <form className="email-form" onSubmit={handleCreateAlias}>
                                                <div className="form-grid">
                                                    <div className="form-group">
                                                        <label>Source</label>
                                                        <Input type="text" value={newAlias.source} onChange={e => setNewAlias({ ...newAlias, source: e.target.value })} placeholder="info@example.com" required />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>Destination</label>
                                                        <Input type="text" value={newAlias.destination} onChange={e => setNewAlias({ ...newAlias, destination: e.target.value })} placeholder="user@example.com" required />
                                                    </div>
                                                </div>
                                                <div className="form-actions">
                                                    <Button type="submit" size="sm" disabled={actionLoading}>Create</Button>
                                                </div>
                                            </form>
                                        )}
                                        <div className="items-list">
                                            {aliases.length === 0 ? (
                                                <div className="empty-state"><p>No aliases for this domain</p></div>
                                            ) : aliases.map(a => (
                                                <div key={a.id} className="alias-card">
                                                    <div className="item-info">
                                                        <div className="item-mapping">{a.source} <span className="arrow">&rarr;</span> {a.destination}</div>
                                                    </div>
                                                    <div className="item-actions">
                                                        <Button size="sm" variant="destructive" onClick={() => handleDeleteAlias(a.id)}>Delete</Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </TabsContent>

                        {/* Forwarding Tab */}
                        <TabsContent value="forwarding">
                            <div className="email-forwarding">
                                <div className="domain-selector">
                                    <div className="form-group">
                                        <label>Select Account</label>
                                        <select value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)}>
                                            <option value="">-- Select --</option>
                                            {allAccounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                                        </select>
                                    </div>
                                </div>
                                {selectedAccountId && (
                                    <>
                                        <div className="section-header">
                                            <h2>Forwarding Rules</h2>
                                            <Button size="sm" variant={showForwardForm ? 'outline' : 'default'} onClick={() => setShowForwardForm(!showForwardForm)}>
                                                {showForwardForm ? 'Cancel' : 'Add Rule'}
                                            </Button>
                                        </div>
                                        {showForwardForm && (
                                            <form className="email-form" onSubmit={handleCreateForwarding}>
                                                <div className="form-grid">
                                                    <div className="form-group">
                                                        <label>Forward To</label>
                                                        <Input type="email" value={newForward.destination} onChange={e => setNewForward({ ...newForward, destination: e.target.value })} required />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>
                                                            <input type="checkbox" checked={newForward.keep_copy} onChange={e => setNewForward({ ...newForward, keep_copy: e.target.checked })} />
                                                            {' '}Keep a copy in mailbox
                                                        </label>
                                                    </div>
                                                </div>
                                                <div className="form-actions">
                                                    <Button type="submit" size="sm" disabled={actionLoading}>Add</Button>
                                                </div>
                                            </form>
                                        )}
                                        <div className="items-list">
                                            {forwardingRules.length === 0 ? (
                                                <div className="empty-state"><p>No forwarding rules</p></div>
                                            ) : forwardingRules.map(r => (
                                                <div key={r.id} className="forwarding-card">
                                                    <div className="item-info">
                                                        <div className="item-mapping">{r.account_email} <span className="arrow">&rarr;</span> {r.destination}</div>
                                                        <div className="item-meta">{r.keep_copy ? 'Keeps copy' : 'No copy'} &middot; {r.is_active ? 'Active' : 'Inactive'}</div>
                                                    </div>
                                                    <div className="item-actions">
                                                        <Button size="sm" variant="destructive" onClick={() => handleDeleteForwarding(r.id)}>Delete</Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </TabsContent>

                        {/* DNS Providers Tab */}
                        <TabsContent value="dns-providers">
                            <div className="email-dns-providers">
                                <div className="section-header">
                                    <h2>DNS Providers</h2>
                                    <Button size="sm" variant={showProviderForm ? 'outline' : 'default'} onClick={() => setShowProviderForm(!showProviderForm)}>
                                        {showProviderForm ? 'Cancel' : 'Add Provider'}
                                    </Button>
                                </div>
                                {showProviderForm && (
                                    <form className="email-form" onSubmit={handleAddProvider}>
                                        <div className="form-grid">
                                            <div className="form-group"><label>Name</label><Input type="text" value={newProvider.name} onChange={e => setNewProvider({ ...newProvider, name: e.target.value })} required /></div>
                                            <div className="form-group">
                                                <label>Provider</label>
                                                <select value={newProvider.provider} onChange={e => setNewProvider({ ...newProvider, provider: e.target.value })}>
                                                    <option value="cloudflare">Cloudflare</option>
                                                    <option value="route53">Route53</option>
                                                </select>
                                            </div>
                                            <div className="form-group"><label>API Key</label><Input type="password" value={newProvider.api_key} onChange={e => setNewProvider({ ...newProvider, api_key: e.target.value })} required /></div>
                                            <div className="form-group"><label>API Secret (Route53)</label><Input type="password" value={newProvider.api_secret} onChange={e => setNewProvider({ ...newProvider, api_secret: e.target.value })} /></div>
                                            <div className="form-group"><label>API Email (Cloudflare)</label><Input type="email" value={newProvider.api_email} onChange={e => setNewProvider({ ...newProvider, api_email: e.target.value })} /></div>
                                        </div>
                                        <div className="form-actions"><Button type="submit" size="sm" disabled={actionLoading}>Add</Button></div>
                                    </form>
                                )}
                                <div className="provider-list">
                                    {providers.length === 0 ? (
                                        <div className="empty-state"><p>No DNS providers configured</p></div>
                                    ) : providers.map(p => (
                                        <div key={p.id} className="provider-card">
                                            <div className="provider-header">
                                                <h3>{p.name}</h3>
                                                <span className="provider-type">{p.provider}</span>
                                            </div>
                                            <div className="provider-meta">
                                                <div className="meta-row"><span>API Key: {p.api_key}</span>{p.is_default && <span><strong>Default</strong></span>}</div>
                                            </div>
                                            <div className="provider-actions">
                                                <Button size="sm" variant="outline" onClick={() => handleTestProvider(p.id)} disabled={actionLoading}>Test</Button>
                                                <Button size="sm" variant="outline" onClick={() => handleListZones(p.id)}>Zones</Button>
                                                <Button size="sm" variant="destructive" onClick={() => handleDeleteProvider(p.id)}>Delete</Button>
                                            </div>
                                            {providerZones[p.id] && (
                                                <div className="zones-list">
                                                    {providerZones[p.id].map(z => (
                                                        <div key={z.id} className="zone-item"><span>{z.name}</span><span>{z.id}</span></div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </TabsContent>

                        {/* Spam Tab */}
                        <TabsContent value="spam">
                            {spamConfig && (
                                <div className="email-spam">
                                    <div className="section-header">
                                        <h2>SpamAssassin Configuration</h2>
                                        <div className="section-actions">
                                            <Button size="sm" variant="outline" onClick={handleUpdateSpamRules} disabled={actionLoading}>Update Rules</Button>
                                            <Button size="sm" onClick={handleUpdateSpam} disabled={actionLoading}>Save</Button>
                                        </div>
                                    </div>
                                    <div className="spam-config">
                                        <div className="form-grid">
                                            <div className="form-group">
                                                <label>Required Score</label>
                                                <Input type="number" step="0.1" value={spamConfig.required_score} onChange={e => setSpamConfig({ ...spamConfig, required_score: parseFloat(e.target.value) })} />
                                            </div>
                                            <div className="form-group">
                                                <label>Rewrite Subject</label>
                                                <Input type="text" value={spamConfig.rewrite_subject} onChange={e => setSpamConfig({ ...spamConfig, rewrite_subject: e.target.value })} />
                                            </div>
                                            <div className="form-group checkbox-field">
                                                <input type="checkbox" checked={!!spamConfig.use_bayes} onChange={e => setSpamConfig({ ...spamConfig, use_bayes: e.target.checked ? 1 : 0 })} />
                                                <label>Enable Bayesian Filter</label>
                                            </div>
                                            <div className="form-group checkbox-field">
                                                <input type="checkbox" checked={!!spamConfig.bayes_auto_learn} onChange={e => setSpamConfig({ ...spamConfig, bayes_auto_learn: e.target.checked ? 1 : 0 })} />
                                                <label>Auto-learn</label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </TabsContent>

                        {/* Webmail Tab */}
                        <TabsContent value="webmail">
                            <div className="email-webmail">
                                <div className="section-header"><h2>Roundcube Webmail</h2></div>
                                <div className="webmail-card">
                                    <div className="webmail-status-row">
                                        <Badge variant={webmailStatus?.running ? 'success' : 'secondary'}>
                                            {webmailStatus?.running ? 'Running' : webmailStatus?.installed ? 'Stopped' : 'Not Installed'}
                                        </Badge>
                                        {webmailStatus?.port && <span>Port: {webmailStatus.port}</span>}
                                    </div>
                                    <div className="webmail-actions">
                                        {!webmailStatus?.installed ? (
                                            <Button size="sm" onClick={handleWebmailInstall} disabled={actionLoading}>Install Roundcube</Button>
                                        ) : (
                                            <>
                                                {webmailStatus?.running
                                                    ? <Button size="sm" variant="outline" onClick={() => handleWebmailControl('stop')} disabled={actionLoading}>Stop</Button>
                                                    : <Button size="sm" onClick={() => handleWebmailControl('start')} disabled={actionLoading}>Start</Button>
                                                }
                                                <Button size="sm" variant="outline" onClick={() => handleWebmailControl('restart')} disabled={actionLoading}>Restart</Button>
                                            </>
                                        )}
                                    </div>
                                    {webmailStatus?.installed && (
                                        <div className="proxy-form">
                                            <div className="form-group">
                                                <label>Proxy Domain</label>
                                                <Input type="text" value={proxyDomain} onChange={e => setProxyDomain(e.target.value)} placeholder="webmail.example.com" />
                                            </div>
                                            <Button size="sm" onClick={handleConfigureProxy} disabled={actionLoading || !proxyDomain}>Configure Nginx Proxy</Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </TabsContent>

                        {/* Queue & Logs Tab */}
                        <TabsContent value="queue">
                            <div>
                                <div className="email-queue">
                                    <div className="section-header">
                                        <h2>Mail Queue ({queue.length})</h2>
                                        <Button size="sm" variant="outline" onClick={handleFlushQueue} disabled={actionLoading}>Flush Queue</Button>
                                    </div>
                                    <div className="queue-list">
                                        {queue.length === 0 ? (
                                            <div className="empty-state"><p>Queue is empty</p></div>
                                        ) : queue.map(item => (
                                            <div key={item.queue_id} className="queue-item">
                                                <div className="queue-info">
                                                    <div className="queue-id">{item.queue_id}</div>
                                                    <div className="queue-meta">
                                                        <span>From: {item.sender}</span>
                                                        <span>Size: {item.size}B</span>
                                                        <span>{item.arrival_time}</span>
                                                    </div>
                                                    {item.error && <div className="queue-error">{item.error}</div>}
                                                </div>
                                                <Button size="sm" variant="destructive" onClick={() => handleDeleteQueueItem(item.queue_id)}>Delete</Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="email-logs mt-8">
                                    <div className="section-header">
                                        <h2>Mail Logs</h2>
                                        <div className="log-controls">
                                            <select value={logLines} onChange={e => setLogLines(parseInt(e.target.value))}>
                                                <option value={50}>50 lines</option>
                                                <option value={100}>100 lines</option>
                                                <option value={500}>500 lines</option>
                                            </select>
                                        </div>
                                    </div>
                                    <pre className="log-output">{logs.length > 0 ? logs.join('\n') : 'No logs available'}</pre>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </>
            )}

            {confirmDialog && <ConfirmDialog {...confirmDialog} />}
        </div>
    );
}

export default Email;
