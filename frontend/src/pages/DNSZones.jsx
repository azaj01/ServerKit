import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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

    const [zoneForm, setZoneForm] = useState({ domain: '', provider: 'manual', provider_zone_id: '', api_token: '' });
    const [recordForm, setRecordForm] = useState({
        record_type: 'A', name: '@', content: '', ttl: 3600, priority: null
    });

    const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'];

    const PROVIDER_CONFIG = {
        cloudflare: {
            zoneLabel: 'Cloudflare Zone ID',
            zonePlaceholder: 'e.g. 023e105f4ecef8ad9ca31a8372d0c353',
            tokenLabel: 'API Token',
            tokenPlaceholder: 'Cloudflare API token (Edit zone permissions)',
            helpText: 'Find your Zone ID in the Cloudflare dashboard under Overview → API.',
        },
        route53: {
            zoneLabel: 'Hosted Zone ID',
            zonePlaceholder: 'e.g. Z3M3LMPEXAMPLE',
            tokenLabel: 'AWS Access Key',
            tokenPlaceholder: 'AKIA... (needs Route 53 permissions)',
            helpText: 'Use an IAM user with AmazonRoute53FullAccess policy.',
            extraFields: [
                { key: 'aws_secret_key', label: 'AWS Secret Key', placeholder: 'Secret access key', type: 'password' },
                { key: 'aws_region', label: 'AWS Region', placeholder: 'us-east-1', type: 'text' },
            ],
        },
        digitalocean: {
            zoneLabel: 'Domain Name',
            zonePlaceholder: 'e.g. example.com (must exist in your DO account)',
            tokenLabel: 'Personal Access Token',
            tokenPlaceholder: 'DigitalOcean personal access token',
            helpText: 'Generate a token at API → Tokens with read+write scope.',
        },
    };

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
            const payload = {
                domain: zoneForm.domain,
                provider: zoneForm.provider,
            };
            if (zoneForm.provider !== 'manual') {
                payload.provider_zone_id = zoneForm.provider_zone_id;
                payload.provider_config = { api_token: zoneForm.api_token };
            }
            await api.createDNSZone(payload);
            toast.success('Zone created');
            setShowCreateZone(false);
            setZoneForm({ domain: '', provider: 'manual', provider_zone_id: '', api_token: '' });
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

    if (loading) return <Spinner />;

    return (
        <div className="page-container dns-zones-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>DNS Zones</h1>
                    <p className="page-description">{zones.length} zone{zones.length !== 1 ? 's' : ''} configured</p>
                </div>
                <div className="page-header-actions">
                    {user?.is_admin && (
                        <Button onClick={() => setShowCreateZone(true)}>Add Zone</Button>
                    )}
                </div>
            </div>

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
                    {zones.length === 0 && <div className="empty-state"><p>No DNS zones configured.</p></div>}
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
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Name</th>
                                    <th>Content</th>
                                    <th>TTL</th>
                                    <th>Priority</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {records.map(rec => (
                                    <tr key={rec.id}>
                                        <td><Badge variant="outline">{rec.record_type}</Badge></td>
                                        <td>{rec.name}</td>
                                        <td className="text-mono">{rec.content}</td>
                                        <td>{rec.ttl}</td>
                                        <td>{rec.priority || '-'}</td>
                                        <td>
                                            {user?.is_admin && (
                                                <Button variant="destructive" size="sm" onClick={() => handleDeleteRecord(rec.id)}>Delete</Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {records.length === 0 && (
                                    <tr><td colSpan={6} className="text-center text-muted">No records</td></tr>
                                )}
                            </tbody>
                        </table>
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
                            <div className="form-group">
                                <Label>Domain</Label>
                                <Input value={zoneForm.domain} onChange={e => setZoneForm({...zoneForm, domain: e.target.value})} placeholder="example.com" />
                            </div>
                            <div className="form-group">
                                <Label>Provider</Label>
                                <Select value={zoneForm.provider} onValueChange={v => setZoneForm({...zoneForm, provider: v})}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="manual">Manual</SelectItem>
                                        <SelectItem value="cloudflare">Cloudflare</SelectItem>
                                        <SelectItem value="route53">Route 53 (AWS)</SelectItem>
                                        <SelectItem value="digitalocean">DigitalOcean</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {zoneForm.provider !== 'manual' && (() => {
                                const cfg = PROVIDER_CONFIG[zoneForm.provider];
                                return (
                                    <>
                                        {cfg.helpText && (
                                            <p className="text-muted text-sm">{cfg.helpText}</p>
                                        )}
                                        <div className="form-group">
                                            <Label>{cfg.zoneLabel}</Label>
                                            <Input value={zoneForm.provider_zone_id} onChange={e => setZoneForm({...zoneForm, provider_zone_id: e.target.value})} placeholder={cfg.zonePlaceholder} />
                                        </div>
                                        <div className="form-group">
                                            <Label>{cfg.tokenLabel}</Label>
                                            <Input type="password" value={zoneForm.api_token} onChange={e => setZoneForm({...zoneForm, api_token: e.target.value})} placeholder={cfg.tokenPlaceholder} />
                                        </div>
                                        {cfg.extraFields?.map(field => (
                                            <div className="form-group" key={field.key}>
                                                <Label>{field.label}</Label>
                                                <Input type={field.type} value={zoneForm[field.key] || ''} onChange={e => setZoneForm({...zoneForm, [field.key]: e.target.value})} placeholder={field.placeholder} />
                                            </div>
                                        ))}
                                    </>
                                );
                            })()}
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
                            <div className="form-group">
                                <Label>Type</Label>
                                <Select value={recordForm.record_type} onValueChange={v => setRecordForm({...recordForm, record_type: v})}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {RECORD_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="form-group">
                                <Label>Name</Label>
                                <Input value={recordForm.name} onChange={e => setRecordForm({...recordForm, name: e.target.value})} placeholder="@ or subdomain" />
                            </div>
                            <div className="form-group">
                                <Label>Content</Label>
                                <Input value={recordForm.content} onChange={e => setRecordForm({...recordForm, content: e.target.value})} placeholder="IP address or hostname" />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <Label>TTL</Label>
                                    <Input type="number" value={recordForm.ttl} onChange={e => setRecordForm({...recordForm, ttl: parseInt(e.target.value) || 3600})} />
                                </div>
                                {(recordForm.record_type === 'MX' || recordForm.record_type === 'SRV') && (
                                    <div className="form-group">
                                        <Label>Priority</Label>
                                        <Input type="number" value={recordForm.priority || ''} onChange={e => setRecordForm({...recordForm, priority: parseInt(e.target.value) || null})} />
                                    </div>
                                )}
                            </div>
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
