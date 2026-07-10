"""Appliance-tier typed L4 port publishes (plan 35).

Ports declared in a serverkit.yaml ``ports:`` list are persisted as a JSON list
on ``Application.ports`` and rendered as raw docker publishes at deploy time.
Public ports also open a firewall rule on the panel host; deleting the app (or
clearing its ports) closes them. A NULL ``Application.ports`` means "no raw
ports declared" — legacy apps keep the scalar ``port`` column + the nginx vhost.

Backed by the JSON column added in migration 070 (not a separate table).
"""

import json
from typing import Any, Dict, List

from app.models.application import Application  # noqa: F401  (kept for callers/tests)


class AppPortService:
    """Read/write + render the typed port publishes for an application."""

    # -- persistence --------------------------------------------------------

    @staticmethod
    def get_ports(app) -> List[Dict[str, Any]]:
        """The persisted, normalized port list for ``app`` ([] when none)."""
        raw = getattr(app, 'ports', None)
        if not raw:
            return []
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            return []
        return data if isinstance(data, list) else []

    @classmethod
    def set_ports(cls, app, ports: List[Dict[str, Any]]) -> None:
        """Persist the port list onto the app row (NULL when empty)."""
        cleaned = [cls._clean(p) for p in (ports or []) if p]
        app.ports = json.dumps(cleaned) if cleaned else None

    @staticmethod
    def _clean(p: Dict[str, Any]) -> Dict[str, Any]:
        host = p.get('host_port') if p.get('host_port') is not None else p.get('port')
        container = (p.get('container_port') if p.get('container_port') is not None
                     else p.get('containerPort'))
        if container is None:
            container = host
        return {
            'host_port': host,
            'container_port': container,
            'protocol': (p.get('protocol') or 'tcp').lower(),
            'expose': (p.get('expose') or 'public').lower(),
        }

    @classmethod
    def public_ports(cls, ports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [c for c in (cls._clean(p) for p in (ports or [])) if c['expose'] == 'public']

    # -- compose emission ---------------------------------------------------

    @classmethod
    def compose_ports(cls, ports: List[Dict[str, Any]]) -> List[str]:
        """Docker-compose short-syntax publish strings for the raw L4 ports.

        ``public`` binds 0.0.0.0 (the shipped-builtin precedent); ``local``
        binds 127.0.0.1 (the WP-multidev precedent); ``/udp`` suffix for udp.
        """
        out: List[str] = []
        for p in ports or []:
            c = cls._clean(p)
            if c['host_port'] is None:
                continue
            bind = '0.0.0.0' if c['expose'] == 'public' else '127.0.0.1'
            spec = f"{bind}:{c['host_port']}:{c['container_port']}"
            if c['protocol'] == 'udp':
                spec += '/udp'
            out.append(spec)
        return out

    # -- firewall -----------------------------------------------------------

    @classmethod
    def open_firewall(cls, ports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Open a firewall rule for each PUBLIC port on the panel host."""
        return cls._firewall('add_rule', ports)

    @classmethod
    def close_firewall(cls, ports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Close the firewall rule for each PUBLIC port on the panel host."""
        return cls._firewall('remove_rule', ports)

    @classmethod
    def _firewall(cls, verb: str, ports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        from app.services.firewall_service import FirewallService
        results: List[Dict[str, Any]] = []
        for p in cls.public_ports(ports):
            try:
                res = getattr(FirewallService, verb)(
                    'port', port=p['host_port'], protocol=p['protocol'])
            except Exception as exc:  # firewall is best-effort, never fatal here
                res = {'success': False, 'error': str(exc)}
            results.append({'port': p['host_port'], 'protocol': p['protocol'], 'result': res})
        return results
