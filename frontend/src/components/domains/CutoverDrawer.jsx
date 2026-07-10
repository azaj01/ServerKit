import { useState, useEffect, useCallback } from 'react';
import {
    ArrowRightLeft, ArrowLeft, ArrowRight, Camera, CheckCircle2, RotateCcw,
    AlertTriangle, Globe, RadioTower,
} from 'lucide-react';
import { Drawer, Pill } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import Spinner from '../Spinner';

// Per-domain reversible DNS cutover (plan 31 #5/#6). One shared slide-over,
// reached from the /domains detail drawer and from the Import wizard's final
// step, so the survey → migrate → cutover journey ends in the same place.
//
// Internal stages: target → review (snapshot + TTL guidance + dry-run diff) →
// verify (propagation check + one-click revert). Every write is snapshot-backed
// so it can always be rolled back.
//
//   <CutoverDrawer open={open} onClose={close} domain="example.com"
//                  providerZoneId="abc123" provider="cloudflare"
//                  initialTarget="203.0.113.10" />

const HEAD_ICON_SIZE = 18;
const DRAWER_WIDTH = 720;

// Record types a cutover can repoint. A/AAAA/CNAME cover the "point at the new
// box" case; the operator keeps everything else untouched.
const RECORD_TYPE_CHOICES = ['A', 'AAAA', 'CNAME'];

const STAGES = [
    { id: 'target', label: 'Target' },
    { id: 'review', label: 'Review' },
    { id: 'verify', label: 'Verify' },
];

// The provider guards (NO_PROVIDER / NO_ZONE) come back as 501/400 with a code;
// surface a plain-language line instead of a raw request-failed toast.
function friendlyError(err) {
    const code = err?.data?.code;
    if (code === 'NO_PROVIDER') {
        return 'Connect a DNS provider first — the cutover reads and writes live records through it.';
    }
    if (code === 'NO_ZONE') {
        return 'This domain has no connected provider zone, so its records can\'t be read or repointed.';
    }
    if (code === 'PROVIDER_READ_FAILED') {
        return `Couldn't read the zone's live records: ${err.message}`;
    }
    return err?.message || 'Something went wrong.';
}

