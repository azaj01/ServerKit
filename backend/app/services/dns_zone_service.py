import json
import logging
from datetime import datetime
from app import db
from app.models.dns_zone import DNSZone, DNSRecord

logger = logging.getLogger(__name__)


class DNSZoneService:
    """Service for DNS zone and record management."""

    RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS']

    DNS_PRESETS = {
        'web-hosting': {
            'label': 'Standard Web Hosting',
            'records': [
                {'record_type': 'A', 'name': '@', 'content': '{{server_ip}}', 'ttl': 3600},
                {'record_type': 'A', 'name': 'www', 'content': '{{server_ip}}', 'ttl': 3600},
                {'record_type': 'CNAME', 'name': 'mail', 'content': '{{domain}}', 'ttl': 3600},
                # Authorize only Let's Encrypt (what ServerKit issues with) to mint
                # certs for this domain. Satisfies CAA scanners and blocks rogue CAs.
                {'record_type': 'CAA', 'name': '@', 'content': '0 issue "letsencrypt.org"', 'ttl': 3600},
            ],
        },
        'email-hosting': {
            'label': 'Email Hosting',
            'records': [
                {'record_type': 'MX', 'name': '@', 'content': 'mail.{{domain}}', 'priority': 10, 'ttl': 3600},
                {'record_type': 'TXT', 'name': '@', 'content': 'v=spf1 mx -all', 'ttl': 3600},
                {'record_type': 'TXT', 'name': '_dmarc', 'content': 'v=DMARC1; p=quarantine; rua=mailto:dmarc@{{domain}}', 'ttl': 3600},
            ],
        },
    }

    @staticmethod
    def list_zones():
        return DNSZone.query.order_by(DNSZone.domain).all()

    @staticmethod
    def get_zone(zone_id):
        return DNSZone.query.get(zone_id)

    @staticmethod
    def create_zone(data):
        domain = data.get('domain', '').strip().lower()
        if not domain:
            raise ValueError('Domain required')
        if DNSZone.query.filter_by(domain=domain).first():
            raise ValueError(f'Zone for {domain} already exists')

        zone = DNSZone(
            domain=domain,
            provider=data.get('provider', 'manual'),
            provider_zone_id=data.get('provider_zone_id'),
        )

        # Preferred path: link an existing connection (Settings -> Connections).
        # The zone adopts its provider, and we look up the provider-side zone id
        # for this domain so records sync without a second token.
        config_id = data.get('dns_provider_config_id')
        if config_id:
            from app.models.email import DNSProviderConfig
            from app.services.dns_provider_service import DNSProviderService
            config = DNSProviderConfig.query.get(int(config_id))
            if not config:
                raise ValueError('Selected DNS connection not found')
            zone.provider = config.provider
            zone.dns_provider_config_id = config.id
            if not zone.provider_zone_id:
                zres = DNSProviderService.list_zones(config.id)
                if not zres.get('success'):
                    raise ValueError(
                        f"Couldn't reach {config.name}: {zres.get('error', 'unknown error')}")
                match = next((z for z in zres.get('zones', [])
                              if (z.get('name') or '').lower().rstrip('.') == domain), None)
                if not match:
                    raise ValueError(f'{config.name} does not manage {domain}')
                zone.provider_zone_id = match['id']
        elif data.get('provider_config'):
            # Legacy inline-token path, kept for backward compatibility.
            zone.provider_config = data['provider_config']

        db.session.add(zone)
        db.session.commit()
        return zone

    @classmethod
    def link_legacy_zones(cls):
        """One-time, idempotent: migrate Cloudflare zones that still carry an inline
        token in ``provider_config_json`` onto the canonical ``DNSProviderConfig``
        store, so every zone resolves its credentials the same way.

        For each such zone: reuse an existing connection whose decrypted key matches
        the token, else mint one (encrypted at rest), link it, and strip the now
        redundant plaintext token from the zone. API-free — uses the token already
        on the zone. Returns the number of zones migrated."""
        from app.models.email import DNSProviderConfig
        from app.services.dns_provider_service import DNSProviderService
        from app.utils.crypto import encrypt_secret

        migrated = 0
        zones = DNSZone.query.filter(
            DNSZone.provider == 'cloudflare',
            DNSZone.dns_provider_config_id.is_(None),
        ).all()
        for zone in zones:
            token = (zone.provider_config or {}).get('api_token')
            if not token:
                continue
            match = None
            for cfg in DNSProviderConfig.query.filter_by(provider='cloudflare').all():
                if DNSProviderService._api_key(cfg) == token:
                    match = cfg
                    break
            if match is None:
                match = DNSProviderConfig(
                    name=f'Cloudflare ({zone.domain})',
                    provider='cloudflare',
                    api_key=encrypt_secret(token),
                )
                db.session.add(match)
                db.session.flush()  # assign id
            zone.dns_provider_config_id = match.id
            cfg_json = dict(zone.provider_config or {})
            cfg_json.pop('api_token', None)
            zone.provider_config = cfg_json
            migrated += 1
        if migrated:
            db.session.commit()
        return migrated

    @staticmethod
    def delete_zone(zone_id):
        zone = DNSZone.query.get(zone_id)
        if not zone:
            return False
        db.session.delete(zone)
        db.session.commit()
        return True

    # --- Records ---

    @staticmethod
    def get_records(zone_id):
        return DNSRecord.query.filter_by(zone_id=zone_id).order_by(
            DNSRecord.record_type, DNSRecord.name
        ).all()

    @staticmethod
    def list_provider_records(zone):
        """The live provider record list for a zone, each tagged ``serverkit`` or
        ``external`` — so the UI can show everything in the user's zone while making
        clear which records ServerKit owns (and may touch) vs the user's own."""
        if zone.provider != 'cloudflare':
            return {'success': False, 'error': 'Mirror is only available for Cloudflare zones'}
        credential = DNSZoneService._resolve_credential(zone)
        if not credential:
            return {'success': False, 'error': 'No connected credential resolves for this zone'}

        from app.services.dns import CloudflareClient
        from app.services.dns_ownership_service import DnsOwnershipService

        res = CloudflareClient(credential).list_records(zone.provider_zone_id)
        if not res.get('success'):
            return res

        owned_ids, owned_keys = DnsOwnershipService.owned_keys(zone.provider_zone_id)
        records = []
        for r in res['records']:
            owned = (r['id'] in owned_ids) or \
                ((r['type'], (r['name'] or '').lower().rstrip('.')) in owned_keys)
            records.append({**r, 'managed_by': 'serverkit' if owned else 'external'})
        return {
            'success': True,
            'records': records,
            'counts': {
                'serverkit': sum(1 for x in records if x['managed_by'] == 'serverkit'),
                'external': sum(1 for x in records if x['managed_by'] == 'external'),
            },
        }

    @staticmethod
    def create_record(zone_id, data):
        zone = DNSZone.query.get(zone_id)
        if not zone:
            raise ValueError('Zone not found')

        record_type = data.get('record_type', '').upper()
        if record_type not in DNSZoneService.RECORD_TYPES:
            raise ValueError(f'Invalid record type: {record_type}')

        record = DNSRecord(
            zone_id=zone_id,
            record_type=record_type,
            name=data.get('name', '@'),
            content=data.get('content', ''),
            ttl=data.get('ttl', 3600),
            priority=data.get('priority'),
            proxied=data.get('proxied', False),
        )
        db.session.add(record)
        db.session.commit()

        # Sync to provider if configured
        if zone.provider != 'manual':
            DNSZoneService._sync_record_to_provider(zone, record, 'create')

        return record

    @staticmethod
    def update_record(record_id, data):
        record = DNSRecord.query.get(record_id)
        if not record:
            return None
        for field in ['name', 'content', 'ttl', 'priority', 'proxied']:
            if field in data:
                setattr(record, field, data[field])
        db.session.commit()

        zone = record.zone
        if zone.provider != 'manual':
            DNSZoneService._sync_record_to_provider(zone, record, 'update')

        return record

    @staticmethod
    def delete_record(record_id):
        record = DNSRecord.query.get(record_id)
        if not record:
            return False
        zone = record.zone
        if zone.provider != 'manual' and record.provider_record_id:
            DNSZoneService._sync_record_to_provider(zone, record, 'delete')
        db.session.delete(record)
        db.session.commit()
        return True

    @staticmethod
    def apply_preset(zone_id, preset_key, variables=None):
        if preset_key not in DNSZoneService.DNS_PRESETS:
            raise ValueError(f'Unknown preset: {preset_key}')

        zone = DNSZone.query.get(zone_id)
        if not zone:
            raise ValueError('Zone not found')

        preset = DNSZoneService.DNS_PRESETS[preset_key]
        variables = variables or {}
        variables.setdefault('domain', zone.domain)

        records = []
        for rec_data in preset['records']:
            data = dict(rec_data)
            for field in ['name', 'content']:
                for var_name, var_val in variables.items():
                    data[field] = data[field].replace('{{' + var_name + '}}', var_val)
            record = DNSZoneService.create_record(zone_id, data)
            records.append(record)

        return records

    @staticmethod
    def check_propagation(domain, record_type='A'):
        """Check DNS propagation across multiple nameservers."""
        import socket

        nameservers = [
            ('Google', '8.8.8.8'),
            ('Cloudflare', '1.1.1.1'),
            ('OpenDNS', '208.67.222.222'),
            ('Quad9', '9.9.9.9'),
        ]

        results = []
        for ns_name, ns_ip in nameservers:
            try:
                from app.utils.system import run_command
                result = run_command(['dig', f'@{ns_ip}', domain, record_type, '+short'], timeout=5)
                stdout = result.get('stdout', '').strip()
                results.append({
                    'nameserver': ns_name,
                    'ip': ns_ip,
                    'result': stdout.split('\n') if stdout else [],
                    'propagated': bool(stdout),
                })
            except Exception:
                results.append({
                    'nameserver': ns_name,
                    'ip': ns_ip,
                    'result': [],
                    'propagated': False,
                    'error': 'Query failed',
                })

        return results

    @staticmethod
    def export_zone(zone_id):
        """Export zone in BIND format."""
        zone = DNSZone.query.get(zone_id)
        if not zone:
            return None

        records = DNSZoneService.get_records(zone_id)
        lines = [f'; Zone file for {zone.domain}', f'$ORIGIN {zone.domain}.', f'$TTL 3600', '']

        for rec in records:
            name = rec.name if rec.name != '@' else zone.domain + '.'
            if rec.record_type == 'MX':
                lines.append(f'{name}\t{rec.ttl}\tIN\t{rec.record_type}\t{rec.priority or 10}\t{rec.content}')
            elif rec.record_type == 'SRV':
                lines.append(f'{name}\t{rec.ttl}\tIN\t{rec.record_type}\t{rec.priority or 0}\t{rec.content}')
            else:
                lines.append(f'{name}\t{rec.ttl}\tIN\t{rec.record_type}\t{rec.content}')

        return '\n'.join(lines)

    @staticmethod
    def import_zone(zone_id, bind_content):
        """Import records from BIND zone file format."""
        zone = DNSZone.query.get(zone_id)
        if not zone:
            raise ValueError('Zone not found')

        records_created = []
        for line in bind_content.strip().split('\n'):
            line = line.strip()
            if not line or line.startswith(';') or line.startswith('$'):
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            # Try to parse: name ttl IN type content
            try:
                if parts[2] == 'IN':
                    name = parts[0].rstrip('.')
                    ttl = int(parts[1])
                    rtype = parts[3]
                    content = ' '.join(parts[4:])
                    if name == zone.domain:
                        name = '@'
                    record = DNSZoneService.create_record(zone_id, {
                        'record_type': rtype, 'name': name,
                        'content': content, 'ttl': ttl,
                    })
                    records_created.append(record)
            except (ValueError, IndexError):
                continue

        return records_created

    @staticmethod
    def get_presets():
        return DNSZoneService.DNS_PRESETS

    @staticmethod
    def _sync_record_to_provider(zone, record, action):
        """Sync a DNS record change to Cloudflare (the only provider the zone layer
        syncs — Route53/DigitalOcean/GoDaddy are managed via DNSProviderService)."""
        if zone.provider != 'cloudflare':
            return
        credential = DNSZoneService._resolve_credential(zone)
        if not credential:
            return
        try:
            DNSZoneService._cloudflare_sync(zone, record, action, credential)
        except Exception as e:
            logger.error(f'DNS provider sync failed: {e}')

    @staticmethod
    def _resolve_credential(zone):
        """Resolve the Cloudflare credential for a zone, preferring the canonical
        connection store and persisting the discovered link.

        Order:
          1. The linked DNSProviderConfig (``zone.dns_provider_config_id``).
          2. Auto-discovery — the connected provider whose account contains this
             domain; the link + ``provider_zone_id`` are backfilled so step 1 wins
             next time (no repeat API call).
          3. Legacy fallback — a token still stored inline on the zone.
        Returns a :class:`DnsCredential`, or ``None`` when nothing manages the zone.
        """
        from app.models.email import DNSProviderConfig
        from app.services.dns_provider_service import DNSProviderService
        from app.services.dns.base import DnsCredential

        if zone.dns_provider_config_id:
            config = DNSProviderConfig.query.get(zone.dns_provider_config_id)
            if config:
                return DnsCredential.from_provider_config(config)

        try:
            config, zinfo = DNSProviderService.find_zone_for_domain(zone.domain)
        except Exception:
            config, zinfo = None, None
        if config:
            zone.dns_provider_config_id = config.id
            if zinfo and not zone.provider_zone_id:
                zone.provider_zone_id = zinfo.get('id')
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
            return DnsCredential.from_provider_config(config)

        token = (zone.provider_config or {}).get('api_token')
        if token:
            return DnsCredential.cloudflare_token(token)
        return None

    @staticmethod
    def _cloudflare_sync(zone, record, action, credential):
        """Push a single record change to Cloudflare via the shared client, gated by
        the ownership ledger.

        ``upsert`` is idempotent (updates by ``provider_record_id`` when known, else
        by name). The Zones page is explicit zone management, so it adopts a matching
        record and records ServerKit ownership (``allow_foreign=True``)."""
        from app.services.dns import CloudflareClient
        from app.services.dns.base import DnsRecordSpec
        from app.services.dns_ownership_service import DnsOwnershipService

        client = CloudflareClient(credential)
        zone_id = zone.provider_zone_id

        if action in ('create', 'update'):
            res = DnsOwnershipService.guarded_upsert(
                client, provider='cloudflare', provider_zone_id=zone_id,
                spec=DnsRecordSpec.from_record(record), source='zone',
                config_id=zone.dns_provider_config_id,
                known_record_id=record.provider_record_id, allow_foreign=True)
            if res.get('success'):
                rid = res.get('record_id')
                if rid and rid != record.provider_record_id:
                    record.provider_record_id = rid
                    db.session.commit()
            else:
                logger.error('Cloudflare sync %s failed for %s: %s',
                             action, record.name, res.get('error'))
        elif action == 'delete' and record.provider_record_id:
            DnsOwnershipService.guarded_delete(
                client, provider_zone_id=zone_id, record_type=record.record_type,
                name=record.name, provider_record_id=record.provider_record_id)
