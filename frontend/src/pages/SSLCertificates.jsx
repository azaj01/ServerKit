import React, { useState, useEffect } from 'react';
import {
    ShieldCheck, ShieldOff, RefreshCw, Plus, Trash2,
    Lock, Clock, Globe, CheckCircle, AlertTriangle,
    Settings, Download
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';

const SSLCertificates = () => {
    const toast = useToast();
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [renewingDomain, setRenewingDomain] = useState(null);

    // Modal states
    const [showObtainModal, setShowObtainModal] = useState(false);

    // Form states
    const [domains, setDomains] = useState('');
    const [email, setEmail] = useState('');
    const [useNginx, setUseNginx] = useState(true);
    const [webrootPath, setWebrootPath] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const data = await api.getSSLStatus();
            setStatus(data);
        } catch (err) {
            console.error('Failed to load SSL status:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleObtainCertificate(e) {
        e.preventDefault();
        const domainList = domains.split(',').map(d => d.trim()).filter(Boolean);
        if (domainList.length === 0 || !email) return;

        try {
            setActionLoading(true);
            const data = { domains: domainList, email, use_nginx: useNginx };
            if (!useNginx && webrootPath) {
                data.webroot_path = webrootPath;
            }
            const result = await api.obtainCertificate(data);
            if (result.success) {
                toast.success('Certificate obtained successfully');
                setShowObtainModal(false);
                setDomains('');
                setEmail('');
                loadData();
            } else {
                toast.error(result.error || 'Failed to obtain certificate');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to obtain certificate');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleRenewCertificate(domain) {
        try {
            setRenewingDomain(domain);
            const result = await api.renewCertificate(domain);
            if (result.success) {
                toast.success(`Certificate for ${domain} renewed`);
                loadData();
            } else {
                toast.error(result.error || 'Renewal failed');
            }
        } catch (err) {
            toast.error(err.message || 'Renewal failed');
        } finally {
            setRenewingDomain(null);
        }
    }

    async function handleRenewAll() {
        try {
            setActionLoading(true);
            const result = await api.renewAllCertificates();
            if (result.success) {
                toast.success('All certificates renewed');
                loadData();
            } else {
                toast.error(result.error || 'Renewal failed');
            }
        } catch (err) {
            toast.error(err.message || 'Renewal failed');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleRevokeCertificate(domain) {
        const confirmed = await confirm({ title: 'Revoke Certificate', message: `Revoke and delete the certificate for ${domain}? This cannot be undone.` });
        if (!confirmed) return;

        try {
            setActionLoading(true);
            const result = await api.revokeCertificate(domain);
            if (result.success) {
                toast.success(`Certificate for ${domain} revoked`);
                loadData();
            } else {
                toast.error(result.error || 'Revocation failed');
            }
        } catch (err) {
            toast.error(err.message || 'Revocation failed');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleSetupAutoRenewal() {
        try {
            setActionLoading(true);
            const result = await api.setupAutoRenewal();
            if (result.success) {
                toast.success(result.message || 'Auto-renewal configured');
            } else {
                toast.error(result.error || 'Failed to setup auto-renewal');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to setup auto-renewal');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleInstallCertbot() {
        try {
            setActionLoading(true);
            toast.info('Installing Certbot... This may take a moment.');
            const result = await api.installCertbot();
            if (result.success) {
                toast.success('Certbot installed successfully');
                loadData();
            } else {
                toast.error(result.error || 'Failed to install Certbot');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to install Certbot');
        } finally {
            setActionLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="page-container ssl-page">
                <header className="top-bar">
                    <div>
                        <h1>SSL Certificates</h1>
                        <p className="subtitle">Manage Let's Encrypt SSL certificates</p>
                    </div>
                </header>
                <div className="ssl-status-bar">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="ssl-status-item">
                            <Skeleton className="w-12 h-12 rounded-xl" />
                            <div>
                                <Skeleton className="w-20 h-3.5 mb-1.5" />
                                <Skeleton className="w-12 h-3" />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="ssl-cert-list">
                    {[1, 2].map(i => (
                        <div key={i} className="ssl-cert-item">
                            <Skeleton className="w-10 h-10 rounded-xl" />
                            <div className="flex-1">
                                <Skeleton className="w-48 h-3.5 mb-2" />
                                <Skeleton className="w-72 h-3" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const certificates = status?.certificates || [];
    const expiringSoon = status?.expiring_soon || [];
    const certbotInstalled = status?.certbot_installed ?? false;

    return (
        <div className="page-container ssl-page">
            <header className="top-bar">
                <div>
                    <h1>SSL Certificates</h1>
                    <p className="subtitle">Manage Let's Encrypt SSL certificates</p>
                </div>
                <div className="top-bar-actions">
                    <Button
                        variant="outline"
                        onClick={handleSetupAutoRenewal}
                        disabled={actionLoading || !certbotInstalled}
                        title="Configure automatic renewal via systemd or cron"
                    >
                        <Settings size={16} />
                        Auto-Renew
                    </Button>
                    {certificates.length > 0 && (
                        <Button
                            variant="outline"
                            onClick={handleRenewAll}
                            disabled={actionLoading}
                        >
                            <RefreshCw size={16} />
                            Renew All
                        </Button>
                    )}
                    <Button variant="outline" onClick={loadData}>
                        <RefreshCw size={16} />
                        Refresh
                    </Button>
                    <Button
                        onClick={() => setShowObtainModal(true)}
                        disabled={!certbotInstalled}
                    >
                        <Plus size={16} />
                        New Certificate
                    </Button>
                </div>
            </header>

            {/* Status Cards */}
            <div className="ssl-status-bar">
                <div className="ssl-status-item">
                    <div className={`ssl-status-icon ${certbotInstalled ? 'active' : 'inactive'}`}>
                        {certbotInstalled ? <ShieldCheck size={24} /> : <ShieldOff size={24} />}
                    </div>
                    <div className="ssl-status-info">
                        <h4>Certbot</h4>
                        <span>{certbotInstalled ? 'Installed' : 'Not Installed'}</span>
                    </div>
                    {!certbotInstalled && (
                        <Button
                            size="sm"
                            onClick={handleInstallCertbot}
                            disabled={actionLoading}
                            className="ml-auto"
                        >
                            <Download size={14} />
                            Install
                        </Button>
                    )}
                </div>
                <div className="ssl-status-item">
                    <div className="ssl-status-icon active">
                        <Lock size={24} />
                    </div>
                    <div className="ssl-status-info">
                        <h4>Certificates</h4>
                        <span>{status?.total_certificates || 0} active</span>
                    </div>
                </div>
                <div className="ssl-status-item">
                    <div className={`ssl-status-icon ${expiringSoon.length > 0 ? 'warning' : 'active'}`}>
                        {expiringSoon.length > 0 ? <AlertTriangle size={24} /> : <CheckCircle size={24} />}
                    </div>
                    <div className="ssl-status-info">
                        <h4>Expiring Soon</h4>
                        <span>
                            {expiringSoon.length > 0
                                ? `${expiringSoon.length} certificate${expiringSoon.length > 1 ? 's' : ''}`
                                : 'All healthy'
                            }
                        </span>
                    </div>
                </div>
            </div>

            {/* Certificates List */}
            {certificates.length === 0 ? (
                <div className="empty-state">
                    <Lock size={48} />
                    <h3>No SSL certificates</h3>
                    <p>Obtain your first Let's Encrypt certificate to secure your domains.</p>
                    {certbotInstalled ? (
                        <Button onClick={() => setShowObtainModal(true)}>
                            <Plus size={16} />
                            New Certificate
                        </Button>
                    ) : (
                        <Button onClick={handleInstallCertbot} disabled={actionLoading}>
                            <Download size={16} />
                            Install Certbot First
                        </Button>
                    )}
                </div>
            ) : (
                <div className="ssl-cert-list">
                    {certificates.map((cert, index) => (
                        <div key={index} className="ssl-cert-item">
                            <div className="ssl-cert-item-info">
                                <div className={`ssl-cert-item-icon ${cert.expiry_valid ? '' : 'expiring'}`}>
                                    <ShieldCheck size={20} />
                                </div>
                                <div className="ssl-cert-item-details">
                                    <h3>{cert.name}</h3>
                                    <div className="ssl-cert-item-meta">
                                        <span>
                                            <Globe size={12} />
                                            {cert.domains?.join(', ') || cert.name}
                                        </span>
                                        {cert.expiry && (
                                            <span className={cert.expiry_valid ? 'valid' : 'expiring'}>
                                                <Clock size={12} />
                                                Expires: {cert.expiry}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="ssl-cert-item-status">
                                {cert.expiry_valid ? (
                                    <Badge variant="success">
                                        <CheckCircle size={14} />
                                        Valid
                                    </Badge>
                                ) : (
                                    <Badge variant="warning">
                                        <AlertTriangle size={14} />
                                        Expiring
                                    </Badge>
                                )}
                            </div>
                            <div className="ssl-cert-item-actions">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRenewCertificate(cert.name)}
                                    disabled={renewingDomain === cert.name || actionLoading}
                                >
                                    <RefreshCw size={14} className={renewingDomain === cert.name ? 'spin' : ''} />
                                    {renewingDomain === cert.name ? 'Renewing...' : 'Renew'}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRevokeCertificate(cert.name)}
                                    disabled={actionLoading}
                                >
                                    <Trash2 size={14} />
                                    Revoke
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Expiring Soon Warning */}
            {expiringSoon.length > 0 && (
                <div className="ssl-warning-banner">
                    <AlertTriangle size={18} />
                    <div>
                        <strong>Certificates expiring soon:</strong>{' '}
                        {expiringSoon.join(', ')}
                    </div>
                    <Button
                        size="sm"
                        onClick={handleRenewAll}
                        disabled={actionLoading}
                    >
                        <RefreshCw size={14} />
                        Renew All
                    </Button>
                </div>
            )}

            {/* Obtain Certificate Modal */}
            {showObtainModal && (
                <div className="modal-overlay" onClick={() => setShowObtainModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Obtain SSL Certificate</h2>
                            <button className="modal-close" onClick={() => setShowObtainModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleObtainCertificate}>
                            <div className="ssl-info-box">
                                <ShieldCheck size={32} />
                                <div>
                                    <h4>Free SSL from Let's Encrypt</h4>
                                    <p>Obtain a free, automatically-renewed SSL certificate for your domains.</p>
                                </div>
                            </div>
                            <div className="form-group">
                                <Label>Domains</Label>
                                <Input
                                    type="text"
                                    placeholder="example.com, www.example.com"
                                    value={domains}
                                    onChange={e => setDomains(e.target.value)}
                                    required
                                />
                                <p className="hint">Comma-separated list of domains</p>
                            </div>
                            <div className="form-group">
                                <Label>Email Address</Label>
                                <Input
                                    type="email"
                                    placeholder="admin@example.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                />
                                <p className="hint">For certificate expiration notifications</p>
                            </div>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <Checkbox
                                        checked={useNginx}
                                        onCheckedChange={setUseNginx}
                                    />
                                    Use Nginx plugin (recommended)
                                </label>
                            </div>
                            {!useNginx && (
                                <div className="form-group">
                                    <Label>Webroot Path</Label>
                                    <Input
                                        type="text"
                                        placeholder="/var/www/html"
                                        value={webrootPath}
                                        onChange={e => setWebrootPath(e.target.value)}
                                        required={!useNginx}
                                    />
                                    <p className="hint">Document root for HTTP validation</p>
                                </div>
                            )}
                            <div className="modal-actions">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setShowObtainModal(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={actionLoading}
                                >
                                    {actionLoading ? 'Obtaining...' : 'Obtain Certificate'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
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

export default SSLCertificates;
