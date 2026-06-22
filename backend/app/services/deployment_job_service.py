"""Deployment job orchestration service."""

import os
import threading
import uuid
from datetime import datetime
from typing import Dict, Optional

from flask import current_app, has_app_context

from app import db
from app.models import Application, Server
from app.models.deployment_job import DeploymentJob
from app.services.deployment_runner import DeploymentPlanRunner
from app.services.docker_service import DockerService
from app.services.template_service import TemplateService
from app.services.telemetry_service import generate_correlation_id


class DeploymentJobService:
    """Creates and runs deployment jobs with persistent logs."""

    @classmethod
    def install_template(
        cls,
        template_id: str,
        app_name: str,
        user_variables: Dict = None,
        user_id: int = None,
        server_id: Optional[str] = None,
        wait: bool = False,
    ) -> Dict:
        """Create a template installation job and optionally run it synchronously."""
        normalized_server_id = cls._normalize_server_id(server_id)

        existing = Application.query.filter_by(name=app_name, server_id=normalized_server_id).first()
        if existing:
            return {
                'success': False,
                'error': f'An application named "{app_name}" already exists on this target server'
            }

        if normalized_server_id:
            server = Server.query.get(normalized_server_id)
            if not server:
                return {'success': False, 'error': 'Target server not found'}

        plan_result = TemplateService.build_install_plan(
            template_id=template_id,
            app_name=app_name,
            user_variables=user_variables or {},
            user_id=user_id,
            server_id=normalized_server_id,
        )
        if not plan_result.get('success'):
            return plan_result

        app_path = plan_result['app_path']
        if not normalized_server_id and os.path.exists(app_path):
            return {'success': False, 'error': f"App directory already exists: {app_path}"}

        job = DeploymentJob(
            id=str(uuid.uuid4()),
            kind='template_install',
            status='pending',
            target_server_id=normalized_server_id,
            requested_by=user_id,
            trigger='manual',
            correlation_id=generate_correlation_id(),
        )
        job.set_plan(plan_result['plan'])
        db.session.add(job)
        db.session.commit()

        if wait:
            cls.run_job(job.id)
        else:
            cls._start_background_job(job.id)

        return {
            'success': True,
            'job_id': job.id,
            'job': job.to_dict(include_logs=True),
        }

    @classmethod
    def run_job(cls, job_id: str) -> Dict:
        """Run a job by ID."""
        job = DeploymentJob.query.get(job_id)
        if not job:
            return {'success': False, 'error': 'Deployment job not found'}

        if job.kind != 'template_install':
            return {'success': False, 'error': f'Unsupported deployment job kind: {job.kind}'}

        runner = DeploymentPlanRunner(job)
        run_result = runner.run()

        if not run_result.get('success'):
            return run_result

        try:
            return cls._finalize_template_install(job)
        except Exception as exc:
            job.status = 'failed'
            job.error_message = str(exc)
            job.completed_at = datetime.utcnow()
            db.session.commit()
            runner.log('error', f'Failed to finalize deployment: {exc}')
            return {'success': False, 'error': str(exc)}

    @classmethod
    def get_job(cls, job_id: str, include_logs: bool = True) -> Optional[Dict]:
        job = DeploymentJob.query.get(job_id)
        return job.to_dict(include_logs=include_logs) if job else None

    @classmethod
    def list_jobs(cls, status: str = None, target_server_id: str = None, limit: int = 50):
        query = DeploymentJob.query.order_by(DeploymentJob.created_at.desc())
        if status:
            query = query.filter_by(status=status)
        if target_server_id:
            query = query.filter_by(target_server_id=cls._normalize_server_id(target_server_id))
        return [job.to_dict() for job in query.limit(limit).all()]

    @classmethod
    def _finalize_template_install(cls, job: DeploymentJob) -> Dict:
        plan = job.get_plan()
        app_name = plan.get('app_name')
        app_path = plan.get('app_path')
        app_port = plan.get('port')
        template_name = plan.get('template_name')

        app = Application(
            name=app_name,
            app_type='docker',
            status='running',
            root_path=app_path,
            docker_image=template_name,
            user_id=job.requested_by or 1,
            port=app_port,
            server_id=job.target_server_id,
        )
        db.session.add(app)
        db.session.commit()

        port_accessible = None
        if not job.target_server_id and app_port:
            port_accessible = DockerService.check_port_accessible(app_port).get('accessible', False)

        config = TemplateService.get_config()
        config.setdefault('installed', {})[str(app.id)] = {
            'template_id': plan.get('template_id'),
            'template_version': plan.get('template_version'),
            'app_id': app.id,
            'app_name': app_name,
            'server_id': job.target_server_id,
            'installed_at': datetime.utcnow().isoformat(),
        }
        TemplateService.save_config(config)

        result = {
            'success': True,
            'app_id': app.id,
            'app_name': app.name,
            'app_path': app_path,
            'server_id': job.target_server_id,
            'port': app_port,
            'port_accessible': port_accessible,
        }

        job.app_id = app.id
        job.set_result({**job.get_result(), **result})
        db.session.commit()

        DeploymentPlanRunner(job).log('info', f'Application record created: {app.name}', result)

        return {'success': True, 'job': job.to_dict(include_logs=True), **result}

    @classmethod
    def _start_background_job(cls, job_id: str):
        flask_app = current_app._get_current_object() if has_app_context() else None

        def _target():
            if flask_app:
                with flask_app.app_context():
                    cls.run_job(job_id)
            else:
                from app import create_app
                app = create_app()
                with app.app_context():
                    cls.run_job(job_id)

        thread = threading.Thread(target=_target, daemon=True)
        thread.start()

    @staticmethod
    def _normalize_server_id(server_id: Optional[str]) -> Optional[str]:
        if not server_id or server_id == 'local':
            return None
        return server_id
