import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Undo2, Wand2 } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';

// Curated config tuner: a small set of vetted engine settings with RAM-aware
// suggested values. Shows current vs suggested; the operator picks which
// settings to apply — nothing is ever applied automatically. Applying writes
// a ServerKit-owned config drop-in and restarts the DB container; a backup of
// the previous config is kept so it can be rolled back cleanly.
//
// Props:
//   target   — Docker container name (or managed database id as a string)
//   engine   — 'mysql' | 'mariadb' | 'postgresql' (optional for managed ids)
//   user     — DB admin user (optional)
//   password — DB admin password, sent via X-DB-Password (optional)
export default function ConfigTunerPanel({ target, engine, user, password }) {
    const toast = useToast();
    const { confirm } = useConfirm();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [dedicated, setDedicated] = useState(false);
    const [selected, setSelected] = useState({});   // key -> bool
    const [values, setValues] = useState({});       // key -> edited target value

    const load = useCallback(async (isDedicated) => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.inspectDbTuner(target, {
                engine, user, password, dedicated: isDedicated,
            });
            setData(res);
            const next = {};
            (res?.settings || []).forEach((s) => { next[s.key] = s.suggested; });
            setValues(next);
            setSelected({});
        } catch (err) {
            setError(err.message || 'Failed to inspect the database configuration');
        } finally {
            setLoading(false);
        }
    }, [target, engine, user, password]);

    useEffect(() => { load(dedicated); }, [load, dedicated]);

    function clampValue(setting, raw) {
        const num = Number(raw);
        if (Number.isNaN(num)) return setting.suggested;
        return Math.min(setting.max, Math.max(setting.min, num));
    }

    function setValue(key, raw) {
        setValues((prev) => ({ ...prev, [key]: raw }));
    }

    function commitValue(setting) {
        setValues((prev) => ({ ...prev, [setting.key]: clampValue(setting, prev[setting.key]) }));
    }

    function toggle(key) {
        setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
    }

    const selectedKeys = Object.keys(selected).filter((k) => selected[k]);

    async function applySelected() {
        if (!selectedKeys.length) return;
        const ok = await confirm({
            title: `Apply ${selectedKeys.length} setting${selectedKeys.length === 1 ? '' : 's'}?`,
            message: 'Applying restarts the database engine — connected apps will see a short '
                + 'interruption. The previous configuration is backed up and can be rolled back.',
            confirmText: 'Apply and restart',
            danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
            const settings = {};
            selectedKeys.forEach((k) => {
                const setting = data.settings.find((s) => s.key === k);
                settings[k] = clampValue(setting, values[k]);
            });
            await api.applyDbTunerSettings(target, settings, { engine, user, password });
            toast.success('Settings applied and engine restarted');
            await load(dedicated);
        } catch (err) {
            toast.error(err.message || 'Failed to apply settings');
        } finally {
            setBusy(false);
        }
    }

    async function rollback() {
        const ok = await confirm({
            title: 'Roll back to the previous configuration?',
            message: 'The last backed-up configuration is restored and the database engine '
                + 'is restarted.',
            confirmText: 'Roll back and restart',
            danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
            await api.rollbackDbTuner(target, { engine, user, password });
            toast.success('Previous configuration restored');
            await load(dedicated);
        } catch (err) {
            toast.error(err.message || 'Rollback failed');
        } finally {
            setBusy(false);
        }
    }

    if (loading) return <p className="db-tuner__hint">Reading engine configuration…</p>;
    if (error) return <p className="db-tuner__error">{error}</p>;
    if (!data) return null;

    return (
        <div className="db-tuner">
            <div className="db-tuner__head">
                <p className="db-tuner__hint">
                    Suggestions are based on {data.ram_mb} MB of RAM
                    ({data.ram_source === 'container_limit' ? 'container memory limit' : 'host total'}).
                    Nothing is applied until you choose to.
                </p>
                <label className="db-tuner__dedicated">
                    <input
                        type="checkbox"
                        checked={dedicated}
                        onChange={(e) => setDedicated(e.target.checked)}
                    />
                    Dedicated DB server
                </label>
                <Button type="button" size="sm" variant="ghost" onClick={() => load(dedicated)} aria-label="Refresh">
                    <RefreshCw size={14} /> Refresh
                </Button>
            </div>

            <div className="db-tuner__table-wrap">
                <table className="db-tuner__table">
                    <thead>
                        <tr>
                            <th aria-label="Select" />
                            <th>Setting</th>
                            <th>Current</th>
                            <th>Suggested</th>
                            <th>Target value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.settings.map((s) => (
                            <tr key={s.key} className={s.differs ? 'is-diff' : ''}>
                                <td>
                                    <input
                                        type="checkbox"
                                        checked={!!selected[s.key]}
                                        onChange={() => toggle(s.key)}
                                        aria-label={`Select ${s.key}`}
                                    />
                                </td>
                                <td>
                                    <span className="db-tuner__key">{s.key}</span>
                                    <span className="db-tuner__desc">{s.description}</span>
                                </td>
                                <td className="db-tuner__num">
                                    {s.current != null ? `${s.current} ${s.unit}` : '—'}
                                </td>
                                <td className={`db-tuner__num${s.differs ? ' db-tuner__num--suggest' : ''}`}>
                                    {s.suggested} {s.unit}
                                </td>
                                <td>
                                    <input
                                        className="db-tuner__input"
                                        type="number"
                                        min={s.min}
                                        max={s.max}
                                        step="any"
                                        value={values[s.key] ?? ''}
                                        onChange={(e) => setValue(s.key, e.target.value)}
                                        onBlur={() => commitValue(s)}
                                        aria-label={`Target value for ${s.key}`}
                                    />
                                    <span className="db-tuner__range">{s.min}–{s.max} {s.unit}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="db-tuner__actions">
                <Button
                    type="button"
                    disabled={busy || selectedKeys.length === 0}
                    onClick={applySelected}
                >
                    <Wand2 size={14} /> Apply selected ({selectedKeys.length})
                </Button>
                {data.can_rollback && (
                    <Button type="button" variant="outline" disabled={busy} onClick={rollback}>
                        <Undo2 size={14} /> Roll back last apply
                    </Button>
                )}
            </div>
        </div>
    );
}
