"""Render a v1 serverkit.yaml from an existing app's live config.

The reverse direction of the apply engine — the cheapest adoption path for
users who already have apps in the panel. Reads live state (Application row,
env vars, domains, volumes) and emits a committable manifest.
"""

import json
from typing import Any, Dict, List

import yaml

from app.models.application import Application
from app.services.env_service import EnvService


# Application.app_type -> manifest service `type`
_APP_TYPE_TO_MANIFEST = {
    'docker': 'docker',
    'static': 'static',
    'php': 'web',
    'wordpress': 'web',
    'flask': 'web',
    'django': 'web',
}

_SCHEMA_HEADER = (
    '# yaml-language-server: '
    '$schema=https://serverkit.dev/serverkit-yaml.schema.json\n'
)


class ManifestScaffoldService:
    """Build a v1 manifest dict / YAML string from a live Application."""

    @classmethod
    def scaffold_for_app(cls, app: Application) -> Dict[str, Any]:
        service: Dict[str, Any] = {
            'name': cls._slug(app.name),
            'type': _APP_TYPE_TO_MANIFEST.get(app.app_type, 'web'),
        }

        runtime = cls._runtime(app)
        if runtime:
            service['runtime'] = runtime
        if app.port:
            service['port'] = app.port

        # Appliance tier (plan 35): round-trip a BYO image + typed L4 ports.
        if getattr(app, 'docker_image', None):
            service['image'] = app.docker_image
        ports = cls._ports(app)
        if ports:
            service['ports'] = ports

        overrides = cls._json(app.buildpack_overrides)
        build_cmd = overrides.get('build_command') or overrides.get('buildCommand')
        start_cmd = overrides.get('start_command') or overrides.get('startCommand')
        if build_cmd:
            service['buildCommand'] = build_cmd
        if start_cmd:
            service['startCommand'] = start_cmd

        healthcheck = getattr(app, 'healthcheck_path', None)
        if healthcheck:
            service['healthCheckPath'] = healthcheck

        if app.cpu_limit:
            service['cpu'] = app.cpu_limit
        if app.memory_limit:
            service['memory'] = app.memory_limit

        env_vars = cls._env_vars(app)
        if env_vars:
            service['envVars'] = env_vars

        disks = cls._disks(app)
        if disks:
            service['disks'] = disks

        manifest: Dict[str, Any] = {
            'version': 1,
            'services': [service],
        }

        domains = cls._domains(app, service['name'])
        if domains:
            manifest['domains'] = domains

        return manifest

    @classmethod
    def scaffold_yaml(cls, app: Application) -> str:
        manifest = cls.scaffold_for_app(app)
        body = yaml.safe_dump(manifest, sort_keys=False, default_flow_style=False)
        return _SCHEMA_HEADER + body

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _runtime(app: Application) -> str:
        if app.app_type == 'docker':
            return 'docker'
        if app.python_version:
            return 'python'
        if app.php_version:
            return 'php'
        if app.buildpack_type == 'nixpacks':
            return 'nixpacks'
        return ''

    @staticmethod
    def _env_vars(app: Application) -> List[Dict[str, Any]]:
        entries: List[Dict[str, Any]] = []
        try:
            rows = EnvService.get_env_vars(app.id, mask_secrets=True)
        except Exception:
            rows = []
        for row in rows:
            key = row.get('key')
            if not key:
                continue
            if row.get('is_secret'):
                # never emit a secret value into a committable file — leave a
                # fromSecret reference the operator can wire to a vault entry.
                entries.append({'key': key, 'fromSecret': key.lower()})
            else:
                entries.append({'key': key, 'value': row.get('value', '')})
        return entries

    @staticmethod
    def _ports(app: Application) -> List[Dict[str, Any]]:
        """Typed L4 publishes from the app row, in manifest (camelCase) form —
        only non-default fields are emitted to keep the scaffold clean."""
        from app.services.app_port_service import AppPortService
        out: List[Dict[str, Any]] = []
        for p in AppPortService.get_ports(app):
            entry: Dict[str, Any] = {'port': p['host_port']}
            if p.get('container_port') and p['container_port'] != p['host_port']:
                entry['containerPort'] = p['container_port']
            if p.get('protocol') and p['protocol'] != 'tcp':
                entry['protocol'] = p['protocol']
            if p.get('expose') and p['expose'] != 'public':
                entry['expose'] = p['expose']
            out.append(entry)
        return out

    @staticmethod
    def _disks(app: Application) -> List[Dict[str, Any]]:
        disks = []
        for vol in getattr(app, 'volumes', []) or []:
            entry: Dict[str, Any] = {'name': vol.name, 'mountPath': vol.mount_path}
            if getattr(vol, 'declared_size', None):
                entry['size'] = vol.declared_size
            disks.append(entry)
        return disks

    @staticmethod
    def _domains(app: Application, service_name: str) -> List[Dict[str, Any]]:
        domains = []
        for dom in getattr(app, 'domains', []) or []:
            entry = {'host': dom.name, 'service': service_name}
            if getattr(dom, 'ssl_enabled', False):
                entry['ssl'] = 'auto'
            domains.append(entry)
        return domains

    @staticmethod
    def _json(raw: Any) -> Dict[str, Any]:
        if not raw:
            return {}
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    @staticmethod
    def _slug(name: str) -> str:
        import re
        slug = re.sub(r'[^a-z0-9-]+', '-', (name or '').lower()).strip('-')
        return slug or 'app'
