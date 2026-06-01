"""Per-site WordPress security depth (#30): file-integrity verification,
WP_DEBUG/SCRIPT_DEBUG toggling, and WP-Cron management — all via the Docker-aware
WP-CLI bridge (WordPressService.wp_cli), so containerized sites work.

Integrity runs in a background thread (verify-checksums fetches from wordpress.org
and can be slow) so the single worker never blocks; debug/cron are quick.

Deferred (needs infra absent in the Docker-localhost model): a per-site
wp-login/xmlrpc brute-force rate-limit jail (Fail2ban / nginx limit_req). Managed
sites are localhost:PORT apache containers with no host-side per-site access log
for a jail to watch; revisit once a per-site reverse-proxy/log layer exists.
"""

import json
import logging
import threading
from datetime import datetime

logger = logging.getLogger(__name__)


class WpSecurityService:
    # In-memory latest integrity result per site (point-in-time, like the Lynis scan).
    _integrity = {}
    _integrity_lock = threading.Lock()

    # ---------- file integrity (background) ----------

    @classmethod
    def get_integrity(cls, site_id):
        with cls._integrity_lock:
            return dict(cls._integrity.get(site_id, {'status': 'idle'}))

    @classmethod
    def start_integrity_scan(cls, site):
        from flask import current_app
        with cls._integrity_lock:
            if cls._integrity.get(site.id, {}).get('status') == 'running':
                return {'success': True, 'status': 'running'}
            cls._integrity[site.id] = {'status': 'running'}
        app = current_app._get_current_object()
        path = site.application.root_path if site.application else None
        threading.Thread(
            target=cls._run_integrity, args=(app, site.id, path), daemon=True,
            name=f'wp-integrity-{site.id}'
        ).start()
        return {'success': True, 'status': 'running'}

    @classmethod
    def _run_integrity(cls, app, site_id, path):
        with app.app_context():
            from app.services.wordpress_service import WordPressService
            try:
                if not path:
                    raise RuntimeError('Site has no root path')
                core = WordPressService.wp_cli(path, ['core', 'verify-checksums'])
                plug = WordPressService.wp_cli(path, ['plugin', 'verify-checksums', '--all'])
                issues = cls._parse_checksum_issues(core) + cls._parse_checksum_issues(plug)
                result = {
                    'status': 'completed',
                    'core_ok': bool(core.get('success')),
                    'plugins_ok': bool(plug.get('success')),
                    'issues': issues,
                    'checked_at': datetime.utcnow().isoformat(),
                    'error': None,
                }
            except Exception as e:
                logger.error(f'Integrity scan failed for site {site_id}: {e}')
                result = {'status': 'error', 'error': str(e), 'issues': [],
                          'checked_at': datetime.utcnow().isoformat()}
            with cls._integrity_lock:
                cls._integrity[site_id] = result

    @staticmethod
    def _parse_checksum_issues(res):
        """Extract the Warning/Error lines verify-checksums emits for modified or
        unexpected files. A clean install emits only a 'Success:' line (no issues)."""
        issues = []
        text = (res.get('output') or '') + '\n' + (res.get('error') or '')
        for line in text.splitlines():
            s = line.strip()
            if s.startswith('Warning:') or s.startswith('Error:'):
                issues.append(s.split(':', 1)[1].strip())
        return issues

    # ---------- WP_DEBUG / SCRIPT_DEBUG ----------

    # Log OUTSIDE the web root: the default wp-content/debug.log is served by
    # apache (a public info leak), whereas /tmp is container-writable and never
    # web-accessible. (Ephemeral across container restarts, which is fine for a
    # debug log.)
    DEBUG_LOG_PATH = '/tmp/wp-debug.log'

    @classmethod
    def get_debug(cls, path):
        from app.services.wordpress_service import WordPressService

        def _val(k):
            res = WordPressService.wp_cli(path, ['config', 'get', k])
            return (res.get('output') or '').strip() if res.get('success') else ''

        log_raw = _val('WP_DEBUG_LOG').lower()
        state = {
            'WP_DEBUG': _val('WP_DEBUG').lower() in ('1', 'true'),
            'WP_DEBUG_LOG': log_raw not in ('', 'false', '0'),  # 'true' OR a path
            'SCRIPT_DEBUG': _val('SCRIPT_DEBUG').lower() in ('1', 'true'),
            'WP_DEBUG_DISPLAY': _val('WP_DEBUG_DISPLAY').lower() in ('1', 'true'),
        }
        return {'success': True, 'debug': state, 'enabled': state['WP_DEBUG']}

    @classmethod
    def set_debug(cls, path, enabled):
        from app.services.wordpress_service import WordPressService

        def wp(*args):
            return WordPressService.wp_cli(path, ['config', 'set', *args])

        val = 'true' if enabled else 'false'
        # Gate on the primary write so a read-only wp-config / stopped container
        # reports an honest failure instead of a false "updated".
        primary = wp('WP_DEBUG', val, '--raw')
        if not primary.get('success'):
            return {'success': False,
                    'error': primary.get('error') or 'Failed to update wp-config (is the site running?)'}
        wp('SCRIPT_DEBUG', val, '--raw')
        if enabled:
            wp('WP_DEBUG_LOG', cls.DEBUG_LOG_PATH)        # string path (not --raw)
            wp('WP_DEBUG_DISPLAY', 'false', '--raw')      # never render errors on the page
        else:
            wp('WP_DEBUG_LOG', 'false', '--raw')
        return cls.get_debug(path)

    # ---------- WP-Cron ----------

    @classmethod
    def get_cron(cls, path):
        from app.services.wordpress_service import WordPressService
        dis = WordPressService.wp_cli(path, ['config', 'get', 'DISABLE_WP_CRON'])
        disabled = (dis.get('output') or '').strip().lower() in ('1', 'true') if dis.get('success') else False
        events = []
        ev = WordPressService.wp_cli(path, ['cron', 'event', 'list', '--format=json'])
        if ev.get('success'):
            try:
                events = json.loads(ev.get('output') or '[]')
            except (ValueError, TypeError):
                events = []
        return {'success': True, 'disabled': disabled, 'events': events}

    @classmethod
    def run_cron(cls, path):
        from app.services.wordpress_service import WordPressService
        res = WordPressService.wp_cli(path, ['cron', 'event', 'run', '--due-now'])
        return {
            'success': bool(res.get('success')),
            'output': (res.get('output') or '').strip(),
            'error': res.get('error'),
        }

    @classmethod
    def set_cron_disabled(cls, path, disabled):
        from app.services.wordpress_service import WordPressService
        val = 'true' if disabled else 'false'
        res = WordPressService.wp_cli(path, ['config', 'set', 'DISABLE_WP_CRON', val, '--raw'])
        if not res.get('success'):
            return {'success': False, 'error': res.get('error')}
        return cls.get_cron(path)
