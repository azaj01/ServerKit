"""Pure normalizer/validator for the declarative serverkit.yaml manifest (v1).

No DB, no filesystem side effects. Parses a manifest (raw text or an
already-parsed mapping), validates it against the embedded JSON Schema, and
normalizes it into a stable internal shape the resolver/planner consume.

``version: 1`` selects this spec. Files without it are legacy flat manifests and
are handled by ``RepositoryManifestService`` exactly as before — this module
never touches them.

camelCase is canonical; snake_case aliases are accepted everywhere.
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

try:
    import tomllib  # noqa: F401  (parity with RepositoryManifestService)
except ModuleNotFoundError:  # pragma: no cover
    pass

try:
    import jsonschema
    from jsonschema import Draft7Validator
except Exception:  # pragma: no cover - jsonschema is a declared dependency
    jsonschema = None
    Draft7Validator = None


# Service type buckets ------------------------------------------------------
APP_TYPES = ('web', 'worker', 'static', 'docker')
DB_TYPES = ('postgres', 'mysql', 'mariadb', 'redis')
ALL_TYPES = APP_TYPES + DB_TYPES

# Map a manifest db `type` onto a ManagedDatabase engine.
DB_ENGINE_MAP = {
    'postgres': 'postgresql',
    'postgresql': 'postgresql',
    'mysql': 'mysql',
    'mariadb': 'mysql',
    'redis': 'redis',
}

# Map a manifest app `type` onto an Application.app_type.
APP_TYPE_MAP = {
    'web': 'docker',
    'worker': 'docker',
    'docker': 'docker',
    'static': 'static',
}

FROM_SERVICE_PROPERTIES = (
    'connectionString', 'host', 'port', 'database', 'username', 'password', 'url',
)

BACKUP_SCHEDULES = ('hourly', 'daily', 'weekly', 'monthly')

# Appliance tier (plan 35): typed L4 port publishes.
PORT_PROTOCOLS = ('tcp', 'udp')
PORT_EXPOSURES = ('public', 'local')

_KEY_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
_NAME_RE = re.compile(r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')


# The JSON Schema is embedded so validation works even where docs/ is not
# shipped (e.g. the production image). ``docs/serverkit-yaml.schema.json`` is a
# byte-identical copy for editors; ``test_manifest_spec`` asserts they match.
MANIFEST_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$id": "https://serverkit.dev/serverkit-yaml.schema.json",
    "title": "ServerKit Manifest",
    "type": "object",
    "required": ["version"],
    "additionalProperties": True,
    "properties": {
        "version": {"const": 1},
        "server": {"type": "string", "minLength": 1},
        "project": {"type": "string", "minLength": 1},
        "envVars": {"type": "array", "items": {"$ref": "#/definitions/envVar"}},
        "services": {
            "type": "array",
            "minItems": 1,
            "items": {"$ref": "#/definitions/service"},
        },
        "domains": {"type": "array", "items": {"$ref": "#/definitions/domain"}},
    },
    "definitions": {
        "service": {
            "type": "object",
            "required": ["name", "type"],
            "additionalProperties": True,
            "properties": {
                "name": {
                    "type": "string",
                    "pattern": "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$",
                    "minLength": 1,
                    "maxLength": 63,
                },
                "type": {"enum": list(ALL_TYPES)},
                "runtime": {"type": "string"},
                "buildCommand": {"type": "string"},
                "startCommand": {"type": "string"},
                "port": {"type": "integer", "minimum": 1, "maximum": 65535},
                "ports": {"type": "array", "items": {"$ref": "#/definitions/portDecl"}},
                "healthCheckPath": {"type": "string"},
                "autoDeploy": {"type": "boolean"},
                "version": {"type": ["string", "number"]},
                "server": {"type": "string"},
                "cpu": {"type": ["number", "string"]},
                "memory": {"type": ["string", "number"]},
                "envVars": {"type": "array", "items": {"$ref": "#/definitions/envVar"}},
                "disks": {"type": "array", "items": {"$ref": "#/definitions/disk"}},
                "disk": {"$ref": "#/definitions/disk"},
                "cron": {
                    "oneOf": [
                        {"$ref": "#/definitions/cron"},
                        {"type": "array", "items": {"$ref": "#/definitions/cron"}},
                    ]
                },
            },
        },
        "portDecl": {
            "type": "object",
            "required": ["port"],
            "additionalProperties": True,
            "properties": {
                "port": {"type": "integer", "minimum": 1, "maximum": 65535},
                "containerPort": {"type": "integer", "minimum": 1, "maximum": 65535},
                "protocol": {"enum": list(PORT_PROTOCOLS)},
                "expose": {"enum": list(PORT_EXPOSURES)},
            },
        },
        "envVar": {
            "type": "object",
            "required": ["key"],
            "additionalProperties": True,
            "properties": {
                "key": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"},
                "value": {"type": ["string", "number", "boolean"]},
                "fromSecret": {"type": "string"},
                "fromService": {
                    "type": "object",
                    "required": ["name", "property"],
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string"},
                        "property": {"enum": list(FROM_SERVICE_PROPERTIES)},
                    },
                },
                "generate": {"type": "boolean"},
            },
        },
        "disk": {
            "type": "object",
            "additionalProperties": True,
            "properties": {
                "name": {"type": "string"},
                "mountPath": {"type": "string"},
                "size": {"type": ["string", "number"]},
                "backup": {"$ref": "#/definitions/backup"},
            },
        },
        "backup": {
            "type": "object",
            "additionalProperties": True,
            "properties": {
                "schedule": {"enum": list(BACKUP_SCHEDULES)},
                "retain": {"type": "integer", "minimum": 1},
            },
        },
        "cron": {
            "type": "object",
            "required": ["schedule", "command"],
            "additionalProperties": True,
            "properties": {
                "name": {"type": "string"},
                "schedule": {"type": "string"},
                "command": {"type": "string"},
            },
        },
        "domain": {
            "type": "object",
            "required": ["host"],
            "additionalProperties": True,
            "properties": {
                "host": {"type": "string", "minLength": 1},
                "service": {"type": "string"},
                "ssl": {
                    "oneOf": [
                        {"type": "string", "enum": ["auto", "off", "on"]},
                        {"type": "boolean"},
                    ]
                },
            },
        },
    },
}


class ManifestError(Exception):
    """Raised when a v1 manifest fails to parse, validate or normalize.

    ``errors`` carries every problem found so the UI/CLI can show them at once.
    """

    def __init__(self, errors: List[str]):
        self.errors = errors
        super().__init__('; '.join(errors) if errors else 'Invalid manifest')


class ManifestSpecService:
    """Parse → validate → normalize a v1 serverkit manifest. Pure."""

    # -- entry points -------------------------------------------------------

    @staticmethod
    def parse_text(content: str, filename: str = 'serverkit.yaml') -> Optional[Any]:
        """Parse raw manifest text (yaml or json). Returns None on parse error."""
        try:
            if filename.endswith('.json'):
                return json.loads(content)
            return yaml.safe_load(content)
        except Exception:
            return None

    @staticmethod
    def is_v1(data: Any) -> bool:
        """True if ``data`` is a mapping declaring ``version: 1``."""
        return isinstance(data, dict) and data.get('version') in (1, '1')

    @classmethod
    def normalize(cls, data: Any) -> Dict[str, Any]:
        """Validate and normalize a parsed v1 manifest.

        Returns the normalized manifest dict (see module docstring). Raises
        ``ManifestError`` with the full list of problems on any failure.
        """
        if not isinstance(data, dict):
            raise ManifestError(['Manifest must be a mapping'])
        if not cls.is_v1(data):
            raise ManifestError(['Manifest is missing `version: 1`'])

        errors = cls._schema_errors(data)
        if errors:
            raise ManifestError(errors)

        normalized, sem_errors = cls._normalize_checked(data)
        if sem_errors:
            raise ManifestError(sem_errors)
        return normalized

    @classmethod
    def normalize_text(cls, content: str, filename: str = 'serverkit.yaml') -> Dict[str, Any]:
        data = cls.parse_text(content, filename)
        if data is None:
            raise ManifestError([f'Could not parse {filename}'])
        return cls.normalize(data)

    # -- schema validation --------------------------------------------------

    @classmethod
    def _schema_errors(cls, data: Dict[str, Any]) -> List[str]:
        if Draft7Validator is None:  # pragma: no cover
            return cls._manual_schema_errors(data)
        validator = Draft7Validator(MANIFEST_SCHEMA)
        errors = []
        for err in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
            location = '/'.join(str(p) for p in err.path) or '(root)'
            errors.append(f'{location}: {err.message}')
        return errors

    @staticmethod
    def _manual_schema_errors(data: Dict[str, Any]) -> List[str]:  # pragma: no cover
        errors = []
        services = data.get('services')
        if not isinstance(services, list) or not services:
            errors.append('services: at least one service is required')
        return errors

    # -- normalization + semantic checks -----------------------------------

    @classmethod
    def _normalize_checked(cls, data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
        errors: List[str] = []

        services_raw = data.get('services') or []
        names: List[str] = []
        services: List[Dict[str, Any]] = []
        for idx, svc in enumerate(services_raw):
            name = svc.get('name')
            names.append(name)
            services.append(cls._normalize_service(svc, idx, errors))

        # service-name uniqueness
        seen = set()
        for name in names:
            if name in seen:
                errors.append(f'services: duplicate service name `{name}`')
            seen.add(name)
        valid_names = set(n for n in names if n)

        # reference-resolution checks: fromService must name a sibling
        for svc in services:
            for var in svc['env_vars']:
                ref = var.get('service_ref')
                if ref and ref['name'] not in valid_names:
                    errors.append(
                        f"services/{svc['name']}: env `{var['key']}` references "
                        f"unknown service `{ref['name']}`"
                    )

        manifest_env = [
            cls._normalize_env_var(v, f'envVars[{i}]', errors)
            for i, v in enumerate(data.get('envVars') or [])
        ]
        for var in manifest_env:
            ref = var.get('service_ref')
            if ref and ref['name'] not in valid_names:
                errors.append(
                    f"envVars: `{var['key']}` references unknown service `{ref['name']}`"
                )

        domains = []
        for i, dom in enumerate(data.get('domains') or []):
            normalized_dom = cls._normalize_domain(dom)
            if normalized_dom['service'] and normalized_dom['service'] not in valid_names:
                errors.append(
                    f"domains[{i}]: `{normalized_dom['host']}` routes to unknown "
                    f"service `{normalized_dom['service']}`"
                )
            domains.append(normalized_dom)

        normalized = {
            'version': 1,
            'server': data.get('server') or None,
            'project': data.get('project') or None,
            'env_vars': manifest_env,
            'services': services,
            'domains': domains,
        }
        return normalized, errors

    @classmethod
    def _normalize_service(cls, svc: Dict[str, Any], idx: int, errors: List[str]) -> Dict[str, Any]:
        name = svc.get('name')
        stype = svc.get('type')
        kind = 'database' if stype in DB_TYPES else 'app'
        prefix = f'services/{name or idx}'

        env_vars = [
            cls._normalize_env_var(v, f'{prefix}/env[{i}]', errors)
            for i, v in enumerate(svc.get('envVars') or [])
        ]

        disks = []
        raw_disks = svc.get('disks') or []
        # db services carry a single `disk`
        single_disk = svc.get('disk')
        if single_disk:
            raw_disks = list(raw_disks) + [single_disk]
        for d in raw_disks:
            disks.append(cls._normalize_disk(d))

        crons = svc.get('cron')
        if isinstance(crons, dict):
            crons = [crons]
        elif not isinstance(crons, list):
            crons = []
        crons = [
            {
                'name': c.get('name'),
                'schedule': c.get('schedule'),
                'command': c.get('command'),
            }
            for c in crons
            if isinstance(c, dict)
        ]

        ports = cls._normalize_ports(svc.get('ports'), prefix, errors)

        return {
            'name': name,
            'type': stype,
            'kind': kind,
            'app_type': APP_TYPE_MAP.get(stype) if kind == 'app' else None,
            'db_engine': DB_ENGINE_MAP.get(stype) if kind == 'database' else None,
            'runtime': svc.get('runtime'),
            'build_command': cls._alias(svc, 'buildCommand', 'build_command'),
            'start_command': cls._alias(svc, 'startCommand', 'start_command'),
            'port': svc.get('port'),
            'ports': ports,
            'healthcheck_path': cls._alias(svc, 'healthCheckPath', 'healthcheck_path'),
            'auto_deploy': bool(cls._alias(svc, 'autoDeploy', 'auto_deploy', default=False)),
            'engine_version': cls._stringify(svc.get('version')),
            'server': svc.get('server') or None,
            'cpu': svc.get('cpu'),
            'memory': svc.get('memory'),
            'env_vars': env_vars,
            'disks': disks,
            'crons': crons,
        }

    @classmethod
    def _normalize_ports(cls, raw: Any, prefix: str, errors: List[str]) -> List[Dict[str, Any]]:
        """Typed L4 publishes (plan 35). Legacy scalar ``port`` is unaffected —
        it keeps its HTTP/nginx semantics. ``ports`` are raw tcp/udp publishes
        (the appliance escape hatch): NULL/[] means "no raw ports declared".
        """
        if not isinstance(raw, list):
            return []
        ports: List[Dict[str, Any]] = []
        seen: set = set()
        for i, entry in enumerate(raw):
            if not isinstance(entry, dict):
                errors.append(f'{prefix}/ports[{i}]: must be a mapping')
                continue
            host_port = entry.get('port')
            if not isinstance(host_port, int):
                errors.append(f'{prefix}/ports[{i}]: `port` is required')
                continue
            container_port = cls._alias(entry, 'containerPort', 'container_port') or host_port
            protocol = (entry.get('protocol') or 'tcp').lower()
            expose = (entry.get('expose') or 'public').lower()
            key = (host_port, protocol)
            if key in seen:
                errors.append(f'{prefix}/ports[{i}]: duplicate publish {host_port}/{protocol}')
                continue
            seen.add(key)
            ports.append({
                'host_port': host_port,
                'container_port': container_port,
                'protocol': protocol,
                'expose': expose,
            })
        return ports

    @classmethod
    def _normalize_env_var(cls, var: Dict[str, Any], where: str, errors: List[str]) -> Dict[str, Any]:
        key = var.get('key')
        if key and not _KEY_RE.match(key):
            errors.append(f'{where}: invalid env key `{key}`')

        from_secret = cls._alias(var, 'fromSecret', 'from_secret')
        from_service = cls._alias(var, 'fromService', 'from_service')
        has_value = 'value' in var and var.get('value') is not None
        generate = bool(var.get('generate'))

        sources = [s for s in (has_value, bool(from_secret), bool(from_service), generate) if s]
        if len(sources) > 1:
            errors.append(
                f'{where}: env `{key}` must declare exactly one of '
                'value/fromSecret/fromService/generate'
            )

        source = 'placeholder'
        service_ref = None
        if has_value:
            source = 'value'
        elif from_secret:
            source = 'secret'
        elif generate:
            source = 'generate'
        elif isinstance(from_service, dict):
            source = 'service'
            service_ref = {
                'name': from_service.get('name'),
                'property': from_service.get('property'),
            }

        return {
            'key': key,
            'source': source,
            'value': var.get('value') if has_value else None,
            'secret_name': from_secret or None,
            'service_ref': service_ref,
            'secret': source in ('secret', 'generate') or bool(var.get('secret')),
        }

    @classmethod
    def _normalize_disk(cls, disk: Dict[str, Any]) -> Dict[str, Any]:
        backup = disk.get('backup') if isinstance(disk.get('backup'), dict) else None
        return {
            'name': disk.get('name'),
            'mount_path': cls._alias(disk, 'mountPath', 'mount_path'),
            'size': cls._stringify(disk.get('size')),
            'backup': cls._normalize_backup(backup) if backup else None,
        }

    @staticmethod
    def _normalize_backup(backup: Dict[str, Any]) -> Dict[str, Any]:
        return {
            'schedule': backup.get('schedule') or 'daily',
            'retain': backup.get('retain') or 7,
        }

    @classmethod
    def _normalize_domain(cls, dom: Dict[str, Any]) -> Dict[str, Any]:
        ssl = dom.get('ssl')
        if isinstance(ssl, bool):
            ssl_mode = 'auto' if ssl else 'off'
        elif ssl in ('auto', 'on'):
            ssl_mode = 'auto'
        elif ssl == 'off':
            ssl_mode = 'off'
        else:
            ssl_mode = 'auto'  # default best-effort
        return {
            'host': dom.get('host'),
            'service': dom.get('service') or None,
            'ssl': ssl_mode,
        }

    # -- wizard/summary -----------------------------------------------------

    @classmethod
    def summarize(cls, normalized: Dict[str, Any]) -> Dict[str, Any]:
        """A compact, UI-friendly summary of a normalized manifest."""
        services = normalized['services']
        env_required = []
        for svc in services:
            for var in svc['env_vars']:
                if var['source'] in ('secret', 'placeholder'):
                    env_required.append({'service': svc['name'], 'key': var['key'],
                                         'source': var['source']})
        return {
            'version': 1,
            'server': normalized.get('server'),
            'project': normalized.get('project'),
            'service_count': len(services),
            'services': [
                {
                    'name': s['name'],
                    'type': s['type'],
                    'kind': s['kind'],
                    'port': s.get('port'),
                    'auto_deploy': s['auto_deploy'],
                    'disk_count': len(s['disks']),
                    'env_count': len(s['env_vars']),
                }
                for s in services
            ],
            'databases': [s['name'] for s in services if s['kind'] == 'database'],
            'domains': [{'host': d['host'], 'service': d['service'], 'ssl': d['ssl']}
                        for d in normalized['domains']],
            'env_required': env_required,
        }

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _alias(obj: Dict[str, Any], camel: str, snake: str, default: Any = None) -> Any:
        if camel in obj and obj[camel] is not None:
            return obj[camel]
        if snake in obj and obj[snake] is not None:
            return obj[snake]
        return default

    @staticmethod
    def _stringify(value: Any) -> Optional[str]:
        if value is None:
            return None
        return str(value)
