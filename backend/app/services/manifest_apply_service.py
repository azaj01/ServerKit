"""The manifest apply engine (plan 17, Phase 2).

resolve → plan → apply. Turns a normalized v1 manifest into an ordered action
plan and executes it through the existing imperative services, inside a
DeploymentJob for logging + before/after snapshots. Single-server for now;
Phase 5 adds fleet targeting.

`plan()` is pure enough to be a dry-run (no writes). `apply()` executes and is
idempotent — a second plan against a just-applied manifest is empty.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from app import db
from app.models.application import Application
from app.models.application_manifest import (
    ApplicationManifest, STATUS_APPLIED, STATUS_ERROR,
)
from app.models.domain import Domain
from app.models.environment import Environment
from app.models.managed_database import ManagedDatabase
from app.models.project import Project


# manifest backup schedule -> cron
_SCHEDULE_CRON = {
    'hourly': '0 * * * *',
    'daily': '0 2 * * *',
    'weekly': '0 3 * * 0',
    'monthly': '0 4 1 * *',
}

# db engines the managed-database layer can actually record
_MANAGED_DB_ENGINES = {'postgresql', 'mysql'}

# ordering weight per step type (dbs before consumers; domains last)
_STEP_ORDER = {
    'provision_db': 0,
    'warn': 1,
    'create_app': 2,
    'update_app': 3,
    'open_port': 4,
    'set_env': 5,
    'set_env_ref': 5,
    'ensure_volume': 6,
    'bootstrap': 7,
    'upsert_backup_policy': 8,
    'attach_domain': 9,
}


class ManifestApplyService:

    # -- resolve (#7) -------------------------------------------------------

    @classmethod
    def resolve_service(cls, svc: Dict[str, Any]) -> Dict[str, Any]:
        """Normalized manifest service -> desired-state dict."""
        literal_env: Dict[str, Any] = {}
        env_refs: List[Dict[str, Any]] = []
        for var in svc.get('env_vars', []):
            if var['source'] == 'value':
                literal_env[var['key']] = var['value']
            else:
                env_refs.append(var)
        return {
            'name': svc['name'],
            'kind': svc['kind'],
            'app_type': svc.get('app_type'),
            'db_engine': svc.get('db_engine'),
            'engine_version': svc.get('engine_version'),
            'runtime': svc.get('runtime'),
            'port': svc.get('port'),
            'ports': svc.get('ports', []),
            'healthcheck_path': svc.get('healthcheck_path'),
            'build_command': svc.get('build_command'),
            'start_command': svc.get('start_command'),
            'cpu': cls._stringify(svc.get('cpu')),
            'memory': cls._stringify(svc.get('memory')),
            'auto_deploy': svc.get('auto_deploy', False),
            'env': literal_env,
            'env_refs': env_refs,
            'disks': svc.get('disks', []),
            'server': svc.get('server'),
        }

    # -- drift comparison (#18) --------------------------------------------

    @classmethod
    def resolved_for_app(cls, app) -> Optional[Dict[str, Any]]:
        """The normalized+resolved manifest service that governs ``app``, or None
        when the app is not manifest-managed."""
        if not getattr(app, 'project_id', None):
            return None
        row = ApplicationManifest.query.filter_by(project_id=app.project_id).first()
        if not row:
            return None
        normalized = row.get_normalized()
        if not normalized:
            return None
        svc = next((s for s in normalized.get('services', [])
                    if s.get('name') == app.name and s.get('kind') == 'app'), None)
        if not svc:
            return None
        resolved = cls.resolve_service(svc)
        resolved['_domains'] = sorted(
            d['host'] for d in normalized.get('domains', [])
            if d.get('service') == app.name and d.get('host'))
        return resolved

    @classmethod
    def drift_pair(cls, app, resolved: Dict[str, Any]):
        """(expected, observed) dicts over ONLY the manifest-declared surface.

        The manifest is an overlay: extra live env vars/domains are not drift.
        We therefore project live state onto what the manifest declares, so the
        pair is equal iff every declared item is present and matches.
        """
        from app.models.env_variable import EnvironmentVariable
        expected: Dict[str, Any] = {}
        observed: Dict[str, Any] = {}

        if resolved.get('port') is not None:
            expected['port'] = resolved['port']
            observed['port'] = app.port
        if resolved.get('healthcheck_path'):
            expected['healthcheck_path'] = resolved['healthcheck_path']
            observed['healthcheck_path'] = app.healthcheck_path

        declared_env = sorted(list(resolved.get('env', {}).keys())
                              + [r['key'] for r in resolved.get('env_refs', [])])
        if declared_env:
            live_keys = {ev.key for ev in
                         EnvironmentVariable.query.filter_by(application_id=app.id).all()}
            expected['env_keys'] = declared_env
            observed['env_keys'] = sorted(k for k in declared_env if k in live_keys)

        declared_vols = sorted(d['mount_path'] for d in resolved.get('disks', [])
                               if d.get('mount_path'))
        if declared_vols:
            live_mounts = {v.mount_path for v in (app.volumes or [])}
            expected['volumes'] = declared_vols
            observed['volumes'] = sorted(m for m in declared_vols if m in live_mounts)

        declared_domains = resolved.get('_domains', [])
        if declared_domains:
            live_hosts = {d.name for d in (app.domains or [])}
            expected['domains'] = declared_domains
            observed['domains'] = sorted(h for h in declared_domains if h in live_hosts)

        return expected, observed

    # -- plan (#8) ----------------------------------------------------------

    @classmethod
    def plan(cls, project: Project, normalized: Dict[str, Any],
             environment: Optional[Environment] = None) -> Dict[str, Any]:
        """Diff desired manifest vs live state -> ordered action plan."""
        env = environment or cls._default_environment(project)
        default_server = normalized.get('server')
        steps: List[Dict[str, Any]] = []
        issues: List[Dict[str, Any]] = []

        services = normalized.get('services', [])
        resolved_all: List[Dict[str, Any]] = []
        for svc in services:
            resolved = cls.resolve_service(svc)
            resolved['server'] = resolved.get('server') or default_server
            resolved_all.append(resolved)
            if resolved['kind'] == 'database':
                steps.extend(cls._plan_db(resolved))
            else:
                steps.extend(cls._plan_app(project, env, resolved, issues))

        steps.extend(cls._plan_domains(project, normalized.get('domains', [])))

        # Appliance-tier blockers (plan 35): plan-time refusals distinct from
        # advisory `issues`. Apply refuses (nothing executed) while any exist.
        blockers, appliance_issues = cls._appliance_blockers(project, resolved_all)
        issues.extend(appliance_issues)

        steps.sort(key=lambda s: (_STEP_ORDER.get(s['type'], 99), s.get('service') or ''))
        return {
            'project_id': project.id,
            'environment_id': env.id if env else None,
            'steps': steps,
            'step_count': len(steps),
            'issues': issues,
            'blockers': blockers,
            'summary': cls._summarize_plan(steps),
        }

    @classmethod
    def _plan_db(cls, resolved: Dict[str, Any]) -> List[Dict[str, Any]]:
        engine = resolved['db_engine']
        name = resolved['name']
        if engine not in _MANAGED_DB_ENGINES:
            return [{
                'type': 'warn', 'service': name,
                'description': f'{engine or resolved.get("app_type")} databases are not '
                               f'managed by ServerKit yet — declared but not provisioned',
                'payload': {},
            }]
        existing = ManagedDatabase.query.filter_by(engine=engine, name=name).first()
        steps: List[Dict[str, Any]] = []
        if not existing:
            steps.append({
                'type': 'provision_db', 'service': name,
                'description': f'Provision {engine} database `{name}`',
                'payload': {'engine': engine, 'name': name,
                            'version': resolved.get('engine_version')},
            })
        # backup declaration on the db's single disk
        for disk in resolved.get('disks', []):
            backup = disk.get('backup')
            if backup and not cls._backup_policy_current(
                    'database', existing.id if existing else None, backup):
                steps.append(cls._db_backup_step(name, engine, backup, exists=bool(existing)))
        return steps

    @classmethod
    def _plan_app(cls, project: Project, env: Optional[Environment],
                  resolved: Dict[str, Any],
                  issues: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        steps: List[Dict[str, Any]] = []
        issues = issues if issues is not None else []
        name = resolved['name']
        app = cls._find_app(project, name)

        if app is None:
            payload = {k: resolved[k] for k in
                       ('app_type', 'port', 'healthcheck_path', 'runtime',
                        'build_command', 'start_command', 'cpu', 'memory')}
            payload['name'] = name
            # fleet targeting (#21): route the app to a server when declared
            server_ref = resolved.get('server')
            if server_ref:
                server_id = cls._resolve_server_id(server_ref)
                if server_id:
                    payload['server_id'] = server_id
                else:
                    issues.append({'service': name, 'kind': 'unknown_server',
                                   'server': server_ref})
            target = ' @ ' + server_ref if server_ref else ''
            steps.append({
                'type': 'create_app', 'service': name,
                'description': f'Create app `{name}` ({resolved["app_type"]}){target}',
                'payload': payload,
            })
        else:
            changes = cls._app_field_changes(app, resolved)
            if changes:
                steps.append({
                    'type': 'update_app', 'service': name,
                    'description': f'Update app `{name}`: ' + ', '.join(changes.keys()),
                    'payload': {'app_id': app.id, 'changes': changes},
                })

        # typed L4 port publishes (appliance tier, plan 35)
        ports = resolved.get('ports') or []
        if ports:
            from app.services.app_port_service import AppPortService
            current = AppPortService.get_ports(app) if app else []
            if app is None or cls._ports_differ(current, ports):
                steps.append({
                    'type': 'open_port', 'service': name,
                    'description': f'Publish {len(ports)} port(s) on `{name}`',
                    'payload': {'app_id': app.id if app else None, 'ports': ports},
                })

        # env (literal values only; references bind in Phase 3)
        desired_env = resolved['env']
        if desired_env:
            live_env = cls._live_env(app) if app else {}
            missing = {k: v for k, v in desired_env.items() if str(live_env.get(k)) != str(v)}
            if missing or app is None:
                to_set = desired_env if app is None else missing
                if to_set:
                    steps.append({
                        'type': 'set_env', 'service': name,
                        'description': f'Set {len(to_set)} env var(s) on `{name}`',
                        'payload': {'app_id': app.id if app else None, 'env': to_set},
                    })

        # env references (fromSecret / fromService / generate) — Phase 3
        live_vars = cls._live_env_vars(app) if app else {}
        for ref in resolved.get('env_refs', []):
            key = ref['key']
            source = ref['source']
            if source == 'generate':
                desired = {'kind': 'secret', 'secret': cls._generated_secret_name(name, key)}
                live = live_vars.get(key)
                # a generated secret is created once; leave it in place afterwards
                if live is not None and (live.get_reference() or {}).get('kind') == 'secret':
                    continue
                steps.append(cls._set_env_ref_step(name, app, key, desired, generate=True))
            elif source == 'secret':
                desired = {'kind': 'secret', 'secret': ref['secret_name']}
                if not cls._secret_exists(ref['secret_name']):
                    issues.append({'service': name, 'key': key, 'kind': 'missing_secret',
                                   'secret': ref['secret_name']})
                if cls._ref_changed(live_vars.get(key), desired):
                    steps.append(cls._set_env_ref_step(name, app, key, desired))
            elif source == 'service':
                sr = ref['service_ref']
                desired = {'kind': 'service', 'service': sr['name'], 'property': sr['property']}
                if cls._ref_changed(live_vars.get(key), desired):
                    steps.append(cls._set_env_ref_step(name, app, key, desired))

        # disks
        for disk in resolved.get('disks', []):
            mount = disk.get('mount_path')
            if not mount:
                continue
            has_vol = bool(app) and any(v.mount_path == mount for v in (app.volumes or []))
            if not has_vol:
                steps.append({
                    'type': 'ensure_volume', 'service': name,
                    'description': f'Ensure volume `{disk.get("name") or mount}` on `{name}`',
                    'payload': {'app_id': app.id if app else None,
                                'name': disk.get('name') or cls._slug(mount),
                                'mount_path': mount, 'size': disk.get('size')},
                })
            backup = disk.get('backup')
            if backup and not cls._backup_policy_current(
                    'files', app.id if app else None, backup):
                steps.append(cls._files_backup_step(name, app, mount, backup))

        return steps

    @classmethod
    def _plan_domains(cls, project: Project, domains: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        steps = []
        for dom in domains:
            host = dom.get('host')
            svc_name = dom.get('service')
            app = cls._find_app(project, svc_name) if svc_name else None
            already = bool(app) and any(d.name == host for d in (app.domains or []))
            if already:
                continue
            steps.append({
                'type': 'attach_domain', 'service': svc_name,
                'description': f'Attach domain `{host}`'
                               + (f' to `{svc_name}`' if svc_name else ''),
                'payload': {'host': host, 'service': svc_name, 'ssl': dom.get('ssl', 'auto'),
                            'app_id': app.id if app else None},
            })
        return steps

    @classmethod
    def _db_backup_step(cls, name, engine, backup, exists):
        return {
            'type': 'upsert_backup_policy', 'service': name,
            'description': f'Backup policy for db `{name}` ({backup["schedule"]})',
            'payload': {'target': 'database', 'engine': engine, 'db_name': name,
                        'schedule': backup['schedule'], 'retain': backup['retain']},
        }

    @classmethod
    def _files_backup_step(cls, name, app, mount, backup):
        return {
            'type': 'upsert_backup_policy', 'service': name,
            'description': f'Backup policy for disk `{mount}` on `{name}` ({backup["schedule"]})',
            'payload': {'target': 'files', 'app_id': app.id if app else None,
                        'mount_path': mount, 'schedule': backup['schedule'],
                        'retain': backup['retain']},
        }

    # -- blockers engine (appliance tier, plan 35) --------------------------

    # An appliance FEATURE is anything the manifest can now express that a
    # target may be unable to provide. Later phases extend `_service_features`.
    @classmethod
    def _service_features(cls, resolved: Dict[str, Any]) -> List[str]:
        feats: List[str] = []
        if resolved.get('ports'):
            feats.append('raw port publishes')
        if resolved.get('host_requirements'):
            feats.append('host requirements')
        if resolved.get('bootstrap'):
            feats.append('a first-boot bootstrap')
        if resolved.get('containers'):
            feats.append('a multi-container unit')
        return feats

    @classmethod
    def _appliance_blockers(cls, project, resolved_all: List[Dict[str, Any]]):
        """Return (blockers, issues). Blockers refuse apply; issues are advisory.

        Message contract: "service X needs Y; target Z can't provide it — <fix>".
        """
        blockers: List[Dict[str, Any]] = []
        issues: List[Dict[str, Any]] = []
        fw_state = None  # resolved lazily, once
        for resolved in resolved_all:
            if resolved.get('kind') != 'app':
                continue
            name = resolved['name']
            feats = cls._service_features(resolved)
            if not feats:
                continue
            need = ' and '.join(feats)
            server_ref = resolved.get('server')

            # Remote target: appliance apply runs on the panel host only (plan 17's
            # remote-dispatch deferral). Say so instead of half-deploying.
            if server_ref:
                srv = cls._resolve_server_obj(server_ref)
                if srv is not None and getattr(srv, 'management_mode', None) == 'observed':
                    blockers.append({
                        'kind': 'observed_server', 'service': name, 'server': server_ref,
                        'message': f'service {name} needs {need}; target {server_ref} is an '
                                   f'observed (read-only) server — ServerKit will not mutate it. '
                                   f'Switch it to managed, or apply on the panel host.'})
                    continue
                blockers.append({
                    'kind': 'remote_target', 'service': name, 'server': server_ref,
                    'message': f'service {name} needs {need}; target {server_ref} is a remote '
                               f'server — remote appliance apply is not supported yet. Apply on '
                               f'the panel host, or provision {server_ref} manually.'})
                continue

            # Local panel host: port conflicts + firewall detection.
            public = [p for p in (resolved.get('ports') or [])
                      if (p.get('expose') or 'public') == 'public']
            for p in public:
                hp = p.get('host_port')
                if hp is not None and cls._port_bound(int(hp)):
                    blockers.append({
                        'kind': 'port_conflict', 'service': name, 'port': hp,
                        'message': f'service {name} needs public port {hp}/{p.get("protocol","tcp")}; '
                                   f'the panel host already has it bound — free the port or choose '
                                   f'another in the manifest.'})
            if public:
                if fw_state is None:
                    fw_state = cls._firewall_state()
                if fw_state == 'undetected':
                    blockers.append({
                        'kind': 'firewall_undetected', 'service': name,
                        'message': f'service {name} publishes public ports but the panel host '
                                   f'firewall state could not be determined — verify ufw/firewalld '
                                   f'is reachable, then re-apply.'})
                elif fw_state == 'none':
                    issues.append({
                        'service': name, 'kind': 'firewall_none',
                        'message': f'no manageable firewall detected — public ports for {name} '
                                   f'will be published but not firewall-managed.'})
        return blockers, issues

    # -- blocker seams (patched in tests) -----------------------------------

    @staticmethod
    def _port_bound(port: int) -> bool:
        """True when ``port`` is already bound on the panel host (0.0.0.0)."""
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(('0.0.0.0', int(port)))
            return False
        except OSError:
            return True
        except Exception:
            return False
        finally:
            sock.close()

    @staticmethod
    def _firewall_state() -> str:
        """'active' (a manageable firewall exists) | 'none' | 'undetected'."""
        try:
            from app.services.firewall_service import FirewallService
            status = FirewallService.get_status()
        except Exception:
            return 'undetected'
        if not isinstance(status, dict):
            return 'undetected'
        if status.get('active_firewall'):
            return 'active'
        fwd = status.get('firewalld') or {}
        ufw = status.get('ufw') or {}
        if fwd.get('installed') or ufw.get('installed'):
            return 'active'
        return 'none'

    @staticmethod
    def _resolve_server_obj(server_ref: Optional[str]):
        if not server_ref:
            return None
        try:
            from app.models.server import Server
        except Exception:
            return None
        return (Server.query.filter_by(id=server_ref).first()
                or Server.query.filter_by(name=server_ref).first())

    @staticmethod
    def _ports_differ(current: List[Dict[str, Any]], desired: List[Dict[str, Any]]) -> bool:
        def key(p):
            return (p.get('host_port'), p.get('container_port'),
                    (p.get('protocol') or 'tcp'), (p.get('expose') or 'public'))
        return sorted(map(key, current)) != sorted(map(key, desired))

    # -- apply (#9) ---------------------------------------------------------

    @classmethod
    def apply(cls, project: Project, normalized: Dict[str, Any],
              user_id: Optional[int] = None,
              environment: Optional[Environment] = None,
              manifest_row: Optional[ApplicationManifest] = None) -> Dict[str, Any]:
        """Execute the plan inside a DeploymentJob with before/after snapshots."""
        env = environment or cls._default_environment(project)
        plan = cls.plan(project, normalized, env)

        # Appliance-tier blockers (plan 35): refuse before executing anything.
        # No force flag — the operator must clear the cause and re-apply.
        if plan.get('blockers'):
            if manifest_row is not None:
                manifest_row.status = STATUS_ERROR
                manifest_row.last_error = plan['blockers'][0]['message']
                db.session.commit()
            return {
                'success': False, 'refused': True,
                'blockers': plan['blockers'], 'issues': plan.get('issues', []),
                'applied': 0, 'results': [], 'plan': plan,
            }

        job = cls._create_job(project, user_id, plan)

        cls._snapshot_existing(project, normalized, tag='before')

        results = []
        failed = False
        for idx, step in enumerate(plan['steps']):
            if failed:
                results.append({**cls._step_ref(step), 'status': 'skipped'})
                continue
            try:
                outcome = cls._execute_step(project, env, step, user_id)
                results.append({**cls._step_ref(step), 'status': 'ok', 'result': outcome})
                cls._log(job, idx, 'info', step['description'], outcome)
            except Exception as exc:  # stop the plan, report per-step
                failed = True
                results.append({**cls._step_ref(step), 'status': 'error', 'error': str(exc)})
                cls._log(job, idx, 'error', f'{step["description"]}: {exc}')

        cls._snapshot_existing(project, normalized, tag='after')

        cls._finish_job(job, failed, results)
        if manifest_row is not None:
            manifest_row.status = STATUS_ERROR if failed else STATUS_APPLIED
            if not failed:
                manifest_row.applied_at = datetime.utcnow()
                manifest_row.last_error = None
            else:
                manifest_row.last_error = next(
                    (r.get('error') for r in results if r.get('status') == 'error'), None)
            db.session.commit()

        return {
            'success': not failed,
            'job_id': job.id,
            'applied': sum(1 for r in results if r['status'] == 'ok'),
            'issues': plan.get('issues', []),
            'results': results,
            'plan': plan,
        }

    @classmethod
    def apply_stored(cls, project_id: int, user_id: Optional[int] = None) -> Dict[str, Any]:
        """Load and re-apply the manifest stored for a project (drift repair)."""
        project = Project.query.get(project_id)
        if not project:
            return {'success': False, 'error': 'project not found'}
        row = ApplicationManifest.query.filter_by(project_id=project_id).first()
        normalized = row.get_normalized() if row else None
        if not normalized:
            return {'success': False, 'error': 'no stored manifest'}
        return cls.apply(project, normalized, user_id=user_id, manifest_row=row)

    @classmethod
    def _execute_step(cls, project, env, step, user_id) -> Dict[str, Any]:
        stype = step['type']
        # thread the step's service name into the payload so handlers can resolve
        # an app that was created earlier in the same apply (app_id was None at
        # plan time for brand-new services).
        payload = dict(step.get('payload', {}))
        payload.setdefault('service', step.get('service'))
        handler = getattr(cls, f'_do_{stype}', None)
        if handler is None:
            return {'noop': True}
        return handler(project, env, payload, user_id) or {}

    # -- step handlers ------------------------------------------------------

    @classmethod
    def _do_warn(cls, project, env, payload, user_id):
        return {'warned': True}

    @classmethod
    def _do_provision_db(cls, project, env, payload, user_id):
        from app.services.managed_database_service import ManagedDatabaseService
        managed = ManagedDatabaseService.record_provisioned(
            engine=payload['engine'], name=payload['name'],
            workspace_id=project.workspace_id,
        )
        return {'managed_database_id': managed.id}

    @classmethod
    def _do_create_app(cls, project, env, payload, user_id):
        import json
        overrides = {}
        if payload.get('build_command'):
            overrides['build_command'] = payload['build_command']
        if payload.get('start_command'):
            overrides['start_command'] = payload['start_command']
        app = Application(
            name=payload['name'],
            app_type=payload.get('app_type') or 'docker',
            status='stopped',
            port=payload.get('port'),
            healthcheck_path=payload.get('healthcheck_path'),
            cpu_limit=payload.get('cpu'),
            memory_limit=payload.get('memory'),
            buildpack_overrides=json.dumps(overrides) if overrides else None,
            source='manifest',
            user_id=user_id,
            project_id=project.id,
            environment_id=env.id if env else None,
            server_id=payload.get('server_id'),
        )
        db.session.add(app)
        db.session.commit()
        return {'app_id': app.id, 'server_id': app.server_id}

    @classmethod
    def _do_update_app(cls, project, env, payload, user_id):
        import json
        app = Application.query.get(payload['app_id'])
        if not app:
            raise RuntimeError('app not found')
        changes = payload['changes']
        if 'port' in changes:
            app.port = changes['port']
        if 'healthcheck_path' in changes:
            app.healthcheck_path = changes['healthcheck_path']
        if 'cpu' in changes:
            app.cpu_limit = changes['cpu']
        if 'memory' in changes:
            app.memory_limit = changes['memory']
        if 'build_command' in changes or 'start_command' in changes:
            overrides = {}
            if app.buildpack_overrides:
                try:
                    overrides = json.loads(app.buildpack_overrides) or {}
                except Exception:
                    overrides = {}
            if 'build_command' in changes:
                overrides['build_command'] = changes['build_command']
            if 'start_command' in changes:
                overrides['start_command'] = changes['start_command']
            app.buildpack_overrides = json.dumps(overrides)
        db.session.commit()
        return {'app_id': app.id, 'changed': list(changes.keys())}

    @classmethod
    def _do_set_env(cls, project, env, payload, user_id):
        from app.services.env_service import EnvService
        app_id = payload.get('app_id') or cls._resolve_app_id(project, payload)
        count, errors = EnvService.bulk_set_env_vars(app_id, payload['env'], user_id)
        if errors:
            raise RuntimeError('; '.join(errors))
        return {'set': count}

    @classmethod
    def _do_set_env_ref(cls, project, env, payload, user_id):
        from app.services.env_service import EnvService
        app_id = payload.get('app_id') or cls._resolve_app_id(project, payload)
        ref = payload['ref']
        if payload.get('generate'):
            secret_name = ref['secret']
            cls._ensure_generated_secret(secret_name)
            ref = {'kind': 'secret', 'secret': secret_name}
        _var, _created, err = EnvService.set_env_reference(app_id, payload['key'], ref, user_id)
        if err:
            raise RuntimeError(err)
        return {'key': payload['key'], 'ref': ref}

    @classmethod
    def _do_ensure_volume(cls, project, env, payload, user_id):
        from app.services.volume_service import VolumeService
        app = Application.query.get(payload.get('app_id') or cls._resolve_app_id(project, payload))
        if not app:
            raise RuntimeError('app not found')
        if any(v.mount_path == payload['mount_path'] for v in (app.volumes or [])):
            return {'exists': True}
        vol = VolumeService.create(app, payload['name'], payload['mount_path'])
        return {'volume_id': getattr(vol, 'id', None)}

    @classmethod
    def _do_open_port(cls, project, env, payload, user_id):
        from app.services.app_port_service import AppPortService
        app = Application.query.get(payload.get('app_id') or cls._resolve_app_id(project, payload))
        if not app:
            raise RuntimeError('app not found')
        ports = payload['ports']
        AppPortService.set_ports(app, ports)
        db.session.commit()
        firewall = AppPortService.open_firewall(ports)
        return {'ports': len(ports), 'firewall': firewall}

    @classmethod
    def _do_upsert_backup_policy(cls, project, env, payload, user_id):
        from app.services.backup_policy_service import BackupPolicyService
        schedule_cron = _SCHEDULE_CRON.get(payload['schedule'], '0 2 * * *')
        fields = {'enabled': True, 'schedule_cron': schedule_cron,
                  'retention_count': payload['retain']}
        if payload['target'] == 'database':
            from app.services.managed_database_service import ManagedDatabaseService
            managed = ManagedDatabase.query.filter_by(
                engine=payload['engine'], name=payload['db_name']).first()
            if not managed:
                raise RuntimeError('managed database not found for backup policy')
            ManagedDatabaseService.protect(managed, fields=fields)
            return {'policy': 'database', 'db': payload['db_name']}
        # files
        app_id = payload.get('app_id') or cls._resolve_app_id(project, payload)
        policy = BackupPolicyService.get_or_create_policy(
            target_type='files', target_id=app_id, target_subtype='pathlist',
            target_meta={'paths': [payload['mount_path']], 'managed_by': 'manifest'})
        BackupPolicyService.update_policy(policy, fields)
        return {'policy': 'files', 'policy_id': policy.id}

    @classmethod
    def _do_attach_domain(cls, project, env, payload, user_id):
        from app.services.domain_attach_service import DomainAttachService
        app_id = payload.get('app_id') or (
            cls._resolve_app_id(project, payload) if payload.get('service') else None)
        if not app_id:
            return {'skipped': 'no target service'}
        app = Application.query.get(app_id)
        if not app:
            raise RuntimeError('app not found for domain')
        result = DomainAttachService.attach(app, payload['host'], ssl=payload.get('ssl', 'auto'))
        return result

    # -- snapshots + job ----------------------------------------------------

    @classmethod
    def _snapshot_existing(cls, project, normalized, tag):
        from app.services.configuration_service import ConfigurationService
        for svc in normalized.get('services', []):
            if svc['kind'] != 'app':
                continue
            app = cls._find_app(project, svc['name'])
            if app is None:
                continue
            try:
                ConfigurationService.create_snapshot(app)
            except Exception:
                db.session.rollback()

    @classmethod
    def _create_job(cls, project, user_id, plan):
        from app.models.deployment_job import DeploymentJob
        job = DeploymentJob(
            id=str(uuid.uuid4()), kind='manifest.apply', status='running',
            requested_by=user_id, trigger='manual', started_at=datetime.utcnow(),
        )
        job.set_plan({'steps': plan['steps']})
        job.total_steps = plan['step_count']
        db.session.add(job)
        db.session.commit()
        return job

    @classmethod
    def _finish_job(cls, job, failed, results):
        job.status = 'failed' if failed else 'succeeded'
        job.completed_at = datetime.utcnow()
        job.current_step = sum(1 for r in results if r['status'] in ('ok', 'error'))
        job.set_result({'results': results})
        db.session.commit()

    @classmethod
    def _log(cls, job, idx, level, message, data=None):
        # Best-effort per-step log. Wrapped in a savepoint so a logging failure
        # (e.g. SQLite BigInteger PK) never poisons the apply transaction. The
        # authoritative per-step record also lives in job.result.
        from app.models.deployment_job import DeploymentJobLog
        import json
        try:
            with db.session.begin_nested():
                db.session.add(DeploymentJobLog(
                    job_id=job.id, step_index=idx, level=level, message=message,
                    data=json.dumps(data) if data else None))
        except Exception:
            pass

    # -- helpers ------------------------------------------------------------

    @classmethod
    def _app_field_changes(cls, app: Application, resolved: Dict[str, Any]) -> Dict[str, Any]:
        import json
        changes = {}
        if resolved.get('port') is not None and app.port != resolved['port']:
            changes['port'] = resolved['port']
        if resolved.get('healthcheck_path') and app.healthcheck_path != resolved['healthcheck_path']:
            changes['healthcheck_path'] = resolved['healthcheck_path']
        if resolved.get('cpu') and app.cpu_limit != resolved['cpu']:
            changes['cpu'] = resolved['cpu']
        if resolved.get('memory') and app.memory_limit != resolved['memory']:
            changes['memory'] = resolved['memory']
        overrides = {}
        if app.buildpack_overrides:
            try:
                overrides = json.loads(app.buildpack_overrides) or {}
            except Exception:
                overrides = {}
        if resolved.get('build_command') and overrides.get('build_command') != resolved['build_command']:
            changes['build_command'] = resolved['build_command']
        if resolved.get('start_command') and overrides.get('start_command') != resolved['start_command']:
            changes['start_command'] = resolved['start_command']
        return changes

    @classmethod
    def _backup_policy_current(cls, target_type: str, target_id: Optional[int],
                               backup: Dict[str, Any]) -> bool:
        """True when an enabled policy already matches the declared schedule/retain."""
        if not target_id:
            return False
        from app.models.backup_policy import BackupPolicy
        pol = BackupPolicy.query.filter_by(
            target_type=target_type, target_id=target_id, enabled=True).first()
        if not pol:
            return False
        want_cron = _SCHEDULE_CRON.get(backup['schedule'], '0 2 * * *')
        return pol.schedule_cron == want_cron and pol.retention_count == backup['retain']

    @classmethod
    def _set_env_ref_step(cls, name, app, key, ref, generate=False):
        verb = 'Generate secret for' if generate else 'Bind reference'
        return {
            'type': 'set_env_ref', 'service': name,
            'description': f'{verb} `{key}` on `{name}`',
            'payload': {'app_id': app.id if app else None, 'key': key,
                        'ref': ref, 'generate': generate},
        }

    @staticmethod
    def _live_env_vars(app: Application) -> Dict[str, Any]:
        from app.models.env_variable import EnvironmentVariable
        return {ev.key: ev for ev in
                EnvironmentVariable.query.filter_by(application_id=app.id).all()}

    @staticmethod
    def _ref_changed(live_var, desired: Dict[str, Any]) -> bool:
        if live_var is None:
            return True
        current = live_var.get_reference()
        return current != desired

    @staticmethod
    def _secret_exists(name: str) -> bool:
        from app.services.env_reference_service import EnvReferenceResolver
        return EnvReferenceResolver.secret_exists(name)

    @staticmethod
    def _generated_secret_name(service: str, key: str) -> str:
        import re
        return re.sub(r'[^a-z0-9]+', '_', f'{service}_{key}'.lower()).strip('_')

    @staticmethod
    def _ensure_generated_secret(secret_name: str):
        """Get-or-create a random vault secret in the `manifest` vault."""
        import secrets as _secrets
        from app.models.secret_vault import SecretVault, Secret
        from app.utils.crypto import encrypt_secret
        existing = Secret.query.filter_by(name=secret_name).first()
        if existing:
            return existing
        vault = SecretVault.query.filter_by(slug='manifest').first()
        if not vault:
            vault = SecretVault(name='Manifest', slug='manifest',
                                description='Auto-generated manifest secrets')
            db.session.add(vault)
            db.session.flush()
        secret = Secret(vault_id=vault.id, name=secret_name,
                        encrypted_value=encrypt_secret(_secrets.token_urlsafe(32)),
                        description='Generated by a serverkit.yaml manifest')
        db.session.add(secret)
        db.session.flush()
        return secret

    @staticmethod
    def _resolve_server_id(server_ref: str) -> Optional[str]:
        """Resolve a fleet target name/id to a Server.id (#21). None if unknown."""
        if not server_ref:
            return None
        try:
            from app.models.server import Server
        except Exception:
            return None
        server = Server.query.filter_by(id=server_ref).first() \
            or Server.query.filter_by(name=server_ref).first()
        return server.id if server else None

    @staticmethod
    def _find_app(project: Project, name: Optional[str]) -> Optional[Application]:
        if not name:
            return None
        return Application.query.filter_by(project_id=project.id, name=name).first()

    @classmethod
    def _resolve_app_id(cls, project, payload):
        app = cls._find_app(project, payload.get('service'))
        if not app:
            raise RuntimeError(f'app `{payload.get("service")}` not found')
        return app.id

    @staticmethod
    def _live_env(app: Application) -> Dict[str, Any]:
        from app.services.env_service import EnvService
        try:
            return EnvService.get_env_dict(app.id)
        except Exception:
            return {}

    @staticmethod
    def _default_environment(project: Project) -> Optional[Environment]:
        env = Environment.query.filter_by(project_id=project.id, is_default=True).first()
        if env:
            return env
        return Environment.query.filter_by(project_id=project.id).first()

    @staticmethod
    def _summarize_plan(steps: List[Dict[str, Any]]) -> str:
        if not steps:
            return 'no changes — live state matches the manifest'
        counts: Dict[str, int] = {}
        for s in steps:
            counts[s['type']] = counts.get(s['type'], 0) + 1
        return ', '.join(f'{v} {k.replace("_", " ")}' for k, v in counts.items())

    @staticmethod
    def _step_ref(step):
        return {'type': step['type'], 'service': step.get('service'),
                'description': step['description']}

    @staticmethod
    def _stringify(value):
        return None if value is None else str(value)

    @staticmethod
    def _slug(text):
        import re
        return re.sub(r'[^a-z0-9]+', '-', (text or '').lower()).strip('-') or 'vol'
