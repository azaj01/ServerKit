"""The single Cloudflare DNS API client used by every Cloudflare path in ServerKit.

Centralizes, in one place:

* **auth** — scoped API token (``Authorization: Bearer``) *or* global key
  (``X-Auth-Email`` + ``X-Auth-Key``),
* the **CAA** structured-``data`` wire format (Cloudflare rejects a flat
  ``content`` string for CAA),
* **MX/SRV priority** parsing (a leading integer in the value), and
* **idempotent upsert** — update an existing record (by id when known, else by
  name) instead of blindly POSTing a duplicate.

Both ``DNSProviderService`` (provider layer) and ``DNSZoneService`` (zone layer)
delegate here, so a wire-format fix is made once rather than twice.
"""
import logging

import requests

from app.services.dns.base import DnsCredential, DnsRecordSpec

logger = logging.getLogger(__name__)

API_BASE = 'https://api.cloudflare.com/client/v4'


def parse_caa_value(value: str) -> dict:
    """Parse a BIND-style CAA value (``0 issue "letsencrypt.org"``) into the
    ``{flags, tag, value}`` object Cloudflare expects. The CA value is unquoted.
    Kept here so the CAA wire format lives in exactly one place."""
    parts = (value or '').strip().split(None, 2)
    flags = int(parts[0]) if parts and parts[0].lstrip('-').isdigit() else 0
    tag = parts[1] if len(parts) > 1 else 'issue'
    ca = parts[2].strip().strip('"') if len(parts) > 2 else ''
    return {'flags': flags, 'tag': tag, 'value': ca}


def _first_error(data: dict) -> str:
    try:
        return (data.get('errors') or [{}])[0].get('message', 'Unknown error')
    except Exception:
        return 'Unknown error'


