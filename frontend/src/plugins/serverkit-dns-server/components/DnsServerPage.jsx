import { useCallback, useEffect, useState } from 'react';
import { Globe, RefreshCw, Plus, Trash2, Server } from 'lucide-react';
import api from '@/services/api';
import { PageTopbar, Pill } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import { useToast } from '@/contexts/ToastContext';
import ZoneDetail from './ZoneDetail.jsx';

const DnsServerPage = () => {
    const toast = useToast();

    const [status, setStatus] = useState(null);
    const [zones, setZones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [selectedZone, setSelectedZone] = useState(null);

    // Install form
    const [installForm, setInstallForm] = useState({ ns_hostname: '', admin_email: '' });

    // New zone modal
    const [showZoneModal, setShowZoneModal] = useState(false);
    const [zoneName, setZoneName] = useState('');

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const statusData = await api.request('/dns-server/status');
            setStatus(statusData);
            if (statusData?.installed) {
                const z = await api.request('/dns-server/zones').catch(() => ({ zones: [] }));
                setZones(z.zones || []);
            }
        } catch (error) {
            toast.error(`Failed to load DNS server status: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleInstall = async () => {
        if (!installForm.ns_hostname.trim() || !installForm.admin_email.trim()) return;
        setActionLoading(true);
        try {
            await api.request('/dns-server/install', {
                method: 'POST',
                body: {
                    ns_hostname: installForm.ns_hostname.trim(),
                    admin_email: installForm.admin_email.trim(),
                },
            });
            toast.success('PowerDNS authoritative server installed');
            await loadData();
        } catch (error) {
            toast.error(`Install failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleUninstall = (keepData) => {
        setConfirmDialog({
            title: 'Remove DNS server',
            message: keepData
                ? 'Remove the PowerDNS container? Zone data stays on disk and a reinstall picks it back up.'
                : 'Remove the PowerDNS container AND delete all zone data? This cannot be undone.',
            confirmText: 'Remove',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.request(`/dns-server/install?keep_data=${keepData}`, { method: 'DELETE' });
                    toast.success('DNS server removed');
                    setSelectedZone(null);
                    await loadData();
                } catch (error) {
                    toast.error(`Uninstall failed: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleCreateZone = async () => {
        if (!zoneName.trim()) return;
        setActionLoading(true);
        try {
            await api.request('/dns-server/zones', {
                method: 'POST',
                body: { name: zoneName.trim() },
            });
            toast.success(`Zone ${zoneName} created`);
            setShowZoneModal(false);
            setZoneName('');
            await loadData();
        } catch (error) {
            toast.error(`Failed to create zone: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteZone = (name) => {
        setConfirmDialog({
            title: 'Delete zone',
            message: `Delete zone ${name} and all of its records?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.request(`/dns-server/zones/${encodeURIComponent(name)}`, { method: 'DELETE' });
                    toast.success(`Zone ${name} deleted`);
                    if (selectedZone === name) setSelectedZone(null);
                    await loadData();
                } catch (error) {
                    toast.error(`Failed to delete zone: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    if (loading) {
        return (
            <div className="page-container dns-server-page">
                <PageTopbar icon={<Globe size={18} />} title="DNS Server" />
                <EmptyState loading title="Loading DNS server status..." />
            </div>
        );
    }

    // ── Not installed: explainer + install form ──
    if (!status?.installed) {
        return (
            <div className="page-container dns-server-page">
                <PageTopbar icon={<Globe size={18} />} title="DNS Server" />
                <div className="card">
                    <div className="card-header">
                        <h3>Host Your Own Nameserver</h3>
                    </div>
                    <div className="card-body">
                        <p>
                            Run PowerDNS (authoritative, SQLite backend) in a managed Docker
                            container so this box answers DNS for your domains directly —
                            handy for homelabs and air-gapped networks where a hosted DNS
                            provider is not an option.
                        </p>
                        <ul className="dns-explainer">
                            <li>
                                <strong>Authoritative only.</strong> This serves the zones you
                                create; it never resolves other names for clients. Keep using
                                your normal resolver.
                            </li>
                            <li>
                                <strong>Port 53 must be free</strong> on this host (tcp + udp).
                                systemd-resolved or another DNS service will conflict.
                            </li>
                            <li>
                                <strong>Delegation happens at your registrar.</strong> Point the
                                domain&apos;s NS (and glue) records at this box&apos;s nameserver
                                hostname so the world finds it.
                            </li>
                            <li>
                                This complements provider integrations (Cloudflare etc.) — it
                                does not replace them.
                            </li>
                        </ul>
                        <div className="dns-install-form">
                            <div className="form-group">
                                <Label>Nameserver hostname</Label>
                                <Input
                                    type="text"
                                    value={installForm.ns_hostname}
                                    onChange={(e) => setInstallForm((f) => ({ ...f, ns_hostname: e.target.value }))}
                                    placeholder="ns1.example.com"
                                />
                                <p className="text-muted">
                                    The hostname other resolvers will use to reach this server.
                                    It should resolve (via glue records) to this box&apos;s public IP.
                                </p>
                            </div>
                            <div className="form-group">
                                <Label>Hostmaster email</Label>
                                <Input
                                    type="email"
                                    value={installForm.admin_email}
                                    onChange={(e) => setInstallForm((f) => ({ ...f, admin_email: e.target.value }))}
                                    placeholder="hostmaster@example.com"
                                />
                                <p className="text-muted">Used in each zone&apos;s SOA record.</p>
                            </div>
                            <div className="dns-install-actions">
                                <Button
                                    variant="default"
                                    onClick={handleInstall}
                                    disabled={actionLoading || !installForm.ns_hostname.trim() || !installForm.admin_email.trim()}
                                >
                                    {actionLoading ? 'Installing...' : 'Install DNS Server'}
                                </Button>
                                <Button variant="outline" onClick={loadData}>
                                    <RefreshCw size={14} /> Re-check
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container dns-server-page">
            <PageTopbar
                icon={<Globe size={18} />}
                title="DNS Server"
                actions={
                    <>
                        <Button variant="default" size="sm" onClick={() => setShowZoneModal(true)}>
                            <Plus size={14} /> New Zone
                        </Button>
                        <Button variant="outline" size="sm" onClick={loadData}>
                            <RefreshCw size={14} /> Refresh
                        </Button>
                    </>
                }
            />

            {/* ── Status ── */}
            <div className="card">
                <div className="card-header">
                    <h3>Server Status</h3>
                    <div className="card-actions">
                        <Button variant="secondary" size="sm" onClick={() => handleUninstall(true)}>
                            Remove (keep data)
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleUninstall(false)}>
                            <Trash2 size={14} /> Remove + data
                        </Button>
                    </div>
                </div>
                <div className="card-body">
                    <div className="sec-rows">
                        <div className="sk-info-row">
                            <span className="k">Container</span>
                            <Pill kind={status.running ? 'green' : 'red'}>
                                {status.running ? 'Running' : 'Stopped'}
                            </Pill>
                        </div>
                        <div className="sk-info-row">
                            <span className="k">Engine</span>
                            <span className="v">
                                PowerDNS Authoritative {status.version ? `v${status.version}` : '(version unavailable)'}
                            </span>
                        </div>
                        <div className="sk-info-row">
                            <span className="k">Nameserver</span>
                            <span className="v sk-cell-mono">{status.ns_hostname || '—'}</span>
                        </div>
                        <div className="sk-info-row">
                            <span className="k">Mode</span>
                            <span className="v">Authoritative only — no recursion, by design.</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Zones ── */}
            <div className="card sec-flush">
                <div className="card-header">
                    <h3>Zones {zones.length > 0 && <span className="sec-count">· {zones.length}</span>}</h3>
                </div>
                {zones.length === 0 ? (
                    <div className="card-body">
                        <p className="text-muted">
                            No zones yet. Create one, then point the domain&apos;s nameservers here
                            at your registrar.
                        </p>
                    </div>
                ) : (
                    <table className="sk-dtable">
                        <thead>
                            <tr>
                                <th>Zone</th>
                                <th>Kind</th>
                                <th>Serial</th>
                                <th>DNSSEC</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {zones.map((z) => (
                                <tr key={z.name}>
                                    <td className="sk-cell-mono">
                                        <button
                                            type="button"
                                            className="dns-zone-link"
                                            onClick={() => setSelectedZone(z.name)}
                                        >
                                            {z.name}
                                        </button>
                                    </td>
                                    <td>{z.kind || '—'}</td>
                                    <td>{z.serial ?? '—'}</td>
                                    <td>
                                        <Pill kind={z.dnssec ? 'green' : 'gray'}>
                                            {z.dnssec ? 'Signed' : 'Off'}
                                        </Pill>
                                    </td>
                                    <td>
                                        <Button variant="secondary" size="sm" onClick={() => setSelectedZone(z.name)}>
                                            <Server size={14} /> Manage
                                        </Button>{' '}
                                        <Button variant="secondary" size="sm" onClick={() => handleDeleteZone(z.name)}>
                                            Delete
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── Zone detail ── */}
            {selectedZone && (
                <ZoneDetail
                    zoneName={selectedZone}
                    onClose={() => setSelectedZone(null)}
                    onChanged={loadData}
                />
            )}

            {/* ── New zone modal ── */}
            <Modal open={showZoneModal} onClose={() => setShowZoneModal(false)} title="New Zone">
                <div className="form-group">
                    <Label>Zone name</Label>
                    <Input
                        type="text"
                        value={zoneName}
                        onChange={(e) => setZoneName(e.target.value)}
                        placeholder="example.com"
                    />
                    <p className="text-muted">
                        SOA and NS records are bootstrapped from the nameserver hostname and
                        hostmaster email you provided at install.
                    </p>
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowZoneModal(false)}>Cancel</Button>
                    <Button variant="default" onClick={handleCreateZone} disabled={actionLoading || !zoneName.trim()}>
                        {actionLoading ? 'Creating...' : 'Create Zone'}
                    </Button>
                </div>
            </Modal>

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
};

export default DnsServerPage;
