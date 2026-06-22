import { useState, useEffect } from 'react';
import api from '../../services/api';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const SiteSettingsTab = ({ onDevModeChange }) => {
    const [settings, setSettings] = useState({
        registration_enabled: false,
        dev_mode: false
    });
    const [basePort, setBasePort] = useState('0');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingPort, setSavingPort] = useState(false);
    const [message, setMessage] = useState(null);
    const [https, setHttps] = useState({ base_domain: '', server_ip: '', https_enabled: false, dns_mode: 'wildcard', providers: [] });
    const [baseDomain, setBaseDomain] = useState('');
    const [serverIp, setServerIp] = useState('');
    const [dnsMode, setDnsMode] = useState('wildcard');
    const [providerId, setProviderId] = useState('');
    const [savingDomain, setSavingDomain] = useState(false);
    const [savingDnsMode, setSavingDnsMode] = useState(false);
    const [settingUpHttps, setSettingUpHttps] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    async function loadSettings() {
        try {
            const data = await api.getSystemSettings();
            setSettings({
                registration_enabled: data.registration_enabled || false,
                dev_mode: data.dev_mode || false
            });
            setBasePort(String(data.managed_app_base_port ?? 0));
            try {
                const h = await api.getSitesHttpsStatus();
                setHttps(h);
                setBaseDomain(h.base_domain || '');
                setServerIp(h.server_ip || '');
                setDnsMode(h.dns_mode || 'wildcard');
                if (h.providers?.length) setProviderId(String(h.providers[0].id));
            } catch { /* non-admin or endpoint unavailable */ }
        } catch (err) {
            console.error('Failed to load settings:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSaveDomain() {
        setSavingDomain(true);
        setMessage(null);
        try {
            await api.updateSystemSetting('sites_base_domain', baseDomain.trim());
            await api.updateSystemSetting('server_public_ip', serverIp.trim());
            setMessage({ type: 'success', text: 'Sites domain settings saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to save domain settings' });
        } finally {
            setSavingDomain(false);
        }
    }

    async function handleSaveDnsMode(mode) {
        setSavingDnsMode(true);
        setMessage(null);
        try {
            await api.updateSystemSetting('sites_dns_mode', mode);
            setDnsMode(mode);
            setHttps((h) => ({ ...h, dns_mode: mode }));
            setMessage({
                type: 'success',
                text: mode === 'per-site'
                    ? 'Per-site DNS — new sites get their own A record'
                    : 'Wildcard DNS — new sites ride the *.base record',
            });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to update DNS mode' });
        } finally {
            setSavingDnsMode(false);
        }
    }

    async function handleSetupHttps() {
        if (!providerId) {
            setMessage({ type: 'error', text: 'Connect and select a DNS provider first' });
            return;
        }
        setSettingUpHttps(true);
        setMessage(null);
        try {
            // Persist the typed domain/IP first so setup reads current values.
            await api.updateSystemSetting('sites_base_domain', baseDomain.trim());
            await api.updateSystemSetting('server_public_ip', serverIp.trim());
            const res = await api.setupSitesHttps(Number(providerId));
            if (res.success) {
                setHttps((h) => ({ ...h, https_enabled: true }));
                setMessage({
                    type: 'success',
                    text: `Wildcard HTTPS set up for *.${res.base_domain}` + (res.warning ? ` — ${res.warning}` : ''),
                });
            } else {
                setMessage({ type: 'error', text: res.error || 'HTTPS setup failed' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'HTTPS setup failed' });
        } finally {
            setSettingUpHttps(false);
        }
    }

    async function handleSaveBasePort() {
        const value = parseInt(basePort, 10);
        if (Number.isNaN(value) || value < 0 || value > 65535) {
            setMessage({ type: 'error', text: 'Base port must be between 0 and 65535 (0 = template default)' });
            return;
        }
        setSavingPort(true);
        setMessage(null);
        try {
            await api.updateSystemSetting('managed_app_base_port', value);
            setBasePort(String(value));
            setMessage({
                type: 'success',
                text: value === 0
                    ? 'Base port reset — new apps use each template\'s default'
                    : `New apps will be assigned ports starting from ${value}`
            });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to update base port' });
        } finally {
            setSavingPort(false);
        }
    }

    async function handleToggleSetting(key, label) {
        setSaving(true);
        setMessage(null);

        try {
            const newValue = !settings[key];
            await api.updateSystemSetting(key, newValue);
            setSettings({ ...settings, [key]: newValue });
            setMessage({ type: 'success', text: `${label} ${newValue ? 'enabled' : 'disabled'}` });
            if (key === 'dev_mode' && onDevModeChange) {
                onDevModeChange(newValue);
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to update setting' });
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <div className="settings-section"><p>Loading...</p></div>;
    }

    return (
        <div className="settings-section">
            <h2>Site Settings</h2>
            <p className="section-description">Configure global site settings</p>

            {message && (
                <div className={`message ${message.type}`}>{message.text}</div>
            )}

            <div className="settings-card">
                <h3>User Registration</h3>
                <p>Allow new users to create accounts on the login page.</p>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label>Enable public registration</Label>
                        </div>
                        <Switch
                            checked={settings.registration_enabled}
                            onCheckedChange={() => handleToggleSetting('registration_enabled', 'User registration')}
                            disabled={saving}
                        />
                    </div>
                    <span className="form-help">
                        When disabled, only administrators can create new user accounts.
                    </span>
                </div>
            </div>

            <div className="settings-card">
                <h3>Managed App Ports</h3>
                <p>Control the host port assigned to new WordPress sites and other managed apps.</p>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="managed-app-base-port">Base port</Label>
                        </div>
                        <div className="settings-control">
                            <Input
                                id="managed-app-base-port"
                                type="number"
                                min={0}
                                max={65535}
                                value={basePort}
                                onChange={(e) => setBasePort(e.target.value)}
                                disabled={savingPort}
                                className="w-32"
                            />
                            <Button onClick={handleSaveBasePort} disabled={savingPort}>
                                {savingPort ? 'Saving…' : 'Save'}
                            </Button>
                        </div>
                    </div>
                    <span className="form-help">
                        New apps get the first free port at or above this number. Set to <strong>0</strong> to
                        use each template&apos;s own default (WordPress starts at 8300). Ports already in use are
                        always skipped, so collisions can&apos;t happen.
                    </span>
                </div>
            </div>

            <div className="settings-card">
                <h3>Managed Sites Domain &amp; HTTPS</h3>
                <p>Publish managed sites at <code>&lt;name&gt;.&lt;base-domain&gt;</code>, auto-create their DNS, and serve them over HTTPS with a wildcard certificate.</p>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="sites-base-domain">Base domain</Label>
                        </div>
                        <div className="settings-control">
                            <Input
                                id="sites-base-domain"
                                type="text"
                                placeholder="apps.example.com"
                                value={baseDomain}
                                onChange={(e) => setBaseDomain(e.target.value)}
                                className="w-56"
                            />
                        </div>
                    </div>
                    <span className="form-help">
                        Each site is published at <code>&lt;name&gt;.{baseDomain || 'base-domain'}</code>. Point a
                        wildcard DNS record <code>*.{baseDomain || 'base-domain'}</code> at this server.
                    </span>
                </div>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="sites-server-ip">Server public IP</Label>
                        </div>
                        <div className="settings-control">
                            <Input
                                id="sites-server-ip"
                                type="text"
                                placeholder="203.0.113.10"
                                value={serverIp}
                                onChange={(e) => setServerIp(e.target.value)}
                                className="w-56"
                            />
                            <Button onClick={handleSaveDomain} disabled={savingDomain}>
                                {savingDomain ? 'Saving…' : 'Save'}
                            </Button>
                        </div>
                    </div>
                    <span className="form-help">Used to auto-create DNS A records for managed domains.</span>
                </div>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="sites-dns-mode">Subdomain DNS</Label>
                        </div>
                        <div className="settings-control">
                            <select
                                id="sites-dns-mode"
                                className="settings-select"
                                value={dnsMode}
                                onChange={(e) => handleSaveDnsMode(e.target.value)}
                                disabled={savingDnsMode}
                            >
                                <option value="wildcard">Wildcard — one record, every site instant</option>
                                <option value="per-site">Per-site — one A record per site</option>
                            </select>
                        </div>
                    </div>
                    <span className="form-help">
                        <strong>Wildcard</strong>: point <code>*.{baseDomain || 'base-domain'}</code> once and
                        every site resolves instantly. <strong>Per-site</strong>: each new site gets its own A
                        record, auto-created via a connected DNS provider (visible per record, ownership-tracked).
                    </span>
                </div>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label>Wildcard HTTPS</Label>
                            <span className="form-help">
                                {https.https_enabled
                                    ? 'Enabled — managed subdomains serve HTTPS.'
                                    : 'Not set up yet.'}
                            </span>
                        </div>
                        <div className="settings-control">
                            {https.providers?.length ? (
                                <select
                                    className="settings-select"
                                    value={providerId}
                                    onChange={(e) => setProviderId(e.target.value)}
                                >
                                    {https.providers.map((p) => (
                                        <option key={p.id} value={p.id}>{p.name} ({p.provider})</option>
                                    ))}
                                </select>
                            ) : (
                                <span className="form-help">Connect a DNS provider under Email → DNS Providers first.</span>
                            )}
                            <Button
                                onClick={handleSetupHttps}
                                disabled={settingUpHttps || !https.providers?.length || !baseDomain.trim()}
                            >
                                {settingUpHttps ? 'Setting up…' : 'Set up wildcard HTTPS'}
                            </Button>
                        </div>
                    </div>
                    <span className="form-help">
                        Creates <code>*.{baseDomain || 'base-domain'}</code> DNS and issues a wildcard
                        Let&apos;s Encrypt certificate via the selected provider (DNS-01).
                    </span>
                </div>
            </div>

            <div className="settings-card">
                <h3>Developer Mode</h3>
                <p>Enable developer tools and diagnostics.</p>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label>Enable developer mode</Label>
                        </div>
                        <Switch
                            checked={settings.dev_mode}
                            onCheckedChange={() => handleToggleSetting('dev_mode', 'Developer mode')}
                            disabled={saving}
                        />
                    </div>
                    <span className="form-help">
                        Enables the Developer tab with icon reference and diagnostic tools.
                    </span>
                </div>
            </div>
        </div>
    );
};

export default SiteSettingsTab;
