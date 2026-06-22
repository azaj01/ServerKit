import React, { useState, useEffect, useCallback } from 'react';
import { Globe } from 'lucide-react';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { FormField, FormRow } from '../components/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/ds';
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
} from '@/components/ui/select';

const DNSZones = () => {
    const toast = useToast();
    const { user } = useAuth();
    const [zones, setZones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedZone, setSelectedZone] = useState(null);
    const [records, setRecords] = useState([]);
    const [showCreateZone, setShowCreateZone] = useState(false);
    const [showCreateRecord, setShowCreateRecord] = useState(false);
    const [showPropagation, setShowPropagation] = useState(null);
    const [propagationResults, setPropagationResults] = useState([]);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    const [zoneForm, setZoneForm] = useState({ domain: '', dns_provider_config_id: '' });
    const [providers, setProviders] = useState([]);
    const [recordForm, setRecordForm] = useState({
        record_type: 'A', name: '@', content: '', ttl: 3600, priority: null
    });

    const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'];

    const loadZones = useCallback(async () => {
        try {
            const data = await api.getDNSZones();
            setZones(data.zones || []);
        } catch (err) {
            toast.error('Failed to load DNS zones');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadZones(); }, [loadZones]);

    // Lazily load connected DNS providers (Settings -> Connections) for the
    // zone picker the first time the modal opens.
    useEffect(() => {
        if (showCreateZone && providers.length === 0) {
            api.getEmailDNSProviders()
                .then(d => setProviders(d.providers || []))
                .catch(() => {});
        }
    }, [showCreateZone, providers.length]);

    const loadRecords = async (zoneId) => {
        try {
            const data = await api.getDNSRecords(zoneId);
            setRecords(data.records || []);
            setSelectedZone(zones.find(z => z.id === zoneId));
        } catch (err) {
            toast.error('Failed to load records');
        }
    };

    const handleCreateZone = async () => {
        try {
            const payload = { domain: zoneForm.domain };
            if (zoneForm.dns_provider_config_id) {
                payload.dns_provider_config_id = Number(zoneForm.dns_provider_config_id);
            } else {
                payload.provider = 'manual';
            }
            await api.createDNSZone(payload);
            toast.success('Zone created');
            setShowCreateZone(false);
            setZoneForm({ domain: '', dns_provider_config_id: '' });
            loadZones();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleCreateRecord = async () => {
        if (!selectedZone) return;
        try {
            await api.createDNSRecord(selectedZone.id, recordForm);
            toast.success('Record created');
            setShowCreateRecord(false);
            setRecordForm({ record_type: 'A', name: '@', content: '', ttl: 3600, priority: null });
            loadRecords(selectedZone.id);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteRecord = async (recordId) => {
        try {
            await api.deleteDNSRecord(recordId);
            toast.success('Record deleted');
            if (selectedZone) loadRecords(selectedZone.id);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteZone = async (id) => {
        try {
            await api.deleteDNSZone(id);
            toast.success('Zone deleted');
            setDeleteConfirm(null);
            if (selectedZone?.id === id) {
                setSelectedZone(null);
                setRecords([]);
            }
            loadZones();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleCheckPropagation = async (domain) => {
        try {
            const data = await api.checkDNSPropagation(domain);
            setPropagationResults(data.results || []);
            setShowPropagation(domain);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleExport = async (zoneId) => {
        try {
            const data = await api.exportDNSZone(zoneId);
            const blob = new Blob([data.zone_file], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${selectedZone?.domain || 'zone'}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(err.message);
        }
    };

    useTopbarActions(() =>
        user?.is_admin && (
            <Button size="sm" onClick={() => setShowCreateZone(true)}>Add Zone</Button>
        ),
        [user?.is_admin],
    );

    if (loading) return <PageLoader />;

    return (
        <div className="sk-tabgroup__inner dns-zones-page">
            <div className="dns-layout">
                <div className="dns-zones-list">
                    {zones.map(zone => (
                        <div key={zone.id}
                            className={`dns-zone-item ${selectedZone?.id === zone.id ? 'active' : ''}`}
                            onClick={() => loadRecords(zone.id)}>
                            <div className="dns-zone-item__info">
                                <strong>{zone.domain}</strong>
                                <span className="text-muted">{zone.provider} &bull; {zone.record_count} records</span>
                            </div>
                            <div className="dns-zone-item__actions" onClick={e => e.stopPropagation()}>
                                <Button variant="outline" size="sm" onClick={() => handleCheckPropagation(zone.domain)}>Check</Button>
                                {user?.is_admin && (
                                    <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(zone)}>Delete</Button>
                                )}
                            </div>
                        </div>
                    ))}
                    {zones.length === 0 && <EmptyState icon={Globe} title="No DNS zones configured" />}
                </div>

                {selectedZone && (
                    <div className="dns-records-panel">
                        <div className="dns-records-panel__header">
                            <h2>{selectedZone.domain}</h2>
                            <div className="dns-records-panel__actions">
                                <Button variant="outline" size="sm" onClick={() => handleExport(selectedZone.id)}>Export</Button>
                                {user?.is_admin && (
                                    <Button size="sm" onClick={() => setShowCreateRecord(true)}>Add Record</Button>
                                )}
                            </div>
                        </div>
                        <DataTable
                            tableClassName="sk-dtable dns-records-table"
                            sortable={false}
                            data={records}
                            keyField="id"
                            emptyTitle="No records"
                            emptyMessage="This zone has no DNS records yet."
                            columns={[
                                {
                                    key: 'type',
                                    header: 'Type',
                                    render: (rec) => <span className={`dns-rtype dns-rtype--${(rec.record_type || '').toLowerCase()}`}>{rec.record_type}</span>,
                                },
                                { key: 'name', header: 'Name' },
                                { key: 'content', header: 'Content', render: (rec) => <span className="sk-cell-mono">{rec.content}</span> },
                                { key: 'ttl', header: 'TTL' },
                                { key: 'priority', header: 'Priority', render: (rec) => rec.priority || '-' },
                                {
                                    key: 'actions',
                                    header: '',
                                    render: (rec) => (
                                        user?.is_admin && (
                                            <Button variant="destructive" size="sm" onClick={() => handleDeleteRecord(rec.id)}>Delete</Button>
                                        )
                                    ),
                                },
                            ]}
                        />
                    </div>
                )}
            </div>

            {showCreateZone && (
                <div className="modal-overlay" onClick={() => setShowCreateZone(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add DNS Zone</h2>
                            <button className="modal-close" onClick={() => setShowCreateZone(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <FormField label="Domain" htmlFor="zone-domain">
                                <Input id="zone-domain" value={zoneForm.domain} onChange={e => setZoneForm({...zoneForm, domain: e.target.value})} placeholder="example.com" />
                            </FormField>
                            <FormField label="DNS Provider">
                                <Select
                                    value={zoneForm.dns_provider_config_id || 'manual'}
                                    onValueChange={v => setZoneForm({ ...zoneForm, dns_provider_config_id: v === 'manual' ? '' : v })}
                                >
                                    <SelectTrigger id="zone-provider">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="manual">Manual (no automatic sync)</SelectItem>
                                        {providers.map(p => (
                                            <SelectItem key={p.id} value={String(p.id)}>
                                                {p.name} — {p.provider}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormField>
                            {zoneForm.dns_provider_config_id ? (
                                <p className="text-muted text-sm">
                                    Records added here sync to this connection. We will match{' '}
                                    <strong>{zoneForm.domain || 'your domain'}</strong> to a zone in that
                                    account automatically — no zone ID or token to paste.
                                </p>
                            ) : (
                                <p className="text-muted text-sm">
                                    Manual zones are not pushed to a provider. To sync automatically,{' '}
                                    <a href="/settings?tab=connections">connect a DNS provider</a> first.
                                </p>
                            )}
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowCreateZone(false)}>Cancel</Button>
                            <Button onClick={handleCreateZone} disabled={!zoneForm.domain}>Create</Button>
                        </div>
                    </div>
                </div>
            )}

            {showCreateRecord && (
                <div className="modal-overlay" onClick={() => setShowCreateRecord(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add DNS Record</h2>
                            <button className="modal-close" onClick={() => setShowCreateRecord(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <FormField label="Type">
                                <Select value={recordForm.record_type} onValueChange={v => setRecordForm({...recordForm, record_type: v})}>
                                    <SelectTrigger id="record-type">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {RECORD_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </FormField>
                            <FormField label="Name" htmlFor="record-name">
                                <Input id="record-name" value={recordForm.name} onChange={e => setRecordForm({...recordForm, name: e.target.value})} placeholder="@ or subdomain" />
                            </FormField>
                            <FormField label="Content" htmlFor="record-content">
                                <Input id="record-content" value={recordForm.content} onChange={e => setRecordForm({...recordForm, content: e.target.value})} placeholder="IP address or hostname" />
                            </FormField>
                            <FormRow>
                                <FormField label="TTL" htmlFor="record-ttl">
                                    <Input id="record-ttl" type="number" value={recordForm.ttl} onChange={e => setRecordForm({...recordForm, ttl: parseInt(e.target.value) || 3600})} />
                                </FormField>
                                {(recordForm.record_type === 'MX' || recordForm.record_type === 'SRV') && (
                                    <FormField label="Priority" htmlFor="record-priority">
                                        <Input id="record-priority" type="number" value={recordForm.priority || ''} onChange={e => setRecordForm({...recordForm, priority: parseInt(e.target.value) || null})} />
                                    </FormField>
                                )}
                            </FormRow>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowCreateRecord(false)}>Cancel</Button>
                            <Button onClick={handleCreateRecord} disabled={!recordForm.content}>Create</Button>
                        </div>
                    </div>
                </div>
            )}

            {showPropagation && (
                <div className="modal-overlay" onClick={() => setShowPropagation(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>DNS Propagation: {showPropagation}</h2>
                            <button className="modal-close" onClick={() => setShowPropagation(null)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {propagationResults.map((r, i) => (
                                <div key={i} className="propagation-row">
                                    <span className={`status-dot status-dot--${r.propagated ? 'success' : 'danger'}`} />
                                    <strong>{r.nameserver}</strong>
                                    <span className="text-muted">({r.ip})</span>
                                    <span className="text-mono">{r.result?.join(', ') || 'No result'}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <ConfirmDialog
                    title="Delete Zone"
                    message={`Delete zone "${deleteConfirm.domain}"? All records will be removed.`}
                    onConfirm={() => handleDeleteZone(deleteConfirm.id)}
                    onCancel={() => setDeleteConfirm(null)}
                    variant="danger"
                />
            )}
        </div>
    );
};

export default DNSZones;