class CloudflareClient:
    """Stateless wrapper around the Cloudflare v4 DNS API for one credential."""

    def __init__(self, credential: DnsCredential):
        self.cred = credential

    # ── auth ────────────────────────────────────────────────────────────────
    def _headers(self) -> dict:
        if self.cred.email:
            return {
                'X-Auth-Email': self.cred.email,
                'X-Auth-Key': self.cred.token or '',
                'Content-Type': 'application/json',
            }
        return {
            'Authorization': f'Bearer {self.cred.token or ""}',
            'Content-Type': 'application/json',
        }

    # ── connection / zones ──────────────────────────────────────────────────
    def verify(self) -> dict:
        """Verify the credential (token scope check)."""
        try:
            resp = requests.get(f'{API_BASE}/user/tokens/verify',
                                headers=self._headers(), timeout=15)
            data = resp.json()
            if data.get('success'):
                return {'success': True, 'message': 'Cloudflare connection successful'}
            return {'success': False, 'error': _first_error(data)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def list_zones(self) -> dict:
        """List the zones this credential can manage."""
        try:
            resp = requests.get(f'{API_BASE}/zones?per_page=50',
                                headers=self._headers(), timeout=15)
            data = resp.json()
            if not data.get('success'):
                return {'success': False, 'error': _first_error(data) or 'Failed to list zones'}
            zones = [{'id': z['id'], 'name': z['name'], 'status': z['status']}
                     for z in data.get('result', [])]
            return {'success': True, 'zones': zones}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def list_records(self, zone_id: str) -> dict:
        """List every record in a zone (paginated) — the live state the mirror
        classifies into ServerKit-owned vs the user's own records."""
        try:
            out, page = [], 1
            while True:
                resp = requests.get(
                    f'{API_BASE}/zones/{zone_id}/dns_records?per_page=100&page={page}',
                    headers=self._headers(), timeout=15)
                data = resp.json()
                if not data.get('success'):
                    return {'success': False, 'error': _first_error(data)}
                for r in data.get('result', []):
                    out.append({
                        'id': r.get('id'),
                        'type': r.get('type'),
                        'name': r.get('name'),
                        'content': r.get('content', ''),
                        'ttl': r.get('ttl'),
                        'proxied': bool(r.get('proxied', False)),
                        'priority': r.get('priority'),
                    })
                info = data.get('result_info') or {}
                if page >= (info.get('total_pages') or 1):
                    break
                page += 1
            return {'success': True, 'records': out}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ── records ─────────────────────────────────────────────────────────────
    def _payload(self, spec: DnsRecordSpec) -> dict:
        """Render a record spec into a Cloudflare ``dns_records`` payload."""
        payload = {'type': spec.record_type, 'name': spec.name, 'ttl': spec.ttl}

        # CAA needs Cloudflare's structured `data` object, not a flat `content`
        # string (and `proxied`/`priority` are meaningless for it).
        if spec.record_type == 'CAA':
            payload['data'] = parse_caa_value(spec.content)
            return payload

        content, priority = spec.content, spec.priority
        # MX/SRV may carry a leading priority in the value ("10 mail.example.com")
        # — split it out so Cloudflare gets a separate `priority` field.
        if spec.record_type in ('MX', 'SRV') and priority is None:
            head, _, rest = (spec.content or '').strip().partition(' ')
            if head.isdigit() and rest.strip():
                priority, content = int(head), rest.strip()

        payload['content'] = content
        payload['proxied'] = bool(spec.proxied)
        if priority is not None:
            payload['priority'] = priority
        return payload

    def find_record_id(self, zone_id: str, record_type: str, name: str,
                       caa: dict = None):
        """Return the id of an existing record matching ``type``+``name`` (and, for
        CAA, the same CA), or ``None``. CAA is matched on tag+value so a *different*
        CA's authorization is never clobbered."""
        resp = requests.get(
            f'{API_BASE}/zones/{zone_id}/dns_records?type={record_type}&name={name}',
            headers=self._headers(), timeout=15,
        )
        existing = (resp.json() or {}).get('result', []) or []
        if caa is not None:
            existing = [
                r for r in existing
                if (r.get('data') or {}).get('tag') == caa['tag']
                and str((r.get('data') or {}).get('value', '')).strip('"').rstrip('.').lower()
                    == caa['value'].rstrip('.').lower()
            ]
        return existing[0]['id'] if existing else None

    def upsert(self, zone_id: str, spec: DnsRecordSpec, record_id: str = None) -> dict:
        """Create or update a record idempotently.

        If ``record_id`` is known, PUT it directly; otherwise look up a matching
        record by name and PUT it, else POST a new one. Returns
        ``{success, record_id?, error?}`` so callers can persist the id.
        """
        try:
            base = f'{API_BASE}/zones/{zone_id}/dns_records'
            payload = self._payload(spec)

            if record_id is None:
                caa = payload.get('data') if spec.record_type == 'CAA' else None
                record_id = self.find_record_id(zone_id, spec.record_type, spec.name, caa=caa)

            if record_id:
                resp = requests.put(f'{base}/{record_id}', headers=self._headers(),
                                    json=payload, timeout=15)
            else:
                resp = requests.post(base, headers=self._headers(),
                                     json=payload, timeout=15)

            data = resp.json()
            if data.get('success'):
                rid = (data.get('result') or {}).get('id') or record_id
                return {'success': True, 'record_id': rid,
                        'message': f'{spec.record_type} record set for {spec.name}'}
            return {'success': False, 'error': _first_error(data)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def delete(self, zone_id: str, *, record_id: str = None,
               record_type: str = None, name: str = None) -> dict:
        """Delete by ``record_id`` when known, else by ``type``+``name`` (removes
        every match). A missing record is treated as success (already gone)."""
        try:
            base = f'{API_BASE}/zones/{zone_id}/dns_records'
            if record_id:
                ids = [record_id]
            else:
                resp = requests.get(f'{base}?type={record_type}&name={name}',
                                    headers=self._headers(), timeout=15)
                ids = [r['id'] for r in (resp.json() or {}).get('result', []) or []]
                if not ids:
                    return {'success': True, 'message': 'Record not found (already deleted)'}
            for rid in ids:
                requests.delete(f'{base}/{rid}', headers=self._headers(), timeout=15)
            return {'success': True, 'message': 'Record deleted'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
