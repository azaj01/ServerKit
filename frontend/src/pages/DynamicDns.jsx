import { useState, useEffect, useCallback } from 'react';
import { Network, Radio, Copy, Check, AlertTriangle } from 'lucide-react';
import { PageTopbar } from '@/components/ds';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
} from '@/components/ui/select';

// One-time token callout — the token is only returned once on create/regenerate.
const TokenCallout = ({ host, onDismiss }) => {
    const toast = useToast();
    const [copied, setCopied] = useState(null);

    const updateUrl = `${window.location.origin}/api/v1/ddns/update?token=${host.token}`;

    async function copy(text, key) {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            toast.success('Copied to clipboard');
            setTimeout(() => setCopied(null), 1500);
        } catch {
            toast.error('Copy failed — copy it manually');
        }
    }

    return (
        <div className="ddns-token-callout">
            <div className="ddns-token-callout__head">
                <AlertTriangle size={16} />
                <span>
                    Token for <strong>{host.hostname || host.record_name}</strong> — shown once. Save it now.
                </span>
                <button className="ddns-token-callout__close" onClick={onDismiss} aria-label="Dismiss">
                    &times;
                </button>
            </div>

            <div className="ddns-token-callout__row">
                <span className="ddns-token-callout__label">Token</span>
                <code className="ddns-token-callout__value">{host.token}</code>
                <Button variant="outline" size="sm" onClick={() => copy(host.token, 'token')}>
                    {copied === 'token' ? <Check size={14} /> : <Copy size={14} />}
                </Button>
            </div>

            <div className="ddns-token-callout__row">
                <span className="ddns-token-callout__label">Update URL</span>
                <code className="ddns-token-callout__value">{updateUrl}</code>
                <Button variant="outline" size="sm" onClick={() => copy(updateUrl, 'url')}>
                    {copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
                </Button>
            </div>
        </div>
    );
};

