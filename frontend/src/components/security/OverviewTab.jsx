import React, { useState } from 'react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Pill, ScoreGauge } from '@/components/ds';

const InstallClamAVButton = ({ onInstalled }) => {
    const [installing, setInstalling] = useState(false);
    const [error, setError] = useState(null);

    async function handleInstall() {
        setInstalling(true);
        setError(null);
        try {
            await api.installClamAV();
            onInstalled();
        } catch (err) {
            setError(err.message);
        } finally {
            setInstalling(false);
        }
    }

    return (
        <div>
            <Button variant="default" onClick={handleInstall} disabled={installing}>
                {installing ? 'Installing...' : 'Install ClamAV'}
            </Button>
            {error && <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </div>
    );
};

const OverviewTab = ({ status, clamavStatus, clamavLoading, onRefreshClamav }) => {
    const alerts = status?.recent_alerts || {};
    const loading = clamavLoading;
    const integrityChanges = alerts.integrity_changes || 0;
    const integrity = status?.file_integrity || {};

    // Posture checks — real boolean signals already on this tab's props/state.
    // Checks that can't be evaluated yet (ClamAV still loading) stay 'unknown'
    // and are excluded from the score (client-side, mirrors WordPressDetail).
    const checks = [
        {
            label: 'ClamAV antivirus installed',
            state: clamavLoading ? 'unknown' : (clamavStatus?.installed ? 'pass' : 'warn'),
            detail: clamavLoading ? 'checking…' : (clamavStatus?.installed ? 'installed' : 'not installed'),
        },
        {
            label: 'ClamAV service running',
            state: clamavLoading || !clamavStatus?.installed ? 'unknown' : (clamavStatus?.service_running ? 'pass' : 'warn'),
            detail: clamavLoading ? 'checking…' : (!clamavStatus?.installed ? 'n/a' : (clamavStatus?.service_running ? 'running' : 'stopped')),
        },
        {
            label: 'File integrity monitoring enabled',
            state: integrity.enabled ? 'pass' : 'warn',
            detail: integrity.enabled ? 'enabled' : 'disabled',
        },
        {
            label: 'Integrity baseline initialized',
            state: integrity.database_exists ? 'pass' : 'warn',
            detail: integrity.database_exists ? 'initialized' : 'not initialized',
        },
        {
            label: 'No integrity changes (24h)',
            state: integrityChanges > 0 ? 'warn' : 'pass',
            detail: integrityChanges > 0 ? `${integrityChanges} detected` : 'clean',
        },
        {
            label: 'Security alerts configured',
            state: status?.notifications_enabled ? 'pass' : 'warn',
            detail: status?.notifications_enabled ? 'enabled' : 'disabled',
        },
    ];
    const scored = checks.filter((c) => c.state !== 'unknown');
    const score = scored.length
        ? Math.round((scored.filter((c) => c.state === 'pass').length / scored.length) * 100)
        : null;
    const scoreColor = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)';
    const CHECK_PILL = { pass: 'green', warn: 'amber', unknown: 'gray' };

    return (
        <div className="security-overview">
            <div className="card">
                <div className="card-header">
                    <h3>Security Posture</h3>
                </div>
                <div className="card-body sec-posture">
                    {score !== null ? (
                        <ScoreGauge value={score} size={110} stroke={9} color={scoreColor} label="posture" />
                    ) : (
                        <p className="sec-hint sec-hint--lead">Refresh the checks below to compute a posture score.</p>
                    )}
                    <div className="sec-posture__checks">
                        {checks.map((c) => (
                            <div key={c.label} className="sec-posture__check">
                                <span className="sec-posture__label">{c.label}</span>
                                <span className="sec-posture__detail">{c.detail}</span>
                                <Pill kind={CHECK_PILL[c.state]}>{c.state === 'unknown' ? 'pending' : c.state}</Pill>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="security-grid">
                <div className="card">
                    <div className="card-header">
                        <h3>ClamAV Antivirus</h3>
                        <Button variant="outline" size="sm" onClick={onRefreshClamav}>Refresh</Button>
                    </div>
                    <div className="card-body">
                        {loading ? (
                            <div className="loading-sm">Loading...</div>
                        ) : clamavStatus?.installed ? (
                            <div className="sec-rows">
                                <div className="sk-info-row">
                                    <span className="k">Version</span>
                                    <span className="v">{clamavStatus.version || 'Unknown'}</span>
                                </div>
                                <div className="sk-info-row">
                                    <span className="k">Service</span>
                                    <Pill kind={clamavStatus.service_running ? 'green' : 'amber'}>
                                        {clamavStatus.service_running ? 'Running' : 'Stopped'}
                                    </Pill>
                                </div>
                                <div className="sk-info-row">
                                    <span className="k">Last definition update</span>
                                    <span className="v">{clamavStatus.last_update ? new Date(clamavStatus.last_update).toLocaleString() : 'Unknown'}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="not-installed">
                                <p>ClamAV is not installed on this server.</p>
                                <InstallClamAVButton onInstalled={onRefreshClamav} />
                            </div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>File Integrity Monitoring</h3>
                    </div>
                    <div className="card-body">
                        <div className="sec-rows">
                            <div className="sk-info-row">
                                <span className="k">Status</span>
                                <Pill kind={status?.file_integrity?.enabled ? 'green' : 'gray'}>
                                    {status?.file_integrity?.enabled ? 'Enabled' : 'Disabled'}
                                </Pill>
                            </div>
                            <div className="sk-info-row">
                                <span className="k">Database</span>
                                <Pill kind={status?.file_integrity?.database_exists ? 'green' : 'amber'}>
                                    {status?.file_integrity?.database_exists ? 'Initialized' : 'Not Initialized'}
                                </Pill>
                            </div>
                            <div className="sk-info-row">
                                <span className="k">Changes detected (24h)</span>
                                <span className={`v ${integrityChanges > 0 ? 'sec-v-amber' : ''}`}>{integrityChanges}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>Notifications</h3>
                    </div>
                    <div className="card-body">
                        <div className="sec-rows">
                            <div className="sk-info-row">
                                <span className="k">Security alerts</span>
                                <Pill kind={status?.notifications_enabled ? 'green' : 'gray'}>
                                    {status?.notifications_enabled ? 'Enabled' : 'Disabled'}
                                </Pill>
                            </div>
                        </div>
                        <p className="sec-hint">
                            Configure notification channels in Settings → Notifications to receive security alerts via Discord, Slack, or Telegram.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverviewTab;