const CutoverDrawer = ({ open, onClose, domain, providerZoneId, provider, initialTarget }) => {
    const toast = useToast();

    const [stage, setStage] = useState('target');
    const [target, setTarget] = useState('');
    const [zoneId, setZoneId] = useState('');
    const [recordTypes, setRecordTypes] = useState(['A']);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const [snapshot, setSnapshot] = useState(null);
    const [ttl, setTtl] = useState(null);
    const [plan, setPlan] = useState(null);
    const [cutoverResult, setCutoverResult] = useState(null);
    const [verifyResult, setVerifyResult] = useState(null);
    const [revertResult, setRevertResult] = useState(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    // Re-seed from props each time the drawer is opened, so a previous, possibly
    // abandoned cutover never leaks into the next domain.
    useEffect(() => {
        if (!open) return;
        setStage('target');
        setTarget(initialTarget || '');
        setZoneId(providerZoneId || '');
        setRecordTypes(['A']);
        setBusy(false);
        setError('');
        setSnapshot(null);
        setTtl(null);
        setPlan(null);
        setCutoverResult(null);
        setVerifyResult(null);
        setRevertResult(null);
        setConfirmOpen(false);
    }, [open, initialTarget, providerZoneId]);

    const toggleRecordType = (t) => {
        setRecordTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
    };

    // target → review: snapshot the live records, derive TTL guidance from them,
    // and compute the (provider-free) dry-run diff.
    const captureAndReview = async () => {
        setBusy(true);
        setError('');
        try {
            const snap = await api.snapshotDnsForCutover(domain, zoneId.trim(), provider || null);
            setSnapshot(snap);
            const [guidance, dry] = await Promise.all([
                api.getCutoverTtlGuidance(snap.records || []).catch(() => null),
                api.performDnsCutover(snap.id, target.trim(), { recordTypes, dryRun: true }),
            ]);
            setTtl(guidance);
            setPlan(dry.plan || null);
            setStage('review');
        } catch (err) {
            setError(friendlyError(err));
        } finally {
            setBusy(false);
        }
    };

    // review → verify: perform the real cutover through the guarded write path.
    const applyCutover = async () => {
        if (!snapshot) return;
        setConfirmOpen(false);
        setBusy(true);
        setError('');
        try {
            const res = await api.performDnsCutover(snapshot.id, target.trim(), { recordTypes, dryRun: false });
            setSnapshot(res.snapshot || snapshot);
            setCutoverResult(res.cutover || null);
            setStage('verify');
            if (res.cutover?.success) {
                toast.success(`Cutover applied — ${domain} now points at ${target.trim()}`);
            } else {
                toast.error('Cutover finished with errors — review the results and consider reverting.');
            }
        } catch (err) {
            const message = friendlyError(err);
            setError(message);
            toast.error(message);
        } finally {
            setBusy(false);
        }
    };

    const checkPropagation = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            const primaryType = recordTypes[0] || 'A';
            const res = await api.verifyDnsCutover(domain, {
                recordType: primaryType,
                expected: target.trim(),
                snapshotId: snapshot?.id || null,
            });
            setVerifyResult(res);
        } catch (err) {
            setError(friendlyError(err));
        } finally {
            setBusy(false);
        }
    }, [domain, recordTypes, target, snapshot]);

    const revert = async () => {
        if (!snapshot) return;
        setBusy(true);
        setError('');
        try {
            const res = await api.revertDnsCutover(snapshot.id);
            setSnapshot(res.snapshot || snapshot);
            setRevertResult(res.revert || null);
            if (res.revert?.success) {
                toast.success(`Reverted — restored ${domain}'s pre-cutover records`);
            } else {
                toast.error('Revert finished with errors — check the results.');
            }
        } catch (err) {
            const message = friendlyError(err);
            setError(message);
            toast.error(message);
        } finally {
            setBusy(false);
        }
    };

    const noZone = !zoneId.trim();
    const canCapture = !!target.trim() && !noZone && recordTypes.length > 0;
    const stageIndex = STAGES.findIndex((s) => s.id === stage);

    return (
        <Drawer
            open={open}
            onOpenChange={(v) => !v && onClose()}
            title="DNS cutover"
            subtitle={domain}
            icon={<ArrowRightLeft size={HEAD_ICON_SIZE} />}
            width={DRAWER_WIDTH}
        >
            <div className="cutover">
                <ol className="cutover__stepper">
                    {STAGES.map((s, i) => (
                        <li
                            key={s.id}
                            className={`cutover__step${i === stageIndex ? ' is-active' : ''}${i < stageIndex ? ' is-done' : ''}`}
                        >
                            <span className="cutover__step-dot">
                                {i < stageIndex ? <CheckCircle2 size={13} aria-hidden="true" /> : i + 1}
                            </span>
                            {s.label}
                        </li>
                    ))}
                </ol>

                {error && (
                    <div className="cutover__callout cutover__callout--danger">
                        <AlertTriangle size={16} aria-hidden="true" />
                        <p>{error}</p>
                    </div>
                )}

                {/* Stage 1 — pick the target address + record types */}
                {stage === 'target' && (
                    <div className="cutover__stage">
                        <p className="cutover__lead">
                            Repoint <strong>{domain}</strong> at the box where the imported site now
                            lives. Its current records are snapshotted first, so the switch can always
                            be reverted.
                        </p>

                        <div className="cutover__field">
                            <Label htmlFor="cutover-target">New address (target)</Label>
                            <Input
                                id="cutover-target"
                                value={target}
                                onChange={(e) => setTarget(e.target.value)}
                                placeholder="203.0.113.10"
                                disabled={busy}
                            />
                            <span className="cutover__hint">The IP (or hostname for CNAME) the records should point to.</span>
                        </div>

                        <div className="cutover__field">
                            <Label htmlFor="cutover-zone">Provider zone id</Label>
                            <Input
                                id="cutover-zone"
                                value={zoneId}
                                onChange={(e) => setZoneId(e.target.value)}
                                placeholder="the DNS provider's zone identifier"
                                disabled={busy}
                            />
                            {noZone && (
                                <span className="cutover__hint cutover__hint--warn">
                                    This domain has no connected provider zone — cutover needs one to read and write records.
                                </span>
                            )}
                        </div>

                        <div className="cutover__field">
                            <Label>Record types</Label>
                            <div className="cutover__types">
                                {RECORD_TYPE_CHOICES.map((t) => (
                                    <label key={t} className="cutover__type">
                                        <input
                                            type="checkbox"
                                            checked={recordTypes.includes(t)}
                                            onChange={() => toggleRecordType(t)}
                                            disabled={busy}
                                        />
                                        {t}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="cutover__actions">
                            <span />
                            <Button onClick={captureAndReview} disabled={busy || !canCapture}>
                                {busy ? <><Spinner size="sm" /> Capturing…</> : <><Camera size={14} /> Snapshot &amp; preview <ArrowRight size={14} /></>}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Stage 2 — snapshot summary, TTL guidance, dry-run diff */}
                {stage === 'review' && (
                    <div className="cutover__stage">
                        <div className="cutover__summary">
                            <div className="cutover__stat">
                                <span className="cutover__stat-val">{snapshot?.record_count ?? 0}</span>
                                <span className="cutover__stat-label">records captured</span>
                            </div>
                            <div className="cutover__stat">
                                <span className="cutover__stat-val">{target.trim()}</span>
                                <span className="cutover__stat-label">new target</span>
                            </div>
                            <div className="cutover__stat">
                                <span className="cutover__stat-val">{recordTypes.join(', ')}</span>
                                <span className="cutover__stat-label">record types</span>
                            </div>
                        </div>

                        {ttl && (
                            <div className={`cutover__callout${ttl.needs_lowering ? ' cutover__callout--warning' : ' cutover__callout--info'}`}>
                                <RadioTower size={16} aria-hidden="true" />
                                <p>{ttl.message}</p>
                            </div>
                        )}

                        <section className="cutover__section">
                            <h3><Globe size={15} aria-hidden="true" /> Planned changes</h3>
                            {plan?.ops?.length ? (
                                <div className="cutover__table-wrap">
                                    <table className="cutover__table">
                                        <thead>
                                            <tr><th>Type</th><th>Name</th><th>Action</th><th>Current</th><th>New</th></tr>
                                        </thead>
                                        <tbody>
                                            {plan.ops.map((op, i) => (
                                                <tr key={`${op.record_type}-${op.name}-${i}`}>
                                                    <td>{op.record_type}</td>
                                                    <td>{op.name}</td>
                                                    <td>
                                                        <Pill kind={op.action === 'create' ? 'cyan' : 'amber'}>{op.action}</Pill>
                                                    </td>
                                                    <td><code>{op.old_content || '—'}</code></td>
                                                    <td><code>{op.new_content}</code></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="cutover__muted">No changes to apply for the selected record types.</p>
                            )}
                        </section>

                        <div className="cutover__actions">
                            <Button variant="outline" onClick={() => setStage('target')} disabled={busy}>
                                <ArrowLeft size={14} /> Back
                            </Button>
                            <Button onClick={() => setConfirmOpen(true)} disabled={busy || !plan?.ops?.length}>
                                {busy ? <><Spinner size="sm" /> Applying…</> : <><ArrowRightLeft size={14} /> Apply cutover</>}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Stage 3 — cutover result, verify, revert */}
                {stage === 'verify' && (
                    <div className="cutover__stage">
                        {cutoverResult && (
                            <div className={`cutover__callout${cutoverResult.success ? ' cutover__callout--success' : ' cutover__callout--danger'}`}>
                                {cutoverResult.success
                                    ? <CheckCircle2 size={16} aria-hidden="true" />
                                    : <AlertTriangle size={16} aria-hidden="true" />}
                                <p>
                                    {cutoverResult.success
                                        ? <>Cutover applied — <strong>{domain}</strong> now points at <code>{target.trim()}</code>.</>
                                        : <>Cutover finished with errors. Review below and revert if needed.</>}
                                </p>
                            </div>
                        )}

                        <section className="cutover__section">
                            <h3><RadioTower size={15} aria-hidden="true" /> Propagation</h3>
                            <p className="cutover__muted">
                                Public resolvers cache the old address until their TTL expires. Check where the new
                                address has taken effect.
                            </p>

                            {verifyResult && (
                                <div className="cutover__verify-head">
                                    {verifyResult.matches_expected != null && (
                                        <Pill kind={verifyResult.matches_expected ? 'green' : 'amber'}>
                                            {verifyResult.matches_expected ? 'Matches new target' : 'Not fully propagated'}
                                        </Pill>
                                    )}
                                    <Pill kind={verifyResult.propagated ? 'green' : 'gray'}>
                                        {verifyResult.propagated ? 'Propagated' : 'Propagating'}
                                    </Pill>
                                </div>
                            )}

                            {verifyResult?.resolvers?.length > 0 && (
                                <div className="cutover__table-wrap">
                                    <table className="cutover__table">
                                        <thead>
                                            <tr><th>Resolver</th><th>Answer</th><th>Status</th></tr>
                                        </thead>
                                        <tbody>
                                            {verifyResult.resolvers.map((r, i) => (
                                                <tr key={`${r.nameserver}-${i}`}>
                                                    <td>{r.nameserver}</td>
                                                    <td><code>{(r.result || []).join(', ') || '—'}</code></td>
                                                    <td>
                                                        <Pill kind={r.propagated ? 'green' : 'gray'}>
                                                            {r.propagated ? 'live' : 'stale'}
                                                        </Pill>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <Button variant="outline" size="sm" onClick={checkPropagation} disabled={busy}>
                                {busy ? <><Spinner size="sm" /> Checking…</> : <><RadioTower size={14} /> Check propagation</>}
                            </Button>
                        </section>

                        <section className="cutover__section cutover__section--revert">
                            <h3><RotateCcw size={15} aria-hidden="true" /> Roll back</h3>
                            {revertResult ? (
                                <div className={`cutover__callout${revertResult.success ? ' cutover__callout--success' : ' cutover__callout--danger'}`}>
                                    {revertResult.success
                                        ? <CheckCircle2 size={16} aria-hidden="true" />
                                        : <AlertTriangle size={16} aria-hidden="true" />}
                                    <p>
                                        Restored {revertResult.results?.length ?? 0} record{(revertResult.results?.length ?? 0) === 1 ? '' : 's'}
                                        {revertResult.deleted_count ? `, deleted ${revertResult.deleted_count} created record${revertResult.deleted_count === 1 ? '' : 's'}` : ''}.
                                    </p>
                                </div>
                            ) : (
                                <p className="cutover__muted">
                                    One click restores the snapshot captured before this cutover — including deleting any
                                    records the cutover created.
                                </p>
                            )}
                            <Button variant="outline" size="sm" onClick={revert} disabled={busy || !!revertResult}>
                                {busy ? <><Spinner size="sm" /> Reverting…</> : <><RotateCcw size={14} /> Revert cutover</>}
                            </Button>
                        </section>

                        <div className="cutover__actions">
                            <span />
                            <Button variant="outline" onClick={onClose} disabled={busy}>Done</Button>
                        </div>
                    </div>
                )}

                <ConfirmDialog
                    isOpen={confirmOpen}
                    title="Apply DNS cutover?"
                    message={`This repoints ${recordTypes.join(', ')} record(s) for ${domain} at ${target.trim()}. The snapshot lets you revert.`}
                    confirmText="Apply cutover"
                    variant="danger"
                    onConfirm={applyCutover}
                    onCancel={() => setConfirmOpen(false)}
                />
            </div>
        </Drawer>
    );
};

export default CutoverDrawer;
