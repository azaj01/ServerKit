"""One-time setup that makes managed subdomains HTTPS.

Creates the wildcard DNS record (``*.<base_domain>``) via a connected provider
and issues a wildcard Let's Encrypt certificate over DNS-01 reusing that
provider's credentials. Once the cert exists, ``sites_https_enabled`` flips on
and managed subdomain vhosts serve TLS from it (see SiteDomainService and
NginxService.create_site's ssl args).
"""
from app.models.email import DNSProviderConfig
from app.services.advanced_ssl_service import AdvancedSSLService
from app.services.dns_provider_service import DNSProviderService
from app.services.settings_service import SettingsService
from app.services.site_domain_service import SiteDomainService


class SitesHttpsService:

    @classmethod
    def status(cls):
        """Current managed-sites routing/HTTPS configuration."""
        return {
            'base_domain': SiteDomainService.base_domain(),
            'server_ip': SiteDomainService.server_ip(),
            'https_enabled': SiteDomainService.https_enabled(),
            'providers': DNSProviderService.list_providers(),
        }

    @classmethod
    def setup(cls, provider_id, email=None):
        """Create ``*.<base>`` + ``<base>`` A records and issue the wildcard cert.

        Requires a configured base domain and a connected DNS provider. The
        server IP is needed to create the A records; without it the cert can
        still be issued (DNS-01 doesn't need them) but traffic won't route until
        the records exist — surfaced as a warning rather than a failure.
        """
        base = SiteDomainService.base_domain()
        if not base:
            return {'success': False, 'error': 'Set the sites base domain first (Settings).'}

        config = DNSProviderConfig.query.get(provider_id) if provider_id else None
        if not config:
            return {'success': False, 'error': 'A connected DNS provider is required to issue the wildcard certificate.'}

        warnings = []
        ip = SiteDomainService.server_ip()
        dns = {}
        if ip:
            dns['wildcard'] = DNSProviderService.ensure_a_record(f'*.{base}', ip)
            dns['apex'] = DNSProviderService.ensure_a_record(base, ip)
            for r in dns.values():
                if not r.get('created'):
                    warnings.append(r.get('message') or 'A record not created.')
        else:
            warnings.append(f'No server public IP set — add the *.{base} and {base} A records manually (or set the IP in Settings).')

        creds_src = DNSProviderService.decrypted_credentials(config)
        creds = ({'api_token': creds_src['api_key']} if config.provider == 'cloudflare'
                 else {'api_key': creds_src['api_key'], 'api_secret': creds_src['api_secret']})
        cert = AdvancedSSLService.issue_wildcard_cert(base, config.provider, creds, email=email)
        if not cert.get('success'):
            return {'success': False, 'error': f"Wildcard certificate failed: {cert.get('error')}",
                    'dns': dns, 'ssl': cert, 'warning': '; '.join(warnings) if warnings else None}

        SettingsService.set('sites_https_enabled', True)

        return {'success': True, 'base_domain': base, 'https_enabled': True,
                'dns': dns, 'ssl': cert, 'cert_path': cert.get('certificate_path'),
                'warning': '; '.join(warnings) if warnings else None}
