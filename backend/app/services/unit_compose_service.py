"""Render a multi-container UNIT as one docker-compose project (plan 35, #8).

A unit is ONE manifest service with a ``containers:`` map. It becomes ONE
Application and ONE compose file: the project's implicit default network is the
unit's private network, `depends_on.condition` gates start order on health, and
each container gets its own named volumes (``{app}-{container}-{disk}``) so two
containers can both mount ``/config`` without colliding on a shared AppVolume.

Pure: no DB, no filesystem. Given the normalized container list it returns a
compose dict (and a YAML string) the deploy path can write verbatim.
"""

import re
from typing import Any, Dict, List, Optional

import yaml

from app.services.app_port_service import AppPortService


class UnitComposeService:

    @classmethod
    def render(cls, app_name: str, containers: List[Dict[str, Any]],
               networks: Optional[List[str]] = None) -> Dict[str, Any]:
        """Return a compose dict for the unit."""
        services: Dict[str, Any] = {}
        top_volumes: Dict[str, Any] = {}

        for c in containers:
            cname = c['name']
            svc: Dict[str, Any] = {
                'container_name': f'{app_name}-{cname}',
                'restart': 'unless-stopped',
            }
            if c.get('image'):
                svc['image'] = c['image']

            ports = AppPortService.compose_ports(c.get('ports') or [])
            if ports:
                svc['ports'] = ports

            env = cls._literal_env(c.get('env_vars') or [])
            if env:
                svc['environment'] = env

            vols = []
            for disk in (c.get('disks') or []):
                mount = disk.get('mount_path')
                if not mount:
                    continue
                vname = f'{app_name}-{cname}-{disk.get("name") or cls._slug(mount)}'
                vols.append(f'{vname}:{mount}')
                top_volumes[vname] = {}
            if vols:
                svc['volumes'] = vols

            hc = cls._healthcheck(c.get('health_check'))
            if hc:
                svc['healthcheck'] = hc

            deps = c.get('depends_on') or []
            if deps:
                svc['depends_on'] = {
                    d['service']: {'condition': cls._condition(d.get('condition'))}
                    for d in deps
                }

            cls._apply_host_requirements(svc, c.get('host_requirements'))

            if networks:
                svc['networks'] = list(networks)

            services[cname] = svc

        compose: Dict[str, Any] = {'version': '3.8', 'services': services}
        if top_volumes:
            compose['volumes'] = top_volumes
        if networks:
            compose['networks'] = {n: {'external': True} for n in networks}
        return compose

    @classmethod
    def render_yaml(cls, app_name: str, containers: List[Dict[str, Any]],
                    networks: Optional[List[str]] = None) -> str:
        return yaml.safe_dump(cls.render(app_name, containers, networks=networks),
                              sort_keys=False, default_flow_style=False)

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _literal_env(env_vars: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Only literal values are emitted inline; secret/service/server refs are
        resolved by the env layer (unit env folds into the one app env, v1)."""
        out: Dict[str, Any] = {}
        for var in env_vars:
            if var.get('source') == 'value' and var.get('key'):
                out[var['key']] = var.get('value')
        return out

    @staticmethod
    def _condition(condition: Optional[str]) -> str:
        return 'service_healthy' if condition == 'healthy' else 'service_started'

    @staticmethod
    def _healthcheck(hc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not hc:
            return None
        block: Dict[str, Any] = {}
        if hc.get('cmd'):
            block['test'] = ['CMD-SHELL', hc['cmd']]
        elif hc.get('http_path'):
            path = hc['http_path']
            block['test'] = ['CMD-SHELL',
                             f'wget -qO- http://localhost{path} || exit 1']
        else:
            return None
        if hc.get('interval'):
            block['interval'] = hc['interval']
        if hc.get('timeout'):
            block['timeout'] = hc['timeout']
        if hc.get('retries'):
            block['retries'] = hc['retries']
        return block

    @staticmethod
    def _apply_host_requirements(svc: Dict[str, Any], hr: Optional[Dict[str, Any]]) -> None:
        if not hr:
            return
        if hr.get('privileged'):
            svc['privileged'] = True
        if hr.get('cap_add'):
            svc['cap_add'] = list(hr['cap_add'])
        if hr.get('sysctls'):
            svc['sysctls'] = dict(hr['sysctls'])
        if hr.get('devices'):
            svc['devices'] = list(hr['devices'])

    @staticmethod
    def _slug(text: str) -> str:
        return re.sub(r'[^a-z0-9]+', '-', (text or '').lower()).strip('-') or 'vol'
