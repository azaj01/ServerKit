"""Cloudflare zone operations beyond DNS records.

ServerKit already connects Cloudflare as a DNS provider (``DNSProviderConfig`` +
the shared :class:`~app.services.dns.cloudflare.CloudflareClient`). This service
builds the *operations* surface on top of that same connection — starting with
zone settings (SSL/TLS, Speed, Caching, Security) and a one-click hardening
preset — so auth, encryption-at-rest, and credential resolution are reused, not
re-implemented.

A zone is addressed by its ServerKit ``DNSZone`` id (the same integer the rest of
the ``/dns`` API uses); credential + Cloudflare zone id are resolved server-side
via :meth:`DNSZoneService._resolve_credential`, the canonical resolver.
"""
import logging
import os
import re

logger = logging.getLogger(__name__)


class CloudflareError(Exception):
    """A caller-facing problem resolving a zone (not found, not Cloudflare, no
    connected credential). Mapped to a 400 by the API layer."""


class CloudflareService:
    """Zone settings + hardening on a connected Cloudflare zone."""

    # Curated subset of Cloudflare zone settings ServerKit surfaces, grouped for
    # the UI. Each setting: ``id`` (Cloudflare setting id), ``label``, ``type``
    # (toggle | select | hsts) and, for selects, ``options`` ({value, label}).
    # The page renders straight from this metadata; current values + the
    # ``editable`` (plan-gating) flag come from the live settings response.
    SETTING_GROUPS = [
        {
            'key': 'ssl',
            'label': 'SSL/TLS',
            'settings': [
                {'id': 'ssl', 'label': 'SSL/TLS encryption mode', 'type': 'select',
                 'help': 'How Cloudflare connects to your origin. "Full (strict)" '
                         'is the most secure and requires a valid origin certificate.',
                 'options': [
                     {'value': 'off', 'label': 'Off (not secure)'},
                     {'value': 'flexible', 'label': 'Flexible'},
                     {'value': 'full', 'label': 'Full'},
                     {'value': 'strict', 'label': 'Full (strict)'},
                 ]},
                {'id': 'always_use_https', 'label': 'Always use HTTPS', 'type': 'toggle',
                 'help': 'Redirect every HTTP request to HTTPS.'},
                {'id': 'automatic_https_rewrites', 'label': 'Automatic HTTPS rewrites',
                 'type': 'toggle',
                 'help': 'Rewrite insecure http:// links to https:// to avoid mixed content.'},
                {'id': 'min_tls_version', 'label': 'Minimum TLS version', 'type': 'select',
                 'options': [
                     {'value': '1.0', 'label': 'TLS 1.0'},
                     {'value': '1.1', 'label': 'TLS 1.1'},
                     {'value': '1.2', 'label': 'TLS 1.2 (recommended)'},
                     {'value': '1.3', 'label': 'TLS 1.3'},
                 ]},
                {'id': 'tls_1_3', 'label': 'TLS 1.3', 'type': 'toggle',
                 'help': 'Enable the latest, fastest TLS version.'},
                {'id': 'security_header', 'label': 'HTTP Strict Transport Security (HSTS)',
                 'type': 'hsts',
                 'help': 'Tell browsers to only ever connect over HTTPS. Enable only once '
                         'HTTPS works everywhere — it is hard to undo before max-age expires.'},
            ],
        },
        {
            'key': 'speed',
            'label': 'Speed',
            'settings': [
                {'id': 'brotli', 'label': 'Brotli compression', 'type': 'toggle',
                 'help': 'Compress responses with Brotli for supporting browsers.'},
                {'id': 'early_hints', 'label': 'Early Hints', 'type': 'toggle',
                 'help': 'Send 103 Early Hints so browsers can preload assets sooner.'},
                {'id': 'http3', 'label': 'HTTP/3 (with QUIC)', 'type': 'toggle'},
            ],
        },
        {
            'key': 'caching',
            'label': 'Caching',
            'settings': [
                {'id': 'cache_level', 'label': 'Caching level', 'type': 'select',
                 'options': [
                     {'value': 'bypass', 'label': 'Bypass'},
                     {'value': 'basic', 'label': 'Basic'},
                     {'value': 'simplified', 'label': 'Simplified'},
                     {'value': 'aggressive', 'label': 'Aggressive (recommended)'},
                     {'value': 'cache_everything', 'label': 'Cache everything'},
                 ]},
                {'id': 'browser_cache_ttl', 'label': 'Browser cache TTL', 'type': 'select',
                 'options': [
                     {'value': 0, 'label': 'Respect existing headers'},
                     {'value': 1800, 'label': '30 minutes'},
                     {'value': 3600, 'label': '1 hour'},
                     {'value': 14400, 'label': '4 hours'},
                     {'value': 28800, 'label': '8 hours'},
                     {'value': 86400, 'label': '1 day'},
                     {'value': 604800, 'label': '1 week'},
                 ]},
                {'id': 'development_mode', 'label': 'Development mode', 'type': 'toggle',
                 'help': 'Temporarily bypass the cache while you work. Auto-expires after 3 hours.'},
                {'id': 'always_online', 'label': 'Always Online', 'type': 'toggle',
                 'help': 'Serve a cached copy of your site if your origin is unreachable.'},
            ],
        },
        {
            'key': 'security',
            'label': 'Security',
            'settings': [
                {'id': 'security_level', 'label': 'Security level', 'type': 'select',
                 'options': [
                     {'value': 'off', 'label': 'Off'},
                     {'value': 'essentially_off', 'label': 'Essentially off'},
                     {'value': 'low', 'label': 'Low'},
                     {'value': 'medium', 'label': 'Medium'},
                     {'value': 'high', 'label': 'High'},
                     {'value': 'under_attack', 'label': "I'm under attack"},
                 ]},
                {'id': 'browser_check', 'label': 'Browser integrity check', 'type': 'toggle',
                 'help': 'Block requests from common malicious bots and crawlers.'},
                {'id': 'challenge_ttl', 'label': 'Challenge passage', 'type': 'select',
                 'help': 'How long a visitor stays verified after passing a challenge.',
                 'options': [
                     {'value': 300, 'label': '5 minutes'},
                     {'value': 900, 'label': '15 minutes'},
                     {'value': 1800, 'label': '30 minutes'},
                     {'value': 3600, 'label': '1 hour'},
                     {'value': 7200, 'label': '2 hours'},
                     {'value': 10800, 'label': '3 hours'},
                     {'value': 14400, 'label': '4 hours'},
                     {'value': 28800, 'label': '8 hours'},
                     {'value': 86400, 'label': '1 day'},
                 ]},
            ],
        },
    ]

    # One-click hardening (plan §Phase 1 Actions): Full (strict), Always HTTPS,
    # HSTS (6 months), TLS 1.2 floor + 1.3, Brotli, HTTP/3, 4h browser cache.
    RECOMMENDED_PRESET = [
        ('ssl', 'strict'),
        ('always_use_https', 'on'),
        ('automatic_https_rewrites', 'on'),
        ('min_tls_version', '1.2'),
        ('tls_1_3', 'on'),
        ('brotli', 'on'),
        ('http3', 'on'),
        ('browser_cache_ttl', 14400),
        ('security_header', {'strict_transport_security': {
            'enabled': True, 'max_age': 15552000,
            'include_subdomains': True, 'preload': False, 'nosniff': True}}),
    ]

    @staticmethod
    def _zone_and_client(zone_id):
        """Resolve ``(zone, CloudflareClient)`` for a ServerKit DNS zone id, or raise
        :class:`CloudflareError` with a user-facing reason. Credential resolution
        reuses the canonical resolver so the connection store is the single source
        of truth."""
        from app.services.dns_zone_service import DNSZoneService
        from app.services.dns import CloudflareClient

        zone = DNSZoneService.get_zone(zone_id)
        if not zone:
            raise CloudflareError('Zone not found')
        if (zone.provider or '').lower() != 'cloudflare':
            raise CloudflareError('This zone is not managed by Cloudflare')
        credential = DNSZoneService._resolve_credential(zone)
        if not credential:
            raise CloudflareError('No connected Cloudflare credential resolves for this zone')
        if not zone.provider_zone_id:
            raise CloudflareError("Cloudflare hasn't been matched to this domain yet — "
                                  'open the DNS zone once to link it, then retry')
        return zone, CloudflareClient(credential)

    @staticmethod
    def _zone_dict(zone):
        return {'id': zone.id, 'domain': zone.domain,
                'provider_zone_id': zone.provider_zone_id}

    @staticmethod
    def _record(zone, product, action, target=None, result='ok', error=None):
        """Best-effort append to the Cloudflare-ops activity ledger. Never raises —
        an audit write must not break the operation it describes."""
        try:
            from app.services.cf_ops_change_service import CfOpsChangeService
            CfOpsChangeService.record(
                provider_zone_id=getattr(zone, 'provider_zone_id', None),
                product=product, action=action, target=target,
                result=result, error=error,
                config_id=getattr(zone, 'dns_provider_config_id', None))
        except Exception:  # pragma: no cover - ledger writes are best-effort
            pass

    @classmethod
    def get_settings(cls, zone_id):
        """Live zone settings, indexed by id, plus the UI grouping metadata."""
        zone, client = cls._zone_and_client(zone_id)
        res = client.get_zone_settings(zone.provider_zone_id)
        if not res.get('success'):
            return {'success': False, 'error': res.get('error', 'Failed to load zone settings')}
        by_id = {s.get('id'): s for s in (res.get('result') or []) if isinstance(s, dict)}
        return {'success': True, 'zone': cls._zone_dict(zone),
                'groups': cls.SETTING_GROUPS, 'settings': by_id}

    @classmethod
    def get_setting(cls, zone_id, setting_id):
        zone, client = cls._zone_and_client(zone_id)
        res = client.get_zone_setting(zone.provider_zone_id, setting_id)
        if not res.get('success'):
            return {'success': False, 'error': res.get('error', 'Failed to load setting')}
        return {'success': True, 'setting': res.get('result')}

    @classmethod
    def update_setting(cls, zone_id, setting_id, value):
        zone, client = cls._zone_and_client(zone_id)
        res = client.update_zone_setting(zone.provider_zone_id, setting_id, value)
        if not res.get('success'):
            cls._record(zone, 'settings', 'update', setting_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Update failed')}
        cls._record(zone, 'settings', 'update', setting_id)
        return {'success': True, 'setting': res.get('result')}

    @classmethod
    def apply_recommended(cls, zone_id):
        """Apply the recommended hardening preset, returning a per-setting report so
        the UI can show which toggles the plan allowed and which it gated."""
        zone, client = cls._zone_and_client(zone_id)
        results = []
        for setting_id, value in cls.RECOMMENDED_PRESET:
            res = client.update_zone_setting(zone.provider_zone_id, setting_id, value)
            results.append({'setting': setting_id,
                            'success': bool(res.get('success')),
                            'error': None if res.get('success') else res.get('error')})
        applied = sum(1 for r in results if r['success'])
        cls._record(zone, 'settings', 'apply-preset', 'recommended',
                    'ok' if applied else 'error',
                    None if applied else 'No settings applied')
        return {'success': applied > 0, 'applied': applied,
                'total': len(results), 'results': results}

    # Free/Pro plans can purge everything or up to 30 individual files per request;
    # hosts/prefixes/tags are Enterprise-only (Cloudflare returns a plan error,
    # which we surface verbatim).
    MAX_PURGE_FILES = 30

    @classmethod
    def purge_cache(cls, zone_id, *, everything=False, files=None, hosts=None,
                    prefixes=None, tags=None):
        """Purge the zone's Cloudflare cache. Either ``everything`` or one/more of
        ``files``/``hosts``/``prefixes``/``tags``. Raises :class:`CloudflareError`
        when nothing was requested (a caller error)."""
        zone, client = cls._zone_and_client(zone_id)

        if everything:
            payload = {'purge_everything': True}
        else:
            payload = {}
            clean = [f.strip() for f in (files or []) if f and f.strip()]
            if clean:
                payload['files'] = clean[:cls.MAX_PURGE_FILES]
            for key, val in (('hosts', hosts), ('prefixes', prefixes), ('tags', tags)):
                items = [v.strip() for v in (val or []) if v and v.strip()]
                if items:
                    payload[key] = items
            if not payload:
                raise CloudflareError('Nothing to purge — choose "everything" or '
                                      'provide files, hosts, prefixes, or tags')

        res = client.purge_cache(zone.provider_zone_id, payload)
        target = 'everything' if everything else 'files'
        if not res.get('success'):
            cls._record(zone, 'cache', 'purge', target, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Cache purge failed')}
        cls._record(zone, 'cache', 'purge', target)
        return {'success': True, 'purged': payload}

    # ── WAF custom rules ─────────────────────────────────────────────────────

    WAF_PHASE = 'http_request_firewall_custom'
    # Actions ServerKit lets you set on a custom rule (a safe subset of
    # Cloudflare's). Terminal actions only — no "skip", which can disable WAF.
    WAF_ACTIONS = {'block', 'managed_challenge', 'js_challenge', 'challenge', 'log'}

    # One-click rule templates (plan §Phase 3). ``params`` are collected from the
    # admin and validated before being interpolated into a Cloudflare expression.
    WAF_PRESETS = [
        {
            'key': 'lock_wp_admin',
            'label': 'Lock WordPress admin to an IP',
            'description': 'Block /wp-admin and /wp-login.php for everyone except a '
                           'trusted IP address (e.g. your office or home).',
            'action': 'block',
            'params': [{'key': 'ip', 'label': 'Allowed IP address',
                        'placeholder': 'e.g. 203.0.113.7'}],
        },
        {
            'key': 'block_exploit_paths',
            'label': 'Block common exploit paths',
            'description': 'Block requests probing for /xmlrpc.php, dotfiles like '
                           '/.env and /.git, and exposed config files.',
            'action': 'block',
            'params': [],
        },
        {
            'key': 'challenge_bad_bots',
            'label': 'Challenge suspicious bots',
            'description': 'Show a managed challenge to traffic with a low bot score. '
                           'Requires Cloudflare Bot Management on some plans.',
            'action': 'managed_challenge',
            'params': [],
        },
    ]

    @classmethod
    def _validate_action(cls, action):
        if action not in cls.WAF_ACTIONS:
            raise CloudflareError(
                f'Unsupported action "{action}". Use one of: {", ".join(sorted(cls.WAF_ACTIONS))}')

    @classmethod
    def _build_preset_rule(cls, key, params):
        """Turn a preset key + admin-supplied params into a concrete rule dict.
        Validates any user input that lands inside a Cloudflare expression (the IP)
        so a preset can't be used to inject expression syntax."""
        import ipaddress
        if key == 'lock_wp_admin':
            ip = (params.get('ip') or '').strip()
            try:
                ipaddress.ip_address(ip)
            except ValueError:
                raise CloudflareError('A valid IP address is required for this rule')
            return {
                'description': 'ServerKit: lock WordPress admin to a trusted IP',
                'expression': ('(http.request.uri.path contains "/wp-admin" or '
                               'http.request.uri.path contains "/wp-login.php") '
                               f'and ip.src ne {ip}'),
                'action': 'block',
            }
        if key == 'block_exploit_paths':
            return {
                'description': 'ServerKit: block common exploit paths',
                'expression': ('(http.request.uri.path contains "/xmlrpc.php") or '
                               '(http.request.uri.path contains "/.env") or '
                               '(http.request.uri.path contains "/.git/") or '
                               '(http.request.uri.path contains "/wp-config.php")'),
                'action': 'block',
            }
        if key == 'challenge_bad_bots':
            return {
                'description': 'ServerKit: challenge suspicious bots',
                'expression': '(cf.bot_management.score lt 30)',
                'action': 'managed_challenge',
            }
        raise CloudflareError(f'Unknown WAF preset: {key}')

    @classmethod
    def _find_custom_ruleset(cls, client, provider_zone_id, phase=None):
        """Return ``(ruleset_dict, listing_error)``. ``ruleset_dict`` is the zone's
        custom-firewall entry-point ruleset or ``None`` when it doesn't exist yet;
        ``listing_error`` is set only when the list call itself failed (auth/scope)."""
        phase = phase or cls.WAF_PHASE
        listing = client.list_rulesets(provider_zone_id)
        if not listing.get('success'):
            return None, listing.get('error', 'Failed to list rulesets')
        custom = next((rs for rs in (listing.get('result') or [])
                       if rs.get('phase') == phase and rs.get('kind') == 'zone'), None)
        return custom, None

    @staticmethod
    def _rule_dict(r):
        return {'id': r.get('id'), 'description': r.get('description'),
                'expression': r.get('expression'), 'action': r.get('action'),
                'enabled': r.get('enabled', True), 'ref': r.get('ref')}

    @classmethod
    def list_waf_rules(cls, zone_id):
        """Custom firewall rules for the zone, plus the preset catalog. A zone with
        no custom ruleset yet returns an empty list (not an error)."""
        zone, client = cls._zone_and_client(zone_id)
        custom, err = cls._find_custom_ruleset(client, zone.provider_zone_id)
        if err:
            return {'success': False, 'error': err}
        if not custom:
            return {'success': True, 'ruleset_id': None, 'rules': [],
                    'presets': cls.WAF_PRESETS}
        detail = client.get_ruleset(zone.provider_zone_id, custom['id'])
        if not detail.get('success'):
            return {'success': False, 'error': detail.get('error', 'Failed to load ruleset')}
        result = detail.get('result') or {}
        rules = [cls._rule_dict(r) for r in (result.get('rules') or [])]
        return {'success': True, 'ruleset_id': result.get('id'),
                'rules': rules, 'presets': cls.WAF_PRESETS}

    @classmethod
    def add_waf_rule(cls, zone_id, *, description, expression, action, enabled=True):
        """Append a custom firewall rule, creating the zone's custom ruleset on first
        use. Returns the created rule's ruleset on success."""
        cls._validate_action(action)
        if not (expression or '').strip():
            raise CloudflareError('A rule expression is required')
        zone, client = cls._zone_and_client(zone_id)
        rule = {'description': description or 'ServerKit rule',
                'expression': expression, 'action': action, 'enabled': bool(enabled)}

        custom, err = cls._find_custom_ruleset(client, zone.provider_zone_id)
        if err:
            return {'success': False, 'error': err}
        if custom:
            res = client.add_ruleset_rule(zone.provider_zone_id, custom['id'], rule)
        else:
            res = client.create_phase_ruleset(zone.provider_zone_id, cls.WAF_PHASE, [rule])
        if not res.get('success'):
            cls._record(zone, 'waf', 'add-rule', rule['description'], 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to add rule')}
        cls._record(zone, 'waf', 'add-rule', rule['description'])
        return {'success': True, 'result': res.get('result')}

    @classmethod
    def apply_waf_preset(cls, zone_id, preset_key, params=None):
        rule = cls._build_preset_rule(preset_key, params or {})
        return cls.add_waf_rule(zone_id, description=rule['description'],
                                expression=rule['expression'], action=rule['action'])

    @classmethod
    def update_waf_rule(cls, zone_id, ruleset_id, rule_id, fields):
        """Patch a custom rule. Only known fields are forwarded; an ``action``, if
        present, is validated."""
        zone, client = cls._zone_and_client(zone_id)
        rule = {}
        for key in ('description', 'expression', 'action', 'enabled'):
            if key in fields:
                rule[key] = fields[key]
        if 'action' in rule:
            cls._validate_action(rule['action'])
        if not rule:
            raise CloudflareError('No updatable fields provided')
        res = client.update_ruleset_rule(zone.provider_zone_id, ruleset_id, rule_id, rule)
        if not res.get('success'):
            cls._record(zone, 'waf', 'update-rule', rule_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to update rule')}
        cls._record(zone, 'waf', 'update-rule', rule_id)
        return {'success': True, 'result': res.get('result')}

    @classmethod
    def delete_waf_rule(cls, zone_id, ruleset_id, rule_id):
        zone, client = cls._zone_and_client(zone_id)
        res = client.delete_ruleset_rule(zone.provider_zone_id, ruleset_id, rule_id)
        if not res.get('success'):
            cls._record(zone, 'waf', 'delete-rule', rule_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to delete rule')}
        cls._record(zone, 'waf', 'delete-rule', rule_id)
        return {'success': True}

    # ── Workers (edge hosting) ───────────────────────────────────────────────
    # Workers are account-scoped; the owning account is read from the zone, so the
    # whole feature reuses the same Cloudflare connection the DNS zone already has.

    WORKER_NAME_RE = re.compile(r'^[a-z0-9][a-z0-9_-]{0,62}$')
    DEFAULT_COMPAT_DATE = '2025-01-01'

    @classmethod
    def _account_id(cls, zone, client):
        """The Cloudflare account that owns ``zone`` (for account-scoped resources)."""
        res = client.get_zone_account_id(zone.provider_zone_id)
        if not res.get('success'):
            raise CloudflareError(
                res.get('error') or 'Could not resolve the Cloudflare account for this zone')
        acct = ((res.get('result') or {}).get('account') or {}).get('id')
        if not acct:
            raise CloudflareError('Cloudflare did not return an account for this zone')
        return acct

    @classmethod
    def list_workers(cls, zone_id):
        """Live Worker scripts in the zone's account (flagged when ServerKit manages
        them), plus the zone's Worker routes."""
        from app.models.cloudflare_worker import CloudflareWorker
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.list_worker_scripts(account_id)
        if not res.get('success'):
            return {'success': False, 'error': res.get('error', 'Failed to list workers')}
        managed = {w.name: w for w in
                   CloudflareWorker.query.filter_by(account_id=account_id).all()}
        scripts = []
        for s in (res.get('result') or []):
            name = s.get('id')   # Cloudflare returns the script name in `id`
            rec = managed.get(name)
            scripts.append({'name': name, 'created_on': s.get('created_on'),
                            'modified_on': s.get('modified_on'),
                            'managed': rec is not None,
                            'has_source': bool(rec and rec.source)})
        routes = []
        rres = client.list_worker_routes(zone.provider_zone_id)
        if rres.get('success'):
            routes = [{'id': r.get('id'), 'pattern': r.get('pattern'), 'script': r.get('script')}
                      for r in (rres.get('result') or [])]
        return {'success': True, 'account_id': account_id, 'workers': scripts, 'routes': routes}

    @classmethod
    def deploy_worker(cls, zone_id, *, name, code, compatibility_date=None, route_pattern=None):
        """Upload a module Worker, record the source locally, and optionally attach a
        route in this zone."""
        from app import db
        from app.models.cloudflare_worker import CloudflareWorker

        name = (name or '').strip().lower()
        if not cls.WORKER_NAME_RE.match(name):
            raise CloudflareError('Worker name must be 1–63 chars: lowercase letters, '
                                  'digits, hyphens or underscores, starting alphanumeric')
        if not (code or '').strip():
            raise CloudflareError('Worker code is required')
        compat = compatibility_date or cls.DEFAULT_COMPAT_DATE

        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.upload_worker_module(account_id, name, code, compat)
        if not res.get('success'):
            cls._record(zone, 'workers', 'deploy', name, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Worker upload failed')}

        rec = CloudflareWorker.query.filter_by(account_id=account_id, name=name).first()
        if not rec:
            rec = CloudflareWorker(account_id=account_id, name=name,
                                   dns_provider_config_id=zone.dns_provider_config_id)
            db.session.add(rec)
        rec.source = code
        rec.compatibility_date = compat
        db.session.commit()

        route = None
        if route_pattern and route_pattern.strip():
            rr = client.add_worker_route(zone.provider_zone_id, route_pattern.strip(), name)
            route = {'success': bool(rr.get('success')),
                     'error': None if rr.get('success') else rr.get('error')}
        cls._record(zone, 'workers', 'deploy', name)
        return {'success': True, 'worker': rec.to_dict(), 'route': route}

    @classmethod
    def delete_worker(cls, zone_id, name):
        from app import db
        from app.models.cloudflare_worker import CloudflareWorker
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.delete_worker_script(account_id, name)
        if not res.get('success'):
            cls._record(zone, 'workers', 'delete', name, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to delete worker')}
        rec = CloudflareWorker.query.filter_by(account_id=account_id, name=name).first()
        if rec:
            db.session.delete(rec)
            db.session.commit()
        cls._record(zone, 'workers', 'delete', name)
        return {'success': True}

    @classmethod
    def add_worker_route(cls, zone_id, pattern, script):
        if not (pattern or '').strip() or not (script or '').strip():
            raise CloudflareError('Both a route pattern and a worker name are required')
        zone, client = cls._zone_and_client(zone_id)
        res = client.add_worker_route(zone.provider_zone_id, pattern.strip(), script.strip())
        if not res.get('success'):
            cls._record(zone, 'workers', 'add-route', pattern.strip(), 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to add route')}
        cls._record(zone, 'workers', 'add-route', pattern.strip())
        return {'success': True, 'result': res.get('result')}

    @classmethod
    def delete_worker_route(cls, zone_id, route_id):
        zone, client = cls._zone_and_client(zone_id)
        res = client.delete_worker_route(zone.provider_zone_id, route_id)
        if not res.get('success'):
            cls._record(zone, 'workers', 'delete-route', route_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to delete route')}
        cls._record(zone, 'workers', 'delete-route', route_id)
        return {'success': True}

    # ── Tunnels (cloudflared) ────────────────────────────────────────────────
    # Cloudflare Tunnels expose a local/private service through Cloudflare's edge
    # without a public IP. Distinct from ServerKit's WireGuard remote-access
    # tunnels. Account-scoped; account resolved from the zone.

    @staticmethod
    def _install_command(token):
        """The one-liner an operator runs on the target host to attach a connector."""
        if not token:
            return None
        return f'cloudflared service install {token}'

    @classmethod
    def list_tunnels(cls, zone_id):
        from app.models.cloudflare_tunnel import CloudflareTunnel
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.list_tunnels(account_id)
        if not res.get('success'):
            return {'success': False, 'error': res.get('error', 'Failed to list tunnels')}
        managed = {t.tunnel_id for t in
                   CloudflareTunnel.query.filter_by(account_id=account_id).all()}
        tunnels = [{'id': t.get('id'), 'name': t.get('name'), 'status': t.get('status'),
                    'created_at': t.get('created_at'),
                    'connections': len(t.get('connections') or []),
                    'managed': t.get('id') in managed}
                   for t in (res.get('result') or [])]
        return {'success': True, 'account_id': account_id, 'tunnels': tunnels}

    @classmethod
    def create_tunnel(cls, zone_id, name):
        """Create a tunnel and return the connector token + install command (the
        token is revealed once here and stored encrypted for later)."""
        from app import db
        from app.models.cloudflare_tunnel import CloudflareTunnel
        from app.utils.crypto import encrypt_secret

        name = (name or '').strip()
        if not name:
            raise CloudflareError('A tunnel name is required')
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.create_tunnel(account_id, name)
        if not res.get('success'):
            cls._record(zone, 'tunnels', 'create', name, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to create tunnel')}
        result = res.get('result') or {}
        tunnel_id = result.get('id')
        token = result.get('token')
        if not token and tunnel_id:
            tres = client.get_tunnel_token(account_id, tunnel_id)
            token = tres.get('result') if tres.get('success') else None

        rec = CloudflareTunnel(
            tunnel_id=tunnel_id, name=name, account_id=account_id,
            dns_provider_config_id=zone.dns_provider_config_id,
            token_encrypted=encrypt_secret(token) if token else None)
        db.session.add(rec)
        db.session.commit()
        cls._record(zone, 'tunnels', 'create', name)
        return {'success': True, 'tunnel': rec.to_dict(),
                'token': token, 'install': cls._install_command(token)}

    @classmethod
    def get_tunnel_install(cls, zone_id, tunnel_id):
        """Re-fetch the connector token + install command for a tunnel."""
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        tres = client.get_tunnel_token(account_id, tunnel_id)
        if not tres.get('success'):
            return {'success': False, 'error': tres.get('error', 'Failed to fetch token')}
        token = tres.get('result')
        return {'success': True, 'token': token, 'install': cls._install_command(token)}

    @classmethod
    def delete_tunnel(cls, zone_id, tunnel_id):
        from app import db
        from app.models.cloudflare_tunnel import CloudflareTunnel
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.delete_tunnel(account_id, tunnel_id)
        if not res.get('success'):
            cls._record(zone, 'tunnels', 'delete', tunnel_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to delete tunnel')}
        rec = CloudflareTunnel.query.filter_by(account_id=account_id, tunnel_id=tunnel_id).first()
        if rec:
            db.session.delete(rec)
            db.session.commit()
        cls._record(zone, 'tunnels', 'delete', tunnel_id)
        return {'success': True}

    @classmethod
    def get_tunnel_hostnames(cls, zone_id, tunnel_id):
        """The public-hostname ingress rules configured on a tunnel."""
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.get_tunnel_configuration(account_id, tunnel_id)
        if not res.get('success'):
            return {'success': False, 'error': res.get('error', 'Failed to load tunnel config')}
        ingress = ((res.get('result') or {}).get('config') or {}).get('ingress') or []
        hostnames = [{'hostname': r.get('hostname'), 'service': r.get('service')}
                     for r in ingress if r.get('hostname')]
        return {'success': True, 'hostnames': hostnames}

    @classmethod
    def add_tunnel_hostname(cls, zone_id, tunnel_id, hostname, service):
        """Route a public hostname to a local service through the tunnel, and
        best-effort create the proxied CNAME that points it at the tunnel."""
        hostname = (hostname or '').strip().lower().rstrip('.')
        service = (service or '').strip()
        if not hostname or not service:
            raise CloudflareError('Both a hostname and a service '
                                  '(e.g. http://localhost:8080) are required')
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)

        cur = client.get_tunnel_configuration(account_id, tunnel_id)
        config = ((cur.get('result') or {}).get('config') or {}) if cur.get('success') else {}
        # Keep only real hostname rules, replace/insert this one, re-add catch-all.
        ingress = [r for r in (config.get('ingress') or [])
                   if r.get('hostname') and r.get('hostname') != hostname]
        ingress.append({'hostname': hostname, 'service': service})
        ingress.append({'service': 'http_status:404'})
        config['ingress'] = ingress

        res = client.put_tunnel_configuration(account_id, tunnel_id, config)
        if not res.get('success'):
            cls._record(zone, 'tunnels', 'add-hostname', hostname, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to set tunnel route')}
        dns = cls._ensure_tunnel_cname(zone, client, hostname, tunnel_id)
        cls._record(zone, 'tunnels', 'add-hostname', hostname)
        return {'success': True, 'dns': dns}

    @classmethod
    def remove_tunnel_hostname(cls, zone_id, tunnel_id, hostname):
        hostname = (hostname or '').strip().lower().rstrip('.')
        if not hostname:
            raise CloudflareError('A hostname is required')
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        cur = client.get_tunnel_configuration(account_id, tunnel_id)
        config = ((cur.get('result') or {}).get('config') or {}) if cur.get('success') else {}
        ingress = [r for r in (config.get('ingress') or [])
                   if r.get('hostname') and r.get('hostname') != hostname]
        ingress.append({'service': 'http_status:404'})
        config['ingress'] = ingress
        res = client.put_tunnel_configuration(account_id, tunnel_id, config)
        if not res.get('success'):
            cls._record(zone, 'tunnels', 'remove-hostname', hostname, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to remove tunnel route')}
        cls._record(zone, 'tunnels', 'remove-hostname', hostname)
        return {'success': True}

    @staticmethod
    def _ensure_tunnel_cname(zone, client, hostname, tunnel_id):
        """Best-effort: upsert the proxied CNAME ``hostname → <id>.cfargotunnel.com``
        that publishes the tunnel. Reported, never fatal — the route is already set."""
        try:
            from app.services.dns.base import DnsRecordSpec
            from app.services.dns_ownership_service import DnsOwnershipService
            target = f'{tunnel_id}.cfargotunnel.com'
            spec = DnsRecordSpec(record_type='CNAME', name=hostname, content=target,
                                 ttl=1, proxied=True)
            res = DnsOwnershipService.guarded_upsert(
                client, provider='cloudflare', provider_zone_id=zone.provider_zone_id,
                spec=spec, source='cf-tunnel', config_id=zone.dns_provider_config_id,
                allow_foreign=True)
            return {'created': bool(res.get('success')),
                    'error': None if res.get('success') else res.get('error')}
        except Exception as e:
            return {'created': False, 'error': str(e)}

    # ── Developer platform: R2 / KV / D1 ─────────────────────────────────────
    # Account-scoped storage. Management only — listing the inventory and
    # creating/deleting resources. R2 is S3-compatible, so a bucket made here can
    # later back ServerKit backups via the existing S3 storage backend (a separate
    # follow-up that mints scoped R2 access keys).

    R2_BUCKET_RE = re.compile(r'^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$')

    @classmethod
    def list_storage(cls, zone_id):
        """Combined developer-platform inventory. Each product is fetched
        independently so a missing token scope degrades to a per-product error
        rather than failing the whole tab."""
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        out = {'success': True, 'account_id': account_id,
               'r2': [], 'kv': [], 'd1': [], 'errors': {}}

        r2 = client.list_r2_buckets(account_id)
        if r2.get('success'):
            out['r2'] = [{'name': b.get('name'), 'creation_date': b.get('creation_date')}
                         for b in ((r2.get('result') or {}).get('buckets') or [])]
        else:
            out['errors']['r2'] = r2.get('error')

        kv = client.list_kv_namespaces(account_id)
        if kv.get('success'):
            out['kv'] = [{'id': n.get('id'), 'title': n.get('title')}
                         for n in (kv.get('result') or [])]
        else:
            out['errors']['kv'] = kv.get('error')

        d1 = client.list_d1_databases(account_id)
        if d1.get('success'):
            out['d1'] = [{'uuid': d.get('uuid'), 'name': d.get('name')}
                         for d in (d1.get('result') or [])]
        else:
            out['errors']['d1'] = d1.get('error')
        return out

    @classmethod
    def create_r2_bucket(cls, zone_id, name):
        name = (name or '').strip().lower()
        if not cls.R2_BUCKET_RE.match(name):
            raise CloudflareError('Bucket name must be 3–63 chars: lowercase letters, '
                                  'digits and hyphens, starting and ending alphanumeric')
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.create_r2_bucket(account_id, name)
        if not res.get('success'):
            cls._record(zone, 'storage', 'create-r2', name, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to create bucket')}
        cls._record(zone, 'storage', 'create-r2', name)
        return {'success': True, 'bucket': name}

    @classmethod
    def delete_r2_bucket(cls, zone_id, name):
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.delete_r2_bucket(account_id, name)
        if not res.get('success'):
            cls._record(zone, 'storage', 'delete-r2', name, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to delete bucket')}
        cls._record(zone, 'storage', 'delete-r2', name)
        return {'success': True}

    @classmethod
    def create_kv_namespace(cls, zone_id, title):
        title = (title or '').strip()
        if not title:
            raise CloudflareError('A namespace title is required')
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.create_kv_namespace(account_id, title)
        if not res.get('success'):
            cls._record(zone, 'storage', 'create-kv', title, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to create namespace')}
        cls._record(zone, 'storage', 'create-kv', title)
        return {'success': True, 'namespace': res.get('result')}

    @classmethod
    def delete_kv_namespace(cls, zone_id, namespace_id):
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.delete_kv_namespace(account_id, namespace_id)
        if not res.get('success'):
            cls._record(zone, 'storage', 'delete-kv', namespace_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to delete namespace')}
        cls._record(zone, 'storage', 'delete-kv', namespace_id)
        return {'success': True}

    @classmethod
    def create_d1_database(cls, zone_id, name):
        name = (name or '').strip()
        if not name:
            raise CloudflareError('A database name is required')
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.create_d1_database(account_id, name)
        if not res.get('success'):
            cls._record(zone, 'storage', 'create-d1', name, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to create database')}
        cls._record(zone, 'storage', 'create-d1', name)
        return {'success': True, 'database': res.get('result')}

    @classmethod
    def delete_d1_database(cls, zone_id, database_id):
        zone, client = cls._zone_and_client(zone_id)
        account_id = cls._account_id(zone, client)
        res = client.delete_d1_database(account_id, database_id)
        if not res.get('success'):
            cls._record(zone, 'storage', 'delete-d1', database_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to delete database')}
        cls._record(zone, 'storage', 'delete-d1', database_id)
        return {'success': True}

    # ── DNSSEC ────────────────────────────────────────────────────────────────
    # Display-only: enabling DNSSEC returns the DS record the operator must place
    # at their registrar. No registrar automation.

    @staticmethod
    def _normalize_dnssec(r):
        """Flatten Cloudflare's DNSSEC ``result`` to the fields the DS card needs."""
        r = r or {}
        return {
            'status': r.get('status'),   # active | pending | pending-disabled | disabled
            'ds': r.get('ds'),
            'digest': r.get('digest'),
            'digest_type': r.get('digest_type'),
            'digest_algorithm': r.get('digest_algorithm'),
            'algorithm': r.get('algorithm'),
            'key_tag': r.get('key_tag'),
            'key_type': r.get('key_type'),
            'public_key': r.get('public_key'),
            'flags': r.get('flags'),
        }

    @classmethod
    def get_dnssec(cls, zone_id):
        zone, client = cls._zone_and_client(zone_id)
        res = client.get_dnssec(zone.provider_zone_id)
        if not res.get('success'):
            return {'success': False, 'error': res.get('error', 'Failed to load DNSSEC status')}
        return {'success': True, 'zone': cls._zone_dict(zone),
                'dnssec': cls._normalize_dnssec(res.get('result'))}

    @classmethod
    def set_dnssec(cls, zone_id, enabled):
        """Enable or disable DNSSEC. Returns the DS record payload on enable."""
        zone, client = cls._zone_and_client(zone_id)
        action = 'enable' if enabled else 'disable'
        res = client.set_dnssec(zone.provider_zone_id, 'active' if enabled else 'disabled')
        if not res.get('success'):
            cls._record(zone, 'dnssec', action, zone.domain, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to update DNSSEC')}
        cls._record(zone, 'dnssec', action, zone.domain)
        return {'success': True, 'dnssec': cls._normalize_dnssec(res.get('result'))}

    # ── Origin CA certificates ────────────────────────────────────────────────
    # Issue-and-install, honest about trust: Origin CA certs are valid ONLY behind
    # the Cloudflare proxy. The CSR is generated panel-side; the private key never
    # leaves the box (only the CSR is sent to Cloudflare). Install reuses the
    # existing custom-cert seam (Linux-only). A credential lacking the Origin CA
    # permission is surfaced as an actionable 400 (CloudflareError), never a 502.

    # Cloudflare's accepted Origin CA validity windows, in days (7d … 15y).
    ORIGIN_CA_VALIDITY_DAYS = [7, 30, 90, 365, 730, 1095, 5475]

    # Substrings that mark a provider error as a credential/scope problem rather
    # than a transient provider failure — surfaced as a scoped 400.
    _SCOPE_ERROR_MARKERS = (
        'permission', 'not authorized', 'unauthorized', 'authentication',
        'not allowed', 'insufficient', 'invalid api', 'access denied',
        'forbidden', 'origin ca', 'service key', 'scope',
    )

    @classmethod
    def _is_scope_error(cls, error):
        e = (error or '').lower()
        return any(m in e for m in cls._SCOPE_ERROR_MARKERS)

    @staticmethod
    def _origin_ca_service_key(zone):
        """The optional account-level Origin CA service key stored (Fernet) on the
        zone's DNS provider connection, or ``None`` (a suitably-scoped token also
        authenticates the Origin CA endpoints)."""
        try:
            from app.models.email import DNSProviderConfig
            from app.utils.crypto import decrypt_secret_safe
            cfg_id = getattr(zone, 'dns_provider_config_id', None)
            cfg = DNSProviderConfig.query.get(cfg_id) if cfg_id else None
            if cfg and getattr(cfg, 'origin_ca_key', None):
                return decrypt_secret_safe(cfg.origin_ca_key)
        except Exception:
            pass
        return None

    @staticmethod
    def _generate_csr(hostnames):
        """Generate an RSA private key + CSR for ``hostnames`` panel-side. Returns
        ``(csr_pem, key_pem)``; the key is kept locally for install and never sent
        to Cloudflare."""
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        builder = x509.CertificateSigningRequestBuilder().subject_name(
            x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostnames[0])]))
        builder = builder.add_extension(
            x509.SubjectAlternativeName([x509.DNSName(h) for h in hostnames]), critical=False)
        csr = builder.sign(key, hashes.SHA256())
        csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode()
        key_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption()).decode()
        return csr_pem, key_pem

    @staticmethod
    def _proxy_warnings(zone, client, hostnames):
        """Best-effort: warn when a covered hostname isn't proxied (grey cloud) or
        has no DNS record — an Origin CA cert is only valid behind the proxy."""
        warnings = []
        try:
            rec = client.list_records(zone.provider_zone_id)
            records = (rec.get('records') or []) if rec.get('success') else []
            by_name = {}
            for r in records:
                by_name.setdefault((r.get('name') or '').lower().rstrip('.'), []).append(r)
            for h in hostnames:
                base = h[2:] if h.startswith('*.') else h
                matches = by_name.get(base, [])
                if not matches:
                    warnings.append(
                        f'{h}: no DNS record found — an Origin CA certificate is only '
                        'valid when traffic is proxied through Cloudflare.')
                elif not any(m.get('proxied') for m in matches):
                    warnings.append(
                        f'{h}: the DNS record is not proxied (grey cloud). This '
                        'certificate only works when traffic goes through Cloudflare.')
        except Exception:
            pass
        return warnings

    @staticmethod
    def _install_origin_cert(hostnames, cert_pem, key_pem):
        """Install the issued cert + panel-generated key via the existing custom-cert
        seam (writes PEMs to ``/etc/ssl/serverkit/<domain>/``, Linux-only)."""
        try:
            from app.services.advanced_ssl_service import AdvancedSSLService
            install_domain = next((h for h in hostnames if not h.startswith('*.')), None)
            if not install_domain:
                install_domain = hostnames[0][2:] if hostnames[0].startswith('*.') else hostnames[0]
            info = AdvancedSSLService.upload_custom_cert(install_domain, cert_pem, key_pem)
            return {'success': True, **info}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def issue_origin_certificate(cls, zone_id, hostnames, validity_days=5475, install=True):
        """Issue an Origin CA certificate for ``hostnames`` and (optionally) install
        it on the origin. The private key is generated panel-side and never sent to
        Cloudflare."""
        zone, client = cls._zone_and_client(zone_id)
        hostnames = [h.strip().lower().rstrip('.') for h in (hostnames or []) if h and h.strip()]
        if not hostnames:
            raise CloudflareError('At least one hostname is required')
        if validity_days not in cls.ORIGIN_CA_VALIDITY_DAYS:
            raise CloudflareError(
                'Unsupported validity — choose one of: '
                + ', '.join(str(v) for v in cls.ORIGIN_CA_VALIDITY_DAYS) + ' days')

        csr_pem, key_pem = cls._generate_csr(hostnames)
        res = client.create_origin_certificate(
            csr=csr_pem, hostnames=hostnames, requested_validity=validity_days,
            service_key=cls._origin_ca_service_key(zone))
        if not res.get('success'):
            err = res.get('error', 'Failed to issue Origin CA certificate')
            cls._record(zone, 'origin_ca', 'issue', hostnames[0], 'error', err)
            if cls._is_scope_error(err):
                raise CloudflareError(
                    'This Cloudflare credential lacks the Origin CA permission. Add the '
                    '"SSL and Certificates: Edit" scope to the token, or set an Origin CA '
                    f'key on the connection. ({err})')
            return {'success': False, 'error': err}

        result = res.get('result') or {}
        cert_pem = result.get('certificate')
        out = {
            'success': True,
            'certificate_id': result.get('id'),
            'certificate': cert_pem,
            'hostnames': hostnames,
            'expires_on': result.get('expires_on'),
            'proxy_only': True,
            'warnings': cls._proxy_warnings(zone, client, hostnames),
        }
        if install and cert_pem and os.name != 'nt':
            out['install'] = cls._install_origin_cert(hostnames, cert_pem, key_pem)
        cls._record(zone, 'origin_ca', 'issue', hostnames[0])
        return out

    @classmethod
    def list_origin_certificates(cls, zone_id):
        zone, client = cls._zone_and_client(zone_id)
        res = client.list_origin_certificates(
            zone.provider_zone_id, service_key=cls._origin_ca_service_key(zone))
        if not res.get('success'):
            err = res.get('error', 'Failed to list Origin CA certificates')
            if cls._is_scope_error(err):
                raise CloudflareError(
                    'This Cloudflare credential lacks the Origin CA permission. Add the '
                    f'"SSL and Certificates: Read" scope to the token. ({err})')
            return {'success': False, 'error': err}
        certs = [{
            'id': c.get('id'),
            'hostnames': c.get('hostnames'),
            'expires_on': c.get('expires_on'),
            'requested_validity': c.get('requested_validity'),
            'certificate': c.get('certificate'),
        } for c in (res.get('result') or [])]
        return {'success': True, 'certificates': certs, 'proxy_only': True}

    @classmethod
    def revoke_origin_certificate(cls, zone_id, certificate_id):
        zone, client = cls._zone_and_client(zone_id)
        res = client.revoke_origin_certificate(
            certificate_id, service_key=cls._origin_ca_service_key(zone))
        if not res.get('success'):
            err = res.get('error', 'Failed to revoke certificate')
            cls._record(zone, 'origin_ca', 'revoke', certificate_id, 'error', err)
            if cls._is_scope_error(err):
                raise CloudflareError(
                    'This Cloudflare credential lacks the Origin CA permission. '
                    f'({err})')
            return {'success': False, 'error': err}
        cls._record(zone, 'origin_ca', 'revoke', certificate_id)
        return {'success': True, 'certificate_id': certificate_id}

    # ── Redirect + Transform rules ────────────────────────────────────────────
    # The same ruleset machinery as WAF, in different phases, with per-phase action
    # allowlists + the shared expression-injection guard.

    RULE_PHASES = {
        'redirect': 'http_request_dynamic_redirect',
        'transform': 'http_request_transform',
    }
    RULE_ACTIONS = {
        'redirect': {'redirect'},
        'transform': {'rewrite'},
    }

    # Preset library per rule type (plan §Phase 3). Presets take no free-form user
    # input that lands in an expression — the only interpolated value is the zone's
    # own (validated) domain — so there is no injection surface.
    RULE_PRESETS = {
        'redirect': [
            {'key': 'force_www', 'label': 'Redirect apex to www',
             'description': 'Send https://example.com/* to https://www.example.com/*.',
             'params': []},
            {'key': 'www_to_apex', 'label': 'Redirect www to apex',
             'description': 'Send https://www.example.com/* to https://example.com/*.',
             'params': []},
            {'key': 'strip_trailing_slash', 'label': 'Remove trailing slash',
             'description': 'Redirect /path/ to /path (except the root).',
             'params': []},
        ],
        'transform': [
            {'key': 'strip_tracking', 'label': 'Strip tracking parameters',
             'description': 'Remove utm_*, gclid and fbclid query parameters.',
             'params': []},
        ],
    }

    _SAFE_HOST_RE = re.compile(r'^[a-z0-9.-]+$')

    @classmethod
    def _resolve_rule_phase(cls, slug):
        phase = cls.RULE_PHASES.get(slug)
        if not phase:
            raise CloudflareError(
                f'Unknown rule type "{slug}". Use one of: '
                + ', '.join(sorted(cls.RULE_PHASES)))
        return phase

    @classmethod
    def _validate_rule_action(cls, slug, action):
        allowed = cls.RULE_ACTIONS.get(slug, set())
        if action not in allowed:
            raise CloudflareError(
                f'Unsupported action "{action}" for {slug} rules. '
                f'Use one of: {", ".join(sorted(allowed))}')

    @staticmethod
    def _full_rule_dict(r):
        return {'id': r.get('id'), 'description': r.get('description'),
                'expression': r.get('expression'), 'action': r.get('action'),
                'action_parameters': r.get('action_parameters'),
                'enabled': r.get('enabled', True), 'ref': r.get('ref')}

    @classmethod
    def list_rules(cls, zone_id, slug):
        """Rules for a phase (redirect|transform), plus the preset catalog. A zone
        with no ruleset in that phase yet returns an empty list (not an error)."""
        phase = cls._resolve_rule_phase(slug)
        zone, client = cls._zone_and_client(zone_id)
        custom, err = cls._find_custom_ruleset(client, zone.provider_zone_id, phase)
        if err:
            return {'success': False, 'error': err}
        presets = cls.RULE_PRESETS.get(slug, [])
        if not custom:
            return {'success': True, 'ruleset_id': None, 'rules': [], 'presets': presets}
        detail = client.get_ruleset(zone.provider_zone_id, custom['id'])
        if not detail.get('success'):
            return {'success': False, 'error': detail.get('error', 'Failed to load ruleset')}
        result = detail.get('result') or {}
        rules = [cls._full_rule_dict(r) for r in (result.get('rules') or [])]
        return {'success': True, 'ruleset_id': result.get('id'),
                'rules': rules, 'presets': presets}

    @classmethod
    def add_rule(cls, zone_id, slug, *, description, expression, action,
                 action_parameters=None, enabled=True):
        """Append a rule to the phase's entry-point ruleset, creating it on first use."""
        phase = cls._resolve_rule_phase(slug)
        cls._validate_rule_action(slug, action)
        if not (expression or '').strip():
            raise CloudflareError('A rule expression is required')
        zone, client = cls._zone_and_client(zone_id)
        rule = {'description': description or 'ServerKit rule', 'expression': expression,
                'action': action, 'enabled': bool(enabled)}
        if action_parameters:
            rule['action_parameters'] = action_parameters

        custom, err = cls._find_custom_ruleset(client, zone.provider_zone_id, phase)
        if err:
            return {'success': False, 'error': err}
        if custom:
            res = client.add_ruleset_rule(zone.provider_zone_id, custom['id'], rule)
        else:
            res = client.create_phase_ruleset(zone.provider_zone_id, phase, [rule])
        if not res.get('success'):
            cls._record(zone, slug, 'add-rule', rule['description'], 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to add rule')}
        cls._record(zone, slug, 'add-rule', rule['description'])
        return {'success': True, 'result': res.get('result')}

    @classmethod
    def _build_rule_preset(cls, slug, key, domain, params):
        """Turn a preset key + the zone domain into a concrete rule dict. The domain
        is validated before interpolation so a preset can't inject expression syntax."""
        domain = (domain or '').strip().lower().rstrip('.')
        if not cls._SAFE_HOST_RE.match(domain or ''):
            raise CloudflareError('The zone domain is not a valid hostname')
        if slug == 'redirect':
            if key == 'force_www':
                return {'description': 'ServerKit: redirect apex to www',
                        'expression': f'(http.host eq "{domain}")',
                        'action': 'redirect',
                        'action_parameters': {'from_value': {
                            'status_code': 301,
                            'target_url': {'expression':
                                           f'concat("https://www.{domain}", http.request.uri.path)'},
                            'preserve_query_string': True}}}
            if key == 'www_to_apex':
                return {'description': 'ServerKit: redirect www to apex',
                        'expression': f'(http.host eq "www.{domain}")',
                        'action': 'redirect',
                        'action_parameters': {'from_value': {
                            'status_code': 301,
                            'target_url': {'expression':
                                           f'concat("https://{domain}", http.request.uri.path)'},
                            'preserve_query_string': True}}}
            if key == 'strip_trailing_slash':
                return {'description': 'ServerKit: remove trailing slash',
                        'expression': ('(ends_with(http.request.uri.path, "/") and '
                                       'http.request.uri.path ne "/")'),
                        'action': 'redirect',
                        'action_parameters': {'from_value': {
                            'status_code': 301,
                            'target_url': {'expression':
                                           'concat("https://", http.host, '
                                           'substring(http.request.uri.path, 0, -1))'},
                            'preserve_query_string': True}}}
        elif slug == 'transform':
            if key == 'strip_tracking':
                return {'description': 'ServerKit: strip tracking parameters',
                        'expression': '(http.request.uri.query ne "")',
                        'action': 'rewrite',
                        'action_parameters': {'uri': {'query': {'expression':
                            'regex_replace(http.request.uri.query, '
                            '"(^|&)(utm_[a-z]+|gclid|fbclid)=[^&]*", "")'}}}}
        raise CloudflareError(f'Unknown {slug} preset: {key}')

    @classmethod
    def apply_rule_preset(cls, zone_id, slug, preset_key, params=None):
        cls._resolve_rule_phase(slug)   # validates slug up front
        zone, _ = cls._zone_and_client(zone_id)
        rule = cls._build_rule_preset(slug, preset_key, zone.domain, params or {})
        return cls.add_rule(zone_id, slug, description=rule['description'],
                            expression=rule['expression'], action=rule['action'],
                            action_parameters=rule.get('action_parameters'))

    @classmethod
    def update_rule(cls, zone_id, slug, ruleset_id, rule_id, fields):
        cls._resolve_rule_phase(slug)
        zone, client = cls._zone_and_client(zone_id)
        rule = {}
        for k in ('description', 'expression', 'action', 'enabled', 'action_parameters'):
            if k in fields:
                rule[k] = fields[k]
        if 'action' in rule:
            cls._validate_rule_action(slug, rule['action'])
        if not rule:
            raise CloudflareError('No updatable fields provided')
        res = client.update_ruleset_rule(zone.provider_zone_id, ruleset_id, rule_id, rule)
        if not res.get('success'):
            cls._record(zone, slug, 'update-rule', rule_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to update rule')}
        cls._record(zone, slug, 'update-rule', rule_id)
        return {'success': True, 'result': res.get('result')}

    @classmethod
    def delete_rule(cls, zone_id, slug, ruleset_id, rule_id):
        cls._resolve_rule_phase(slug)
        zone, client = cls._zone_and_client(zone_id)
        res = client.delete_ruleset_rule(zone.provider_zone_id, ruleset_id, rule_id)
        if not res.get('success'):
            cls._record(zone, slug, 'delete-rule', rule_id, 'error', res.get('error'))
            return {'success': False, 'error': res.get('error', 'Failed to delete rule')}
        cls._record(zone, slug, 'delete-rule', rule_id)
        return {'success': True}

    # ── Activity (local ops ledger) ───────────────────────────────────────────

    @classmethod
    def list_activity(cls, zone_id, product=None, result=None, limit=100):
        """The per-zone Cloudflare-ops change ledger, newest first."""
        zone, _ = cls._zone_and_client(zone_id)
        from app.services.cf_ops_change_service import CfOpsChangeService
        rows = CfOpsChangeService.list(
            provider_zone_id=zone.provider_zone_id,
            product=product, result=result, limit=limit)
        return {'success': True, 'zone': cls._zone_dict(zone),
                'changes': [r.to_dict() for r in rows]}

    # ── Token scope diagnosability ────────────────────────────────────────────

    @classmethod
    def scope_check(cls, zone_id):
        """Probe each product with a cheap read and report
        ``{product: ok|missing_scope|error}`` — round 2 is exactly where DNS-only
        tokens start failing."""
        zone, client = cls._zone_and_client(zone_id)

        def classify(res):
            if res.get('success'):
                return 'ok'
            return 'missing_scope' if cls._is_scope_error(res.get('error')) else 'error'

        products = {
            'dns': classify(client.list_records(zone.provider_zone_id)),
            'settings': classify(client.get_zone_settings(zone.provider_zone_id)),
            'dnssec': classify(client.get_dnssec(zone.provider_zone_id)),
            'waf': classify(client.list_rulesets(zone.provider_zone_id)),
            'origin_ca': classify(client.list_origin_certificates(
                zone.provider_zone_id, service_key=cls._origin_ca_service_key(zone))),
        }
        try:
            account_id = cls._account_id(zone, client)
        except CloudflareError:
            account_id = None
        if account_id:
            products['workers'] = classify(client.list_worker_scripts(account_id))
            products['tunnels'] = classify(client.list_tunnels(account_id))
            products['storage'] = classify(client.list_r2_buckets(account_id))
        else:
            products['workers'] = products['tunnels'] = products['storage'] = 'missing_scope'
        return {'success': True, 'zone': cls._zone_dict(zone), 'products': products}
