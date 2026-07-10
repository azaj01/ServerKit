"""One-shot appliance first-boot bootstrap (plan 35).

Some appliances generate a config/certificate tree exactly once, on first run.
Abusing a compose init container leaves it behind; abusing an entrypoint reruns
it every deploy. Instead this runs the declared ``bootstrap.command`` ONCE via
``docker compose run --rm <service> <command>`` — after the volumes exist and
before the first ``up`` — and flips ``Application.bootstrap_done`` on success so
it never re-runs. Failure is a visible, retryable apply-step failure.

The runner is injectable (``set_runner``) so the apply engine can be proven
without Docker.
"""

import shlex
from typing import Any, Callable, Dict, Optional


class BootstrapService:

    _runner: Optional[Callable] = None  # test seam

    @classmethod
    def set_runner(cls, fn: Optional[Callable]) -> None:
        """Install/clear an injected runner ``fn(app, service, command, timeout)``
        returning ``{'success': bool, 'output'|'error': str}``."""
        cls._runner = fn

    @classmethod
    def run_once(cls, app, command: str, timeout_seconds: Optional[int] = None,
                 service: Optional[str] = None) -> Dict[str, Any]:
        service = service or app.name
        if cls._runner is not None:
            return cls._runner(app, service, command, timeout_seconds)
        return cls._docker_run(app, service, command, timeout_seconds)

    @staticmethod
    def _docker_run(app, service: str, command: str,
                    timeout_seconds: Optional[int]) -> Dict[str, Any]:
        import subprocess
        root = getattr(app, 'root_path', None)
        if not root:
            return {'success': False,
                    'error': 'app has no deployed compose project to run bootstrap in'}
        cmd = ['docker', 'compose', 'run', '--rm', service] + shlex.split(command)
        try:
            proc = subprocess.run(cmd, cwd=root, capture_output=True, text=True,
                                  timeout=timeout_seconds or 300)
        except subprocess.TimeoutExpired:
            return {'success': False,
                    'error': f'bootstrap timed out after {timeout_seconds or 300}s'}
        except Exception as exc:  # docker missing, etc.
            return {'success': False, 'error': str(exc)}
        if proc.returncode != 0:
            return {'success': False,
                    'error': (proc.stderr or proc.stdout or 'bootstrap failed').strip()[:500]}
        return {'success': True, 'output': (proc.stdout or '').strip()[:500]}
