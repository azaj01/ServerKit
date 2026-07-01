"""Resolve the public address of a managed site.

A bare published port (``127.0.0.1:8300``) is reachable on the box but is
useless as a public website URL. Instead every managed site is given a real
hostname ``<slug>.<base_domain>`` and the operator points a single wildcard DNS
record (``*.<base_domain>``) at the server — so a new site is reachable the
moment it is created, with no per-site DNS work.

The base domain is a one-time operator setting (``system_settings`` key
``sites_base_domain``), falling back to ``SITES_BASE_DOMAIN`` in config. In
development that defaults to ``lvh.me``, a public resolver that maps
``*.lvh.me -> 127.0.0.1``, so subdomain routing can be exercised locally with
zero DNS setup. When no base domain is configured the helpers return ``None``
and callers fall back to the legacy ``localhost:<port>`` behaviour.
"""
from flask import current_app

from app.models.system_settings import SystemSettings
from app.utils.slug import slugify as _slugify


class SiteDomainService:
    DEFAULT_BASE_DOMAIN = 'lvh.me'

    @classmethod
    def base_domain(cls):
        """The configured base domain, or '' when site routing is not set up.

        Prefers the runtime setting (editable in-app) over the config default so
        an operator can change it without redeploying.
        """
        val = SystemSettings.get('sites_base_domain')
        if val:
            return str(val).strip().lstrip('.').lower()
        return (current_app.config.get('SITES_BASE_DOMAIN') or '').strip().lstrip('.').lower()

    @classmethod
    def server_ip(cls):
        """Public IP that wildcard/custom A-records should point at (Phase 3)."""
        return SystemSettings.get('server_public_ip') or current_app.config.get('SERVER_PUBLIC_IP') or None

    @classmethod
    def panel_origin(cls):
        """Canonical public origin of the ServerKit panel, or None when no
        canonical domain is configured.

        Uses the persisted canonical_domain / canonical_https_enabled settings.
        Falls back to PUBLIC_URL / SERVERKIT_PUBLIC_URL env vars, then to the
        sites base domain. Returns None if nothing usable is configured.
        """
        domain = SystemSettings.get('canonical_domain')
        if domain:
            https = bool(SystemSettings.get('canonical_https_enabled', False))
            return f'https://{domain}' if https else f'http://{domain}'

        url = current_app.config.get('PUBLIC_URL') or current_app.config.get('SERVERKIT_PUBLIC_URL')
        if url:
            return url.rstrip('/')

        base = cls.base_domain()
        if base:
            return f'https://{base}' if cls.https_enabled() else f'http://{base}'

        return None

    @classmethod
    def https_enabled(cls):
        """True once the wildcard certificate for the base domain is set up, so
        managed subdomains should be served over HTTPS (Phase 5)."""
        return bool(SystemSettings.get('sites_https_enabled', False))

    @classmethod
    def wildcard_cert_paths(cls):
        """(fullchain, privkey) paths for the base domain's wildcard cert, or
        (None, None) when no base domain is configured."""
        base = cls.base_domain()
        if not base:
            return (None, None)
        return (f'/etc/letsencrypt/live/{base}/fullchain.pem',
                f'/etc/letsencrypt/live/{base}/privkey.pem')

    @classmethod
    def covers(cls, host):
        """Whether the base domain's wildcard cert covers ``host`` — i.e. host is
        the base domain or a direct subdomain of it."""
        base = cls.base_domain()
        if not base or not host:
            return False
        return host == base or host.endswith('.' + base)

    @staticmethod
    def slugify(name):
        """Turn a site name into a DNS-safe label (a-z, 0-9, single dashes)."""
        return _slugify(name) or 'site'

    @classmethod
    def subdomain_for(cls, name):
        """``<slug>.<base_domain>`` for a site name, or ``None`` when no base
        domain is configured (site routing disabled)."""
        base = cls.base_domain()
        if not base:
            return None
        return f'{cls.slugify(name)}.{base}'

    @classmethod
    def site_url(cls, host, ssl=False):
        """Canonical URL for a host. HTTP for now; the wildcard-cert phase flips
        managed subdomains to HTTPS."""
        scheme = 'https' if ssl else 'http'
        return f'{scheme}://{host}'

    @classmethod
    def dns_mode(cls):
        """How managed-site subdomains get their DNS:

        * ``wildcard`` (default) — one ``*.<base_domain>`` record covers every site,
          so a new site needs no per-site DNS work, and
        * ``per-site`` — each site gets its own A record, auto-created via a
          connected provider, so every site is an explicit, visible record.
        """
        val = (SystemSettings.get('sites_dns_mode') or '').strip().lower()
        return val if val in ('wildcard', 'per-site') else 'wildcard'

    @classmethod
    def ensure_site_dns(cls, host):
        """Auto-create a managed site's A record when in ``per-site`` mode (via a
        connected provider, ownership-guarded + logged). In ``wildcard`` mode this is
        a no-op — the single ``*.<base>`` record already covers ``host``. Never raises;
        returns the provider result (or a ``skipped``/``no_server_ip`` descriptor)."""
        if not host or cls.dns_mode() != 'per-site':
            return {'created': False, 'skipped': True, 'reason': 'wildcard'}
        ip = cls.server_ip()
        if not ip:
            return {'created': False, 'reason': 'no_server_ip',
                    'message': f'Set the server public IP to auto-create the {host} A record.'}
        try:
            from app.services.dns_provider_service import DNSProviderService
            return DNSProviderService.ensure_a_record(host, ip)
        except Exception as e:
            return {'created': False, 'reason': 'error', 'error': str(e)}

    @classmethod
    def _vhost_create_kwargs(cls, app, domains, ssl_cert, ssl_key, force_type=None):
        """Build ``NginxService.create_site(**kwargs)`` for ``app``, or
        ``(None, reason)`` when the app type can't be served by host nginx or is
        missing what it needs (a port for proxied apps, a root for served ones).

        ``force_type`` overrides the ``app_type`` → template choice — a managed
        WordPress site always proxies to its container port even though the row
        says ``wordpress`` (whose stock template is php-fpm, not a proxy).
        """
        t = (force_type or app.app_type or '').lower()
        base = dict(name=app.name, domains=domains, ssl_cert=ssl_cert, ssl_key=ssl_key)
        # Reverse-proxy to a local container/app port.
        if t in ('docker', 'wordpress'):
            if not app.port:
                return None, f'{t} app has no published port to route to.'
            return dict(base, app_type='docker', port=app.port), None
        if t in ('flask', 'django', 'python'):
            if not app.port:
                return None, f'{t} app has no published port to route to.'
            return dict(base, app_type=t, root_path=app.root_path or '', port=app.port), None
        # Serve from a filesystem root.
        if t == 'php':
            if not app.root_path:
                return None, 'php app has no root path to serve.'
            return dict(base, app_type='php', root_path=app.root_path,
                        php_version=(getattr(app, 'php_version', None) or '8.2')), None
        if t == 'static':
            if not app.root_path:
                return None, 'static app has no root path to serve.'
            return dict(base, app_type='static', root_path=app.root_path), None
        return None, f"app type '{t}' cannot be published via host nginx."

    @classmethod
    def write_app_vhost(cls, app, force_type=None):
        """(Re)write and enable the host-nginx vhost publishing ``app`` at every
        one of its Domain rows (``server_name`` = all domains).

        Handles all host-nginx app types: docker/wordpress and
        python/flask/django reverse-proxy to the app's port; php/static serve a
        filesystem root. Serves the base-domain wildcard cert when HTTPS is
        enabled and every domain is a covered subdomain (custom domains bring
        their own cert). Best-effort — never raises; returns ``{'nginx',
        'warning'}`` (``nginx`` is ``None`` when nothing was written).
        """
        from app.models.domain import Domain
        from app.services.nginx_service import NginxService

        domains = [d.name for d in Domain.query.filter_by(application_id=app.id).all()]
        if not domains:
            return {'nginx': None, 'warning': None}

        ssl_cert = ssl_key = None
        if cls.https_enabled() and all(cls.covers(d) for d in domains):
            ssl_cert, ssl_key = cls.wildcard_cert_paths()

        kwargs, reason = cls._vhost_create_kwargs(app, domains, ssl_cert, ssl_key, force_type)
        if reason:
            return {'nginx': None, 'warning': reason}

        try:
            res = NginxService.create_site(**kwargs)
        except Exception as e:
            return {'nginx': None, 'warning': str(e)}
        if not res.get('success'):
            return {'nginx': res, 'warning': f"nginx vhost not created: {res.get('error')}"}
        en = NginxService.enable_site(app.name)
        if not en.get('success'):
            return {'nginx': res, 'warning': f"vhost written but not enabled: {en.get('error')}"}
        return {'nginx': res, 'warning': None}

    @classmethod
    def give_subdomain(cls, app, label=None):
        """One-click 'give this app a subdomain': publish ``app`` at
        ``<label>.<base_domain>`` (label defaults to the app-name slug). Creates the
        primary Domain row, (re)writes its nginx vhost, and — in per-site DNS mode —
        auto-creates the A record (wildcard mode relies on ``*.<base>``).

        Returns ``{success, host, url, dns, nginx, warning}`` or
        ``{success: False, error}``.
        """
        from app import db
        from app.models.domain import Domain

        base = cls.base_domain()
        if not base:
            return {'success': False, 'error': 'Set the managed-sites base domain first (Settings).'}

        host = f'{cls.slugify(label or app.name)}.{base}'
        existing = Domain.query.filter_by(name=host).first()
        if existing and existing.application_id != app.id:
            return {'success': False, 'error': f'{host} is already used by another app.'}

        try:
            if not existing:
                make_primary = Domain.query.filter_by(
                    application_id=app.id, is_primary=True).first() is None
                if make_primary:
                    Domain.query.filter_by(application_id=app.id, is_primary=True).update(
                        {'is_primary': False})
                db.session.add(Domain(name=host, is_primary=make_primary, application_id=app.id))
                db.session.commit()
        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': f'Could not record domain: {e}'}

        # Publish the site: (re)write + enable its host-nginx vhost. Works for
        # every host-nginx app type (docker/wordpress/python proxy to the app
        # port; php/static serve a root), not just docker — a non-routable or
        # misconfigured app degrades to a warning rather than failing the publish.
        v = cls.write_app_vhost(app)
        nginx = v.get('nginx')
        warning = v.get('warning')

        dns = cls.ensure_site_dns(host)
        if dns and not dns.get('skipped') and not dns.get('created') and dns.get('message'):
            warning = (warning + '; ' + dns['message']) if warning else dns['message']

        return {'success': True, 'host': host,
                'url': cls.site_url(host, ssl=cls.https_enabled() and cls.covers(host)),
                'dns': dns, 'nginx': nginx, 'warning': warning}
