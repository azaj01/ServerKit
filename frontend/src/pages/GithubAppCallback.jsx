import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Github, Loader2 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

// Lands here after the operator confirms the one-click GitHub App on github.com.
// We convert the returned manifest code into stored app credentials, then chain
// straight into the connect flow (install + authorize) so the whole thing is a
// single hop for the user.
const GithubAppCallback = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();
    const [error, setError] = useState('');
    const didRun = useRef(false);

    useEffect(() => {
        if (didRun.current) return;
        didRun.current = true;

        async function run() {
            const code = searchParams.get('code');
            const state = searchParams.get('state');
            if (!code || !state) {
                setError('GitHub did not return a valid app-manifest response.');
                return;
            }
            try {
                const result = await api.completeGithubAppManifest(code, state);
                toast.success(`GitHub App "${result.name || result.slug}" created`);
                // Chain into connect: this points at the app install screen, which
                // grants repo access and authorizes in one hop.
                try {
                    const redirectUri = `${window.location.origin}/connections/callback/github`;
                    sessionStorage.setItem('sourceConnectionReturnTo', '/settings/connections');
                    const { auth_url } = await api.startSourceConnection('github', redirectUri);
                    window.location.href = auth_url;
                } catch {
                    // Credentials are saved; just send them back to finish manually.
                    navigate('/settings/connections', { replace: true });
                }
            } catch (err) {
                setError(err.message || 'Failed to finish GitHub App setup.');
            }
        }
        run();
    }, [navigate, searchParams, toast]);

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-logo">
                    <Github size={32} />
                </div>
                <h1>Setting up GitHub</h1>
                {error ? (
                    <>
                        <p className="auth-error">{error}</p>
                        <button type="button" className="btn btn-primary" onClick={() => navigate('/settings/connections')}>
                            Back to Connections
                        </button>
                    </>
                ) : (
                    <div className="sso-loading">
                        <Loader2 size={24} className="spinning" />
                        <p>Creating your GitHub App and connecting…</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GithubAppCallback;