const DynamicDns = () => {
    const toast = useToast();
    const [hosts, setHosts] = useState([]);
    const [zones, setZones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [revealedToken, setRevealedToken] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    const [form, setForm] = useState({ zone_id: '', record_name: '', label: '', enabled: true });

    const loadHosts = useCallback(async () => {
        try {
            const data = await api.getDdnsHosts();
            setHosts(data.hosts || []);
        } catch {
            toast.error('Failed to load dynamic DNS hosts');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    const loadZones = useCallback(async () => {
        try {
            const data = await api.getDNSZones();
            setZones(data.zones || []);
        } catch {
            /* zones populate the create form; a failure just leaves it empty */
        }
    }, []);

    useEffect(() => {
        loadHosts();
        loadZones();
    }, [loadHosts, loadZones]);

    async function handleCreate() {
        if (!form.zone_id || !form.record_name.trim()) {
            toast.error('Pick a zone and enter a record name');
            return;
        }
        setCreating(true);
        try {
            const host = await api.createDdnsHost({
                zone_id: form.zone_id,
                record_name: form.record_name.trim(),
                label: form.label.trim() || undefined,
                enabled: form.enabled,
            });
            toast.success('Dynamic DNS host created');
            setRevealedToken(host);
            setForm({ zone_id: '', record_name: '', label: '', enabled: true });
            loadHosts();
        } catch (err) {
            toast.error(err.message || 'Failed to create host');
        } finally {
            setCreating(false);
        }
    }

    async function handleRegenerate(host) {
        try {
            const updated = await api.regenerateDdnsToken(host.id);
            toast.success('Token regenerated');
            setRevealedToken(updated);
            loadHosts();
        } catch (err) {
            toast.error(err.message || 'Failed to regenerate token');
        }
    }

    async function handleDelete(id) {
        try {
            await api.deleteDdnsHost(id);
            toast.success('Host deleted');
            setDeleteConfirm(null);
            if (revealedToken?.id === id) setRevealedToken(null);
            loadHosts();
        } catch (err) {
            toast.error(err.message || 'Failed to delete host');
        }
    }

    if (loading) return <div className="page-container"><Spinner /></div>;

    return (
        <div className="page-container ddns-page">
            <PageTopbar
                icon={<Radio size={18} />}
                title="Dynamic DNS"
                meta={`${hosts.length} host${hosts.length !== 1 ? 's' : ''}`}
            />

            {revealedToken && (
                <TokenCallout host={revealedToken} onDismiss={() => setRevealedToken(null)} />
            )}

            <div className="ddns-layout">
                {/* Create form */}
                <div className="ddns-create">
                    <h2 className="ddns-create__title">Add a host</h2>
                    <p className="ddns-create__hint">
                        Create an A-record that a remote machine can keep up to date by calling the
                        update URL. The token is shown once after creation.
                    </p>

                    <div className="form-group">
                        <Label>Zone</Label>
                        <Select value={form.zone_id} onValueChange={(v) => setForm({ ...form, zone_id: v })}>
                            <SelectTrigger>
                                <SelectValue placeholder={zones.length ? 'Select a zone' : 'No zones available'} />
                            </SelectTrigger>
                            <SelectContent>
                                {zones.map((z) => (
                                    <SelectItem key={z.id} value={String(z.id)}>{z.domain}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="form-group">
                        <Label>Record name</Label>
                        <Input
                            value={form.record_name}
                            onChange={(e) => setForm({ ...form, record_name: e.target.value })}
                            placeholder="home (or @ for the apex)"
                        />
                    </div>

                    <div className="form-group">
                        <Label>Label (optional)</Label>
                        <Input
                            value={form.label}
                            onChange={(e) => setForm({ ...form, label: e.target.value })}
                            placeholder="e.g. Home office router"
                        />
                    </div>

                    <Button onClick={handleCreate} disabled={creating || zones.length === 0}>
                        {creating ? 'Creating…' : 'Create host'}
                    </Button>
                    {zones.length === 0 && (
                        <p className="ddns-create__warn">Add a DNS zone first to create a dynamic host.</p>
                    )}
                </div>

                {/* Hosts table */}
                <div className="ddns-hosts">
                    <table className="sk-dtable ddns-hosts__table">
                        <thead>
                            <tr>
                                <th>Hostname</th>
                                <th>Last IP</th>
                                <th>Last update</th>
                                <th>Status</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {hosts.map((host) => (
                                <tr key={host.id}>
                                    <td>
                                        <div className="ddns-hosts__name">
                                            <strong>{host.hostname || host.record_name}</strong>
                                            {host.label && <span className="text-muted">{host.label}</span>}
                                        </div>
                                    </td>
                                    <td className="sk-cell-mono">{host.last_ip || '—'}</td>
                                    <td>
                                        {host.last_update_at
                                            ? new Date(host.last_update_at).toLocaleString()
                                            : 'Never'}
                                    </td>
                                    <td>
                                        <span className={`status-dot status-dot--${host.enabled ? 'success' : 'danger'}`} />
                                        {host.enabled ? 'Enabled' : 'Disabled'}
                                    </td>
                                    <td>
                                        <div className="ddns-hosts__actions">
                                            <Button variant="outline" size="sm" onClick={() => handleRegenerate(host)}>
                                                Regenerate token
                                            </Button>
                                            <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(host)}>
                                                Delete
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {hosts.length === 0 && (
                                <tr>
                                    <td colSpan={5}>
                                        <EmptyState icon={Network} title="No dynamic DNS hosts yet" />
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {deleteConfirm && (
                <ConfirmDialog
                    title="Delete dynamic DNS host"
                    message={`Delete "${deleteConfirm.hostname || deleteConfirm.record_name}"? Its update token will stop working.`}
                    onConfirm={() => handleDelete(deleteConfirm.id)}
                    onCancel={() => setDeleteConfirm(null)}
                    variant="danger"
                />
            )}
        </div>
    );
};

export default DynamicDns;
