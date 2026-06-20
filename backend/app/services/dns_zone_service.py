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
        if data.get('provider_config'):
            zone.provider_config = data['provider_config']

        db.session.add(zone)
        db.session.commit()
        return zone

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
        """Sync a DNS record change to the configured provider."""
        provider = zone.provider
        config = zone.provider_config

        try:
            if provider == 'cloudflare':
                DNSZoneService._cloudflare_sync(zone, record, action, config)
        except Exception as e:
            logger.error(f'DNS provider sync failed: {e}')

    @staticmethod
    def _cloudflare_sync(zone, record, action, config):
        """Sync record to Cloudflare API."""
        import requests
        from app.services.dns_provider_service import DNSProviderService

        api_token = config.get('api_token')
        if not api_token:
            return

        headers = {'Authorization': f'Bearer {api_token}', 'Content-Type': 'application/json'}
        base_url = f'https://api.cloudflare.com/client/v4/zones/{zone.provider_zone_id}/dns_records'

        def _payload():
            # CAA needs Cloudflare's structured `data` object, not a flat
            # `content` string (and `proxied` is meaningless for it).
            p = {'type': record.record_type, 'name': record.name, 'ttl': record.ttl}
            if record.record_type == 'CAA':
                p['data'] = DNSProviderService.parse_caa_value(record.content)
            else:
                p['content'] = record.content
                p['proxied'] = record.proxied
            if record.priority is not None:
                p['priority'] = record.priority
            return p

        if action == 'create':
            resp = requests.post(base_url, json=_payload(), headers=headers, timeout=10)
            if resp.ok:
                data = resp.json()
                record.provider_record_id = data.get('result', {}).get('id')
                db.session.commit()

        elif action == 'update' and record.provider_record_id:
            url = f'{base_url}/{record.provider_record_id}'
            requests.put(url, json=_payload(), headers=headers, timeout=10)

        elif action == 'delete' and record.provider_record_id:
            url = f'{base_url}/{record.provider_record_id}'
            requests.delete(url, headers=headers, timeout=10)
