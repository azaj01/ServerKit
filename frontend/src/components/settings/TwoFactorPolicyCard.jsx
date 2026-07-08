import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';

// Admin control for the require-2FA policy (plan 22 #14). A policy, never a
// default: 'off' (nobody forced), 'admins', or 'all'. Within the grace window a
// user still logs in with a password + a nudge; past it, login yields an
// enrollment-scoped token until they add a passkey or authenticator app.
// SSO-authenticated users are always exempt (the IdP owns their second factor).

const POLICY_LABELS = {
    off: 'Off — nobody is forced to enrol',
    admins: 'Admins — admin accounts must enrol',
    all: 'Everyone — all accounts must enrol',
};

const TwoFactorPolicyCard = () => {
    const [policy, setPolicy] = useState('off');
    const [graceDays, setGraceDays] = useState(7);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        api.getSystemSettings()
            .then((data) => {
                setPolicy(data.security_require_2fa || 'off');
                if (data.security_require_2fa_grace_days != null) {
                    setGraceDays(data.security_require_2fa_grace_days);
                }
            })
            .catch(() => { /* leave defaults */ })
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateSystemSettings({
                security_require_2fa: policy,
                security_require_2fa_grace_days: Number(graceDays) || 0,
            });
            setMessage({ type: 'success', text: 'Two-factor policy saved.' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to save policy' });
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(null), 6000);
        }
    }

    if (loading) return null;

    return (
        <div className="settings-card">
            <h3>Two-Factor Authentication Policy</h3>
            <p className="form-help" style={{ marginTop: 0 }}>
                Require accounts to protect themselves with a passkey or authenticator
                app. Passwords keep working until the grace window ends; after that,
                sign-in only lets the user reach the enrolment screen until they add a
                second factor. Single sign-on users are always exempt.
            </p>

            <div className="form-group">
                <label>Who must enrol</label>
                <Select value={policy} onValueChange={setPolicy}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.entries(POLICY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {policy !== 'off' && (
                <div className="form-group">
                    <label>Grace period (days)</label>
                    <Input
                        type="number"
                        min="0"
                        value={graceDays}
                        onChange={(e) => setGraceDays(e.target.value)}
                        style={{ maxWidth: '120px' }}
                    />
                    <span className="form-help">
                        Days a newly-covered account may keep signing in with just a
                        password before enrolment is enforced.
                    </span>
                </div>
            )}

            <div className="form-actions">
                <Button variant="default" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save policy'}
                </Button>
                {message && (
                    <span className={`timezone-message ${message.type}`} style={{ marginLeft: '0.75rem' }}>
                        {message.text}
                    </span>
                )}
            </div>
        </div>
    );
};

export default TwoFactorPolicyCard;
