"""ServerKit Cloud Provisioning extension backend package.

Extracted from core (plan 47): the cloud-provider blueprint + service ship here
so a fresh panel that never provisions cloud servers loads none of it. Mounted
under ``/api/v1/cloud`` via the manifest's ``url_prefix``. The CloudProvider /
CloudServer models stay in core (G2); this package imports them. Upgrades
re-acquire it automatically (``CONVERTED_BUILTIN_SLUGS``).
"""
from .cloud_provisioning import cloud_provisioning_bp

__all__ = ['cloud_provisioning_bp']
