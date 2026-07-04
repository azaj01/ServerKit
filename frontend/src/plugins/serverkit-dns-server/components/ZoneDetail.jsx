import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Plus, ShieldCheck, X } from 'lucide-react';
import api from '@/services/api';
import { Pill } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR'];
const EMPTY_FORM = { name: '', type: 'A', ttl: 3600, records: '' };

const ZoneDetail = ({ zoneName, onClose, onChanged }) => {
    const toast = useToast();

    const [zone, setZone] = useState(null);
    const [dsRecords, setDsRecords] = useState([]);
    const [delegation, setDelegation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);

    // Record editor modal (add or edit — edit pre-fills, save is an upsert)
    const [showRecordModal, setShowRecordModal] = useState(false);
    const [recordForm, setRecordForm] = useState(EMPTY_FORM);

    const loadZone = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.request(`/dns-server/zones/${encodeURIComponent(zoneName)}`);
            setZone(data.zone || null);
            setDsRecords(data.ds_records || []);
            setDelegation(data.delegation || null);
        } catch (error) {
            toast.error(`Failed to load zone: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [zoneName, toast]);

    useEffect(() => {
        loadZone();
    }, [loadZone]);

    const openAdd = () => {
        setRecordForm(EMPTY_FORM);
        setShowRecordModal(true);
    };

    const openEdit = (rrset) => {
        setRecordForm({
            name: rrset.name,
            type: rrset.type,
            ttl: rrset.ttl ?? 3600,
            records: (rrset.records || []).join('\n'),
        });
        setShowRecordModal(true);
    };

    const handleSaveRecord = async () => {
        const values = recordForm.records.split('\n').map((v) => v.trim()).filter(Boolean);
        if (!values.length) return;
        setActionLoading(true);
        try {
            await api.request(`/dns-server/zones/${encodeURIComponent(zoneName)}/rrsets`, {
                method: 'POST',
                body: {
                    name: recordForm.name.trim(),
                    type: recordForm.type,
                    ttl: Number(recordForm.ttl) || 3600,
                    records: values,
                },
            });
            toast.success(`${recordForm.type} record set saved`);
            setShowRecordModal(false);
            await loadZone();
            onChanged?.();
        } catch (error) {
            toast.error(`Failed to save record set: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteRecord = (rrset) => {
        setConfirmDialog({
            title: 'Delete record set',
            message: `Delete the ${rrset.type} record set for ${rrset.name}?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    const qs = `name=${encodeURIComponent(rrset.name)}&type=${encodeURIComponent(rrset.type)}`;
                    await api.request(
                        `/dns-server/zones/${encodeURIComponent(zoneName)}/rrsets?${qs}`,
                        { method: 'DELETE' }
                    );
                    toast.success(`${rrset.type} record set deleted`);
                    await loadZone();
                    onChanged?.();
                } catch (error) {
                    toast.error(`Failed to delete record set: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleDnssec = async (enable) => {
        setActionLoading(true);
        try {
            const res = await api.request(`/dns-server/zones/${encodeURIComponent(zoneName)}/dnssec`, {
                method: 'POST',
                body: { action: enable ? 'enable' : 'disable' },
            });
            toast.success(res.message || `DNSSEC ${enable ? 'enabled' : 'disabled'}`);
            await loadZone();
            onChanged?.();
        } catch (error) {
            toast.error(`DNSSEC update failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="card dns-zone-detail">
            <div className="card-header">
                <h3 className="sk-cell-mono">{zoneName}</h3>
                <div className="card-actions">
                    <Button variant="default" size="sm" onClick={openAdd}>
                        <Plus size={14} /> Add Record
                    </Button>
                    <Button variant="outline" size="sm" onClick={loadZone}>
                        <RefreshCw size={14} /> Refresh
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        <X size={14} /> Close
                    </Button>
                </div>
            </div>
            <div className="card-body">
                {loading ? (
                    <p className="text-muted">Loading zone...</p>
                ) : !zone ? (
                    <p className="text-muted">Zone could not be loaded.</p>
                ) : (
                    <>
                        {/* ── Delegation banner ── */}
                        {delegation && (
                            <div
                                className={`dns-delegation dns-delegation--${
                                    delegation.checked === false ? 'unknown' : delegation.delegated ? 'ok' : 'warn'
                                }`}
                            >
                                {delegation.checked === false ? (
                                    <span>Delegation check unavailable: {delegation.note}</span>
                                ) : delegation.delegated ? (
                                    <span>
                                        Delegation looks correct — the public NS set matches this
                                        zone ({(delegation.public_ns || []).join(', ')}).
                                    </span>
                                ) : (
                                    <span>
                                        {delegation.note}{' '}
                                        {delegation.public_ns?.length > 0 && (
                                            <>Public: {delegation.public_ns.join(', ')} · Zone:{' '}
                                            {(delegation.zone_ns || []).join(', ') || 'none'}</>
                                        )}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* ── Records ── */}
                        <table className="sk-dtable">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th>TTL</th>
                                    <th>Values</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(zone.rrsets || []).map((r) => (
                                    <tr key={`${r.name}|${r.type}`}>
                                        <td className="sk-cell-mono">{r.name}</td>
                                        <td><span className="sk-tag">{r.type}</span></td>
                                        <td>{r.ttl ?? '—'}</td>
                                        <td className="sk-cell-mono dns-values">
                                            {(r.records || []).map((v) => <div key={v}>{v}</div>)}
                                        </td>
                                        <td>
                                            <Button variant="secondary" size="sm" onClick={() => openEdit(r)}>
                                                Edit
                                            </Button>{' '}
                                            {r.type !== 'SOA' && (
                                                <Button variant="secondary" size="sm" onClick={() => handleDeleteRecord(r)}>
                                                    Delete
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* ── DNSSEC ── */}
                        <div className="dns-dnssec">
                            <div className="dns-dnssec__head">
                                <h4><ShieldCheck size={16} /> DNSSEC</h4>
                                <Pill kind={zone.dnssec ? 'green' : 'gray'}>
                                    {zone.dnssec ? 'Enabled' : 'Disabled'}
                                </Pill>
                                <Button
                                    variant={zone.dnssec ? 'secondary' : 'default'}
                                    size="sm"
                                    disabled={actionLoading}
                                    onClick={() => handleDnssec(!zone.dnssec)}
                                >
                                    {zone.dnssec ? 'Disable' : 'Enable'}
                                </Button>
                            </div>
                            {zone.dnssec && (
                                dsRecords.length > 0 ? (
                                    <div className="dns-ds">
                                        <p className="text-muted">
                                            Publish these DS records at your registrar (the parent
                                            zone) to complete the chain of trust:
                                        </p>
                                        {dsRecords.map((ds) => (
                                            <code key={ds} className="dns-ds__record">{ds}</code>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-muted">
                                        DNSSEC is enabled but no DS records were returned yet —
                                        refresh in a moment.
                                    </p>
                                )
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* ── Record editor ── */}
            <Modal
                open={showRecordModal}
                onClose={() => setShowRecordModal(false)}
                title={`${recordForm.name ? 'Edit' : 'Add'} Record Set`}
            >
                <div className="form-group">
                    <Label>Name</Label>
                    <Input
                        type="text"
                        value={recordForm.name}
                        onChange={(e) => setRecordForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder={`@ or www (relative to ${zoneName})`}
                    />
                </div>
                <div className="form-group">
                    <Label>Type</Label>
                    <Select
                        value={recordForm.type}
                        onValueChange={(v) => setRecordForm((f) => ({ ...f, type: v }))}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {RECORD_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="form-group">
                    <Label>TTL (seconds)</Label>
                    <Input
                        type="number"
                        min={1}
                        max={604800}
                        value={recordForm.ttl}
                        onChange={(e) => setRecordForm((f) => ({ ...f, ttl: e.target.value }))}
                    />
                </div>
                <div className="form-group">
                    <Label>Values (one per line)</Label>
                    <textarea
                        className="dns-record-values"
                        rows={4}
                        value={recordForm.records}
                        onChange={(e) => setRecordForm((f) => ({ ...f, records: e.target.value }))}
                        placeholder={'203.0.113.7\n203.0.113.8'}
                    />
                    <p className="text-muted">
                        Saving replaces the whole record set for this name + type.
                    </p>
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowRecordModal(false)}>Cancel</Button>
                    <Button
                        variant="default"
                        onClick={handleSaveRecord}
                        disabled={actionLoading || !recordForm.records.trim()}
                    >
                        {actionLoading ? 'Saving...' : 'Save Record Set'}
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

export default ZoneDetail;
