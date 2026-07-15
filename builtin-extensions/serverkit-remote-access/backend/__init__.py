"""ServerKit Remote Access extension backend package (WireGuard tunnels).

Extracted from core (plan 47): the tunnels blueprint + broker/publish/netutil
services ship here so a fresh panel that never exposes a NAT'd service loads none
of it. Mounted under ``/api/v1/tunnels`` via the manifest's ``url_prefix``. The
Tunnel / ExposedService models stay in core (G2); this package imports them.
Core's agent gateway reaches TunnelBrokerService.schedule_reconcile through
``plugin_service.get_installed_extension_attr`` only when the extension is
installed. Upgrades re-acquire it automatically (``CONVERTED_BUILTIN_SLUGS``).
"""
from .tunnels import tunnels_bp

__all__ = ['tunnels_bp']
