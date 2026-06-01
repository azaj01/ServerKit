import os
import subprocess
import secrets
import string
import shutil
import json
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path

from app import paths
from app.utils.system import run_privileged, privileged_cmd


class WordPressService:
    """Service for WordPress installation and management."""

    WP_CLI_PATH = '/usr/local/bin/wp'
    WP_DOWNLOAD_URL = 'https://wordpress.org/latest.tar.gz'
    BACKUP_DIR = paths.WP_BACKUP_DIR

    # Security headers for wp-config.php
    SECURITY_CONSTANTS = '''
// ServerKit Security Hardening
define('DISALLOW_FILE_EDIT', true);
define('DISALLOW_FILE_MODS', false);
define('FORCE_SSL_ADMIN', true);
define('WP_AUTO_UPDATE_CORE', 'minor');

// Security Keys (auto-generated)
'''

    @classmethod
    def is_wp_cli_installed(cls) -> bool:
        """Check if WP-CLI is installed."""
        return os.path.exists(cls.WP_CLI_PATH)

    @classmethod
    def install_wp_cli(cls) -> Dict:
        """Install WP-CLI."""
        try:
            commands = [
                ['curl', '-O', 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar'],
                ['chmod', '+x', 'wp-cli.phar'],
            ]

            for cmd in commands:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                if result.returncode != 0:
                    return {'success': False, 'error': result.stderr}

            result = run_privileged(['mv', 'wp-cli.phar', cls.WP_CLI_PATH], timeout=120)
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            return {'success': True, 'message': 'WP-CLI installed successfully'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def wp_cli(cls, path: str, command: List[str], user: str = 'www-data', timeout: int = None) -> Dict:
        """Execute a WP-CLI command. Auto-detects Docker-based sites.

        ``timeout`` overrides the default per-call wall-clock limit; pass a
        generous value for long operations like ``db export``/``db import`` so a
        large database is never truncated mid-restore.
        """
        # Check if this is a Docker-based site (has docker-compose.yml)
        compose_file = os.path.join(path, 'docker-compose.yml')
        if os.path.exists(compose_file):
            return cls._wp_cli_docker(path, command, timeout=timeout)

        if not cls.is_wp_cli_installed():
            install_result = cls.install_wp_cli()
            if not install_result['success']:
                return install_result

        try:
            cmd = privileged_cmd([cls.WP_CLI_PATH, '--path=' + path] + command, user=user)
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout or 300,
                cwd=path
            )

            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr if result.returncode != 0 else None
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Command timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _wp_cli_docker(cls, path: str, command: List[str], timeout: int = None) -> Dict:
        """Execute a WP-CLI command inside a Docker WordPress container."""
        # Resolve container name from the Application record
        container_name = None
        from app.models import Application
        app = Application.query.filter_by(root_path=path).first()
        if app:
            container_name = app.name

        if not container_name:
            # Fallback: derive from directory name
            container_name = os.path.basename(path)

        try:
            # Ensure WP-CLI is available inside the container
            check = subprocess.run(
                ['docker', 'exec', container_name, 'which', 'wp'],
                capture_output=True, text=True, timeout=10
            )
            if check.returncode != 0:
                # Install WP-CLI inside the container
                install_cmd = (
                    'curl -sO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar'
                    ' && chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp'
                )
                install = subprocess.run(
                    ['docker', 'exec', container_name, 'bash', '-c', install_cmd],
                    capture_output=True, text=True, timeout=120
                )
                if install.returncode != 0:
                    return {'success': False, 'error': f'Failed to install WP-CLI in container: {install.stderr}'}

            # Run wp-cli inside the WordPress container
            cmd = ['docker', 'exec', container_name, 'wp', '--allow-root'] + command
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout or 60
            )

            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr if result.returncode != 0 else None
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Command timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def install_wordpress(cls, path: str, config: Dict) -> Dict:
        """Install WordPress at the specified path."""
        site_url = config.get('site_url')
        site_title = config.get('site_title', 'My WordPress Site')
        admin_user = config.get('admin_user', 'admin')
        admin_password = config.get('admin_password') or cls._generate_password()
        admin_email = config.get('admin_email')
        db_name = config.get('db_name')
        db_user = config.get('db_user')
        db_password = config.get('db_password')
        db_host = config.get('db_host', 'localhost')
        db_prefix = config.get('db_prefix', 'wp_')

        if not all([site_url, admin_email, db_name, db_user, db_password]):
            return {'success': False, 'error': 'Missing required configuration'}

        try:
            # Create directory
            run_privileged(['mkdir', '-p', path])
            run_privileged(['chown', 'www-data:www-data', path])

            # Download WordPress
            download_result = cls.wp_cli(path, ['core', 'download', '--locale=en_US'])
            if not download_result['success']:
                return download_result

            # Create wp-config.php
            config_result = cls.wp_cli(path, [
                'config', 'create',
                f'--dbname={db_name}',
                f'--dbuser={db_user}',
                f'--dbpass={db_password}',
                f'--dbhost={db_host}',
                f'--dbprefix={db_prefix}'
            ])
            if not config_result['success']:
                return config_result

            # Install WordPress
            install_result = cls.wp_cli(path, [
                'core', 'install',
                f'--url={site_url}',
                f'--title={site_title}',
                f'--admin_user={admin_user}',
                f'--admin_password={admin_password}',
                f'--admin_email={admin_email}',
                '--skip-email'
            ])
            if not install_result['success']:
                return install_result

            # Set permissions
            cls._set_permissions(path)

            # Apply security hardening
            cls.harden_wordpress(path)

            return {
                'success': True,
                'message': 'WordPress installed successfully',
                'admin_user': admin_user,
                'admin_password': admin_password,
                'path': path,
                'url': site_url
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_php_info(cls, path: str) -> Dict:
        """Read the LIVE PHP version + key ini limits from inside the running
        WordPress container via the Docker-aware wp_cli bridge. Read-only.
        """
        info = {}
        ver = cls.wp_cli(path, ['eval', 'echo phpversion();'])
        if ver.get('success'):
            info['php_version'] = (ver.get('output') or '').strip()
        php = (
            "foreach(['memory_limit','upload_max_filesize','post_max_size',"
            "'max_execution_time','max_input_time'] as $k){"
            "echo $k.'='.ini_get($k).\"\\n\";}"
        )
        limits = cls.wp_cli(path, ['eval', php])
        parsed = {}
        if limits.get('success'):
            for line in (limits.get('output') or '').splitlines():
                line = line.strip()
                if '=' in line:
                    k, v = line.split('=', 1)
                    parsed[k.strip()] = v.strip()
        info['limits'] = parsed
        info['source'] = 'container'
        return info

    @classmethod
    def get_available_php_versions(cls) -> List[str]:
        """Official wordpress image PHP variant tags we support switching to."""
        return ['8.1', '8.2', '8.3']

    @classmethod
    def set_php_version(cls, path: str, version: str) -> Dict:
        """Switch a Docker WP site to a different PHP by rewriting the compose
        image tag (wordpress:<wp>-php<version>-apache) and recreating the app
        container. Volumes/DB persist. NOT host php-fpm. Brief downtime.
        """
        from app.services.docker_service import DockerService
        if version not in cls.get_available_php_versions():
            return {'success': False, 'error': f'Unsupported PHP version: {version}'}
        compose_file = os.path.join(path, 'docker-compose.yml')
        if not os.path.exists(compose_file):
            return {'success': False, 'error': 'Not a Docker-stack site (no docker-compose.yml)'}
        try:
            with open(compose_file, 'r') as f:
                content = f.read()
            import re as _re
            m = _re.search(r'image:\s*wordpress:([^\s]+)', content)
            if not m:
                return {'success': False, 'error': 'wordpress image line not found in compose file'}
            current_tag = m.group(1)
            # Derive the WP core from the existing tag; fall back to the known core for
            # legacy compose files that still carry an unresolved ${VERSION...} literal,
            # so the switch never drops the core pin (e.g. -> php8.2-apache).
            wp_core = current_tag.split('-')[0] if current_tag and current_tag[0].isdigit() else cls.WP_CORE
            new_tag = f'{wp_core}-php{version}-apache'
            new_content = content.replace(f'image: wordpress:{current_tag}', f'image: wordpress:{new_tag}')
            with open(compose_file, 'w') as f:
                f.write(new_content)
            up = DockerService.compose_up(path, detach=True, build=False)
            if not up.get('success'):
                return {'success': False, 'error': up.get('error') or 'compose up failed', 'image_tag': new_tag}
            cls._wait_for_wp_ready(path)
            live = cls.get_php_info(path).get('php_version')
            return {'success': True, 'message': f'Switched to PHP {version}', 'image_tag': new_tag, 'php_version': live}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def is_multisite(cls, path: str) -> bool:
        """Return True if the WordPress install at ``path`` is a multisite network.

        Uses ``wp core is-multisite`` (exit 0 = multisite, non-zero = single).
        Routes through the Docker-aware wp_cli bridge automatically.
        """
        result = cls.wp_cli(path, ['core', 'is-multisite'])
        return bool(result.get('success'))

    @classmethod
    def get_wordpress_info(cls, path: str) -> Optional[Dict]:
        """Get WordPress installation info."""
        if not os.path.exists(os.path.join(path, 'wp-config.php')):
            return None

        info = {'path': path}

        # Get core version
        version_result = cls.wp_cli(path, ['core', 'version'])
        if version_result['success']:
            info['version'] = version_result['output'].strip()

        # Check for updates
        update_result = cls.wp_cli(path, ['core', 'check-update', '--format=json'])
        if update_result['success'] and update_result['output'].strip():
            try:
                updates = json.loads(update_result['output'])
                info['update_available'] = len(updates) > 0
                info['latest_version'] = updates[0]['version'] if updates else info.get('version')
            except Exception:
                info['update_available'] = False

        # Get site URL
        url_result = cls.wp_cli(path, ['option', 'get', 'siteurl'])
        if url_result['success']:
            info['url'] = url_result['output'].strip()

        # Get site title
        title_result = cls.wp_cli(path, ['option', 'get', 'blogname'])
        if title_result['success']:
            info['title'] = title_result['output'].strip()

        # Get admin email
        email_result = cls.wp_cli(path, ['option', 'get', 'admin_email'])
        if email_result['success']:
            info['admin_email'] = email_result['output'].strip()

        # Detect multisite (wp core is-multisite: exit 0 = multisite)
        info['multisite'] = cls.is_multisite(path)

        return info

    @classmethod
    def update_wordpress(cls, path: str) -> Dict:
        """Update WordPress core."""
        result = cls.wp_cli(path, ['core', 'update'])
        if result['success']:
            # Update database if needed
            cls.wp_cli(path, ['core', 'update-db'])
            return {'success': True, 'message': 'WordPress updated successfully'}
        return result

    @classmethod
    def get_plugins(cls, path: str) -> List[Dict]:
        """Get list of installed plugins."""
        result = cls.wp_cli(path, ['plugin', 'list', '--format=json'])
        if result['success']:
            try:
                return json.loads(result['output'])
            except Exception:
                return []
        return []

    @classmethod
    def install_plugin(cls, path: str, plugin: str, activate: bool = True) -> Dict:
        """Install a WordPress plugin."""
        cmd = ['plugin', 'install', plugin]
        if activate:
            cmd.append('--activate')

        result = cls.wp_cli(path, cmd)
        if result['success']:
            return {'success': True, 'message': f'Plugin {plugin} installed'}
        return result

    @classmethod
    def uninstall_plugin(cls, path: str, plugin: str) -> Dict:
        """Uninstall a WordPress plugin."""
        # Deactivate first
        cls.wp_cli(path, ['plugin', 'deactivate', plugin])

        result = cls.wp_cli(path, ['plugin', 'delete', plugin])
        if result['success']:
            return {'success': True, 'message': f'Plugin {plugin} uninstalled'}
        return result

    @classmethod
    def activate_plugin(cls, path: str, plugin: str) -> Dict:
        """Activate a plugin."""
        result = cls.wp_cli(path, ['plugin', 'activate', plugin])
        return result

    @classmethod
    def deactivate_plugin(cls, path: str, plugin: str) -> Dict:
        """Deactivate a plugin."""
        result = cls.wp_cli(path, ['plugin', 'deactivate', plugin])
        return result

    @classmethod
    def update_plugins(cls, path: str, plugins: List[str] = None) -> Dict:
        """Update plugins."""
        cmd = ['plugin', 'update']
        if plugins:
            cmd.extend(plugins)
        else:
            cmd.append('--all')

        result = cls.wp_cli(path, cmd)
        if result['success']:
            return {'success': True, 'message': 'Plugins updated'}
        return result

    @classmethod
    def update_themes(cls, path: str, themes: List[str] = None) -> Dict:
        """Update themes."""
        cmd = ['theme', 'update']
        if themes:
            cmd.extend(themes)
        else:
            cmd.append('--all')

        result = cls.wp_cli(path, cmd)
        if result['success']:
            return {'success': True, 'message': 'Themes updated'}
        return result

    @classmethod
    def get_themes(cls, path: str) -> List[Dict]:
        """Get list of installed themes."""
        result = cls.wp_cli(path, ['theme', 'list', '--format=json'])
        if result['success']:
            try:
                return json.loads(result['output'])
            except Exception:
                return []
        return []

    @classmethod
    def install_theme(cls, path: str, theme: str, activate: bool = False) -> Dict:
        """Install a WordPress theme."""
        cmd = ['theme', 'install', theme]
        if activate:
            cmd.append('--activate')

        result = cls.wp_cli(path, cmd)
        if result['success']:
            return {'success': True, 'message': f'Theme {theme} installed'}
        return result

    @classmethod
    def activate_theme(cls, path: str, theme: str) -> Dict:
        """Activate a theme."""
        result = cls.wp_cli(path, ['theme', 'activate', theme])
        return result

    @classmethod
    def backup_wordpress(cls, path: str, include_db: bool = True) -> Dict:
        """Create a backup of WordPress installation."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        site_name = os.path.basename(path)
        backup_name = f'{site_name}_{timestamp}'
        backup_path = os.path.join(cls.BACKUP_DIR, backup_name)

        try:
            # Create backup directory
            run_privileged(['mkdir', '-p', backup_path])

            # Backup files
            files_backup = os.path.join(backup_path, 'files.tar.gz')
            run_privileged(
                ['tar', '-czf', files_backup, '-C', os.path.dirname(path), os.path.basename(path)],
                timeout=600
            )

            # Backup database
            if include_db:
                db_backup = os.path.join(backup_path, 'database.sql')
                result = cls.wp_cli(path, ['db', 'export', db_backup])
                if not result['success']:
                    return {'success': False, 'error': f'Database backup failed: {result.get("error")}'}

            # Get backup size
            try:
                size = sum(os.path.getsize(os.path.join(backup_path, f))
                          for f in os.listdir(backup_path)
                          if os.path.isfile(os.path.join(backup_path, f)))
            except Exception:
                size = 0

            return {
                'success': True,
                'message': 'Backup created successfully',
                'backup_path': backup_path,
                'backup_name': backup_name,
                'size': size,
                'timestamp': timestamp
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_backups(cls, site_name: str = None) -> List[Dict]:
        """List available backups."""
        backups = []

        if not os.path.exists(cls.BACKUP_DIR):
            return backups

        try:
            for name in os.listdir(cls.BACKUP_DIR):
                backup_path = os.path.join(cls.BACKUP_DIR, name)
                if os.path.isdir(backup_path):
                    if site_name and not name.startswith(site_name):
                        continue

                    # Get backup info
                    files_backup = os.path.join(backup_path, 'files.tar.gz')
                    db_backup = os.path.join(backup_path, 'database.sql')

                    size = 0
                    for f in [files_backup, db_backup]:
                        if os.path.exists(f):
                            size += os.path.getsize(f)

                    # Parse timestamp from name
                    parts = name.rsplit('_', 2)
                    if len(parts) >= 3:
                        timestamp = f'{parts[-2]}_{parts[-1]}'
                    else:
                        timestamp = 'unknown'

                    backups.append({
                        'name': name,
                        'path': backup_path,
                        'has_files': os.path.exists(files_backup),
                        'has_database': os.path.exists(db_backup),
                        'size': size,
                        'timestamp': timestamp
                    })
        except Exception:
            pass

        return sorted(backups, key=lambda x: x['timestamp'], reverse=True)

    @classmethod
    def restore_backup(cls, backup_name: str, target_path: str) -> Dict:
        """Restore a WordPress backup."""
        backup_path = os.path.join(cls.BACKUP_DIR, backup_name)

        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup not found'}

        try:
            files_backup = os.path.join(backup_path, 'files.tar.gz')
            db_backup = os.path.join(backup_path, 'database.sql')

            # Restore files
            if os.path.exists(files_backup):
                # Remove existing files
                if os.path.exists(target_path):
                    run_privileged(['rm', '-rf', target_path])

                # Extract backup
                run_privileged(
                    ['tar', '-xzf', files_backup, '-C', os.path.dirname(target_path)],
                    timeout=600
                )

            # Restore database
            if os.path.exists(db_backup):
                result = cls.wp_cli(target_path, ['db', 'import', db_backup])
                if not result['success']:
                    return {'success': False, 'error': f'Database restore failed: {result.get("error")}'}

            # Fix permissions
            cls._set_permissions(target_path)

            return {'success': True, 'message': 'Backup restored successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_backup(cls, backup_name: str) -> Dict:
        """Delete a backup."""
        backup_path = os.path.join(cls.BACKUP_DIR, backup_name)

        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup not found'}

        try:
            run_privileged(['rm', '-rf', backup_path])
            return {'success': True, 'message': 'Backup deleted'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _wait_for_wp_ready(cls, path: str, timeout: int = 60) -> bool:
        """Poll the WP container (via the Docker-aware wp_cli bridge) until
        WordPress core files + DB are reachable so `wp` commands can run.

        Returns True once `wp core version` succeeds, else False on timeout.
        """
        import time as _time
        deadline = _time.time() + timeout
        while _time.time() < deadline:
            check = cls.wp_cli(path, ['core', 'version'])
            if check.get('success'):
                return True
            _time.sleep(3)
        return False

    @classmethod
    def _harden_docker_site(cls, path: str) -> List[str]:
        """Apply container-valid security hardening via the Docker-aware wp_cli
        bridge. Filesystem hardening (chmod/.htaccess) does NOT apply to the
        named-volume Docker model and is intentionally skipped. FORCE_SSL_ADMIN
        is also skipped (these sites are http://localhost:PORT with no TLS).
        """
        actions = []
        if cls.wp_cli(path, ['config', 'set', 'DISALLOW_FILE_EDIT', 'true', '--raw']).get('success'):
            actions.append('Disabled in-admin file editing')
        if cls.wp_cli(path, ['config', 'set', 'XMLRPC_REQUEST', 'false', '--raw']).get('success'):
            actions.append('Disabled XML-RPC')
        if cls.wp_cli(path, ['config', 'shuffle-salts']).get('success'):
            actions.append('Regenerated security keys')
        return actions

    @classmethod
    def harden_wordpress(cls, path: str) -> Dict:
        """Apply security hardening to WordPress."""
        results = []

        try:
            # Disable file editing in admin
            cls.wp_cli(path, ['config', 'set', 'DISALLOW_FILE_EDIT', 'true', '--raw'])
            results.append('Disabled file editing')

            # Force SSL for admin
            cls.wp_cli(path, ['config', 'set', 'FORCE_SSL_ADMIN', 'true', '--raw'])
            results.append('Enabled SSL for admin')

            # Disable XML-RPC (common attack vector)
            cls.wp_cli(path, ['config', 'set', 'XMLRPC_REQUEST', 'false', '--raw'])
            results.append('Disabled XML-RPC')

            # Set secure file permissions
            cls._set_permissions(path)
            results.append('Set secure file permissions')

            # Create .htaccess security rules
            cls._create_htaccess_security(path)
            results.append('Added .htaccess security rules')

            # Regenerate security keys
            cls.wp_cli(path, ['config', 'shuffle-salts'])
            results.append('Regenerated security keys')

            return {'success': True, 'message': 'Security hardening applied', 'actions': results}

        except Exception as e:
            return {'success': False, 'error': str(e), 'partial_actions': results}

    @classmethod
    def _set_permissions(cls, path: str):
        """Set secure file permissions for WordPress."""
        try:
            # Set ownership
            run_privileged(['chown', '-R', 'www-data:www-data', path])

            # Set directory permissions
            run_privileged(
                ['find', path, '-type', 'd', '-exec', 'chmod', '755', '{}', ';']
            )

            # Set file permissions
            run_privileged(
                ['find', path, '-type', 'f', '-exec', 'chmod', '644', '{}', ';']
            )

            # Protect wp-config.php
            wp_config = os.path.join(path, 'wp-config.php')
            if os.path.exists(wp_config):
                run_privileged(['chmod', '600', wp_config])

        except Exception:
            pass

    @classmethod
    def _create_htaccess_security(cls, path: str):
        """Create security rules in .htaccess."""
        htaccess_path = os.path.join(path, '.htaccess')

        security_rules = '''
# ServerKit Security Rules
# Protect wp-config.php
<files wp-config.php>
order allow,deny
deny from all
</files>

# Protect .htaccess
<files .htaccess>
order allow,deny
deny from all
</files>

# Disable directory browsing
Options -Indexes

# Block access to sensitive files
<FilesMatch "^(wp-config\\.php|\\.htaccess|readme\\.html|license\\.txt)$">
Order allow,deny
Deny from all
</FilesMatch>

# Block PHP execution in uploads
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteRule ^wp-content/uploads/.*\\.php$ - [F]
</IfModule>
'''

        try:
            # Read existing htaccess
            existing = ''
            if os.path.exists(htaccess_path):
                with open(htaccess_path, 'r') as f:
                    existing = f.read()

            # Only add if not already present
            if '# ServerKit Security Rules' not in existing:
                new_content = security_rules + '\n' + existing
                run_privileged(
                    ['tee', htaccess_path],
                    input=new_content
                )
        except Exception:
            pass

    @classmethod
    def search_replace(cls, path: str, search: str, replace: str, dry_run: bool = False) -> Dict:
        """Search and replace in WordPress database."""
        cmd = ['search-replace', search, replace, '--all-tables']

        if dry_run:
            cmd.append('--dry-run')

        result = cls.wp_cli(path, cmd)
        return result

    @classmethod
    def optimize_database(cls, path: str) -> Dict:
        """Optimize WordPress database."""
        result = cls.wp_cli(path, ['db', 'optimize'])
        return result

    PAGE_CACHE_PLUGIN = 'cache-enabler'

    @classmethod
    def get_page_cache_status(cls, path: str) -> Dict:
        """Report whether the full-page cache plugin is installed/active."""
        res = cls.wp_cli(path, ['plugin', 'get', cls.PAGE_CACHE_PLUGIN, '--field=status'])
        status = (res.get('output') or '').strip() if res.get('success') else ''
        return {
            'success': True,
            'plugin': cls.PAGE_CACHE_PLUGIN,
            'installed': res.get('success', False),
            'active': status == 'active',
            'status': status,
        }

    @classmethod
    def enable_page_cache(cls, path: str) -> Dict:
        """Install + activate a full-page disk cache plugin with WP-aware skip rules."""
        inst = cls.install_plugin(path, cls.PAGE_CACHE_PLUGIN, activate=True)
        if not inst.get('success'):
            return {'success': False, 'error': 'Failed to install page-cache plugin: ' + (inst.get('error') or '')}
        opts = {
            'cache_expires': 1,
            'clear_on_upgrade': 1,
            'excl_regexp': '/(wp-admin|wp-login|cart|checkout|my-account)/',
            'excl_cookies': 'comment_author|wordpress_logged_in|wp-postpass|woocommerce_cart_hash|woocommerce_items_in_cart',
        }
        cls.wp_cli(path, ['option', 'update', cls.PAGE_CACHE_PLUGIN, json.dumps(opts), '--format=json'])
        cls.wp_cli(path, ['rewrite', 'flush'])
        return {'success': True, 'message': 'Page cache enabled', 'plugin': cls.PAGE_CACHE_PLUGIN}

    @classmethod
    def disable_page_cache(cls, path: str) -> Dict:
        """Purge then deactivate the page-cache plugin."""
        cls.purge_page_cache(path)
        res = cls.deactivate_plugin(path, cls.PAGE_CACHE_PLUGIN)
        if res.get('success'):
            return {'success': True, 'message': 'Page cache disabled'}
        return {'success': False, 'error': res.get('error') or 'Failed to disable page cache'}

    @classmethod
    def purge_page_cache(cls, path: str) -> bool:
        """Best-effort full-page cache purge. Never raises."""
        try:
            res = cls.wp_cli(path, ['cache-enabler', 'clear'])
            if res.get('success'):
                return True
            res = cls.wp_cli(path, ['eval', 'if (function_exists("cache_enabler_clear_complete_cache")) cache_enabler_clear_complete_cache();'])
            return bool(res.get('success'))
        except Exception:
            return False

    @classmethod
    def _ensure_redis_in_stack(cls, path: str) -> Dict:
        """Ensure the site's compose stack has a redis service, recreating the
        stack (additive compose up -d, no downtime) if one had to be injected.
        Idempotent — short-circuits when redis already present.
        """
        import yaml
        compose_file = os.path.join(path, 'docker-compose.yml')
        if not os.path.exists(compose_file):
            return {'success': False, 'error': 'Not a Docker-stack site (no docker-compose.yml)'}
        try:
            with open(compose_file, 'r') as f:
                compose = yaml.safe_load(f) or {}
            services = compose.setdefault('services', {})
            if 'redis' in services:
                return {'success': True, 'created': False}
            app_name = os.path.basename(path)
            from app.models import Application
            app = Application.query.filter_by(root_path=path).first()
            if app:
                app_name = app.name
            services['redis'] = {
                'image': 'redis:7-alpine',
                'container_name': f'{app_name}-redis',
                'restart': 'unless-stopped',
            }
            wp = services.get('wordpress')
            if isinstance(wp, dict):
                deps = wp.get('depends_on') or []
                if isinstance(deps, list) and 'redis' not in deps:
                    deps.append('redis')
                    wp['depends_on'] = deps
            with open(compose_file, 'w') as f:
                yaml.dump(compose, f, default_flow_style=False, sort_keys=False)
            from app.services.docker_service import DockerService
            up = DockerService.compose_up(path, detach=True)
            if not up.get('success'):
                return {'success': False, 'error': 'Failed to recreate stack with redis: ' + (up.get('error') or '')}
            cls._wait_for_wp_ready(path)
            return {'success': True, 'created': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def enable_object_cache(cls, path: str) -> Dict:
        """Enable a Redis object cache: ensure a redis container, install+activate
        the redis-cache plugin, point WP at redis, and turn the drop-in on.
        """
        ensure = cls._ensure_redis_in_stack(path)
        if not ensure.get('success'):
            return ensure
        actions = []
        if ensure.get('created'):
            actions.append('Added redis container to stack')
        inst = cls.wp_cli(path, ['plugin', 'install', 'redis-cache', '--activate'])
        if not inst.get('success'):
            return {'success': False, 'error': 'Failed to install redis-cache plugin: ' + (inst.get('error') or '')}
        actions.append('Installed redis-cache plugin')
        cls.wp_cli(path, ['config', 'set', 'WP_REDIS_HOST', 'redis'])
        cls.wp_cli(path, ['config', 'set', 'WP_REDIS_PORT', '6379', '--raw'])
        enable = cls.wp_cli(path, ['redis', 'enable'])
        if not enable.get('success'):
            return {'success': False, 'error': 'Plugin installed but enabling the drop-in failed: ' + (enable.get('error') or ''), 'actions': actions}
        actions.append('Enabled Redis object cache drop-in')
        return {'success': True, 'message': 'Redis object cache enabled', 'actions': actions, 'status': cls.object_cache_status(path)}

    @classmethod
    def disable_object_cache(cls, path: str) -> Dict:
        """Turn the Redis object-cache drop-in off (keeps the container + plugin)."""
        res = cls.wp_cli(path, ['redis', 'disable'])
        if res.get('success'):
            return {'success': True, 'message': 'Redis object cache disabled'}
        return {'success': False, 'error': res.get('error') or 'Failed to disable object cache'}

    @classmethod
    def object_cache_status(cls, path: str) -> Dict:
        """Report object-cache state via `wp redis status`. Never raises."""
        compose_file = os.path.join(path, 'docker-compose.yml')
        if not os.path.exists(compose_file):
            return {'enabled': False, 'available': False, 'reason': 'not a Docker-stack site'}
        res = cls.wp_cli(path, ['redis', 'status'])
        if not res.get('success'):
            return {'enabled': False, 'available': False}
        out = (res.get('output') or '').lower()
        return {'enabled': 'connected' in out, 'available': True, 'raw': res.get('output', '').strip()}

    @classmethod
    def flush_cache(cls, path: str) -> Dict:
        """Flush WordPress cache."""
        results = []

        # Flush rewrite rules
        cls.wp_cli(path, ['rewrite', 'flush'])
        results.append('Flushed rewrite rules')

        # Flush transients
        cls.wp_cli(path, ['transient', 'delete', '--all'])
        results.append('Deleted transients')

        # Flush object cache if available
        cache_result = cls.wp_cli(path, ['cache', 'flush'])
        if cache_result['success']:
            results.append('Flushed object cache')

        # Flush the Redis object-cache drop-in if the plugin is active (Roadmap #23)
        redis_flush = cls.wp_cli(path, ['redis', 'flush'])
        if redis_flush.get('success'):
            results.append('Flushed Redis object cache')

        # Purge the full-page cache plugin if present (Roadmap #22)
        if cls.purge_page_cache(path):
            results.append('Purged page cache')

        return {'success': True, 'message': 'Cache flushed', 'actions': results}

    @classmethod
    def create_user(cls, path: str, username: str, email: str, role: str = 'subscriber', password: str = None) -> Dict:
        """Create a new WordPress user."""
        if not password:
            password = cls._generate_password()

        result = cls.wp_cli(path, [
            'user', 'create', username, email,
            f'--role={role}',
            f'--user_pass={password}'
        ])

        if result['success']:
            return {
                'success': True,
                'message': f'User {username} created',
                'password': password
            }
        return result

    @classmethod
    def reset_password(cls, path: str, user: str, password: str = None) -> Dict:
        """Reset a user's password."""
        if not password:
            password = cls._generate_password()

        result = cls.wp_cli(path, ['user', 'update', user, f'--user_pass={password}'])

        if result['success']:
            return {'success': True, 'message': 'Password reset', 'password': password}
        return result

    @classmethod
    def _get_login_url_slug(cls, path: str) -> str:
        """Return the site's real login URL (avoids hardcoding /wp-admin)."""
        res = cls.wp_cli(path, ['eval', 'echo wp_login_url();'])
        if res.get('success') and res.get('output', '').strip():
            return res['output'].strip()
        return ''

    @classmethod
    def _ensure_login_package(cls, path: str) -> Dict:
        """Make the wp-cli-login command + its launcher available, idempotently."""
        have = cls.wp_cli(path, ['login', '--help'])
        if not have.get('success'):
            inst = cls.wp_cli(path, ['package', 'install', 'aaemnnosttv/wp-cli-login-command'])
            if not inst.get('success'):
                return {'success': False, 'error': 'Failed to install wp-cli-login package: ' + (inst.get('error') or '')}
        # Ensure the companion launcher mu-plugin is present (idempotent).
        cls.wp_cli(path, ['login', 'install', '--yes'])
        return {'success': True}

    @classmethod
    def create_login_url(cls, path: str, user: str) -> Dict:
        """Mint a one-time passwordless wp-admin login URL for ``user``."""
        pkg = cls._ensure_login_package(path)
        if not pkg.get('success'):
            return pkg
        res = cls.wp_cli(path, ['login', 'create', user, '--url-only'])
        if res.get('success'):
            url = (res.get('output') or '').strip()
            if not url:
                return {'success': False, 'error': 'Login URL was empty'}
            return {'success': True, 'url': url, 'login_slug': cls._get_login_url_slug(path)}
        return res

    @staticmethod
    def _generate_password(length: int = 16) -> str:
        """Generate a secure random password."""
        alphabet = string.ascii_letters + string.digits + '!@#$%^&*'
        return ''.join(secrets.choice(alphabet) for _ in range(length))

    @staticmethod
    def _read_env_value(root_path: str, key: str) -> Optional[str]:
        """Read a single KEY from a Docker stack's <root>/.env (None if absent)."""
        env_path = os.path.join(root_path, '.env')
        if not os.path.exists(env_path):
            return None
        try:
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith(f'{key}='):
                        return line.split('=', 1)[1]
        except Exception:
            pass
        return None

    @classmethod
    def _copy_wp_content_between_containers(cls, source_container: str, target_container: str) -> Dict:
        """Best-effort copy of /var/www/html/wp-content from source to target
        WordPress container using `docker cp` via a host tmp dir. Never raises.
        """
        import tempfile
        try:
            tmp = tempfile.mkdtemp(prefix='wpclone_')
            staged = os.path.join(tmp, 'wp-content')
            cp_out = subprocess.run(
                ['docker', 'cp', f'{source_container}:/var/www/html/wp-content', staged],
                capture_output=True, text=True, timeout=600,
            )
            if cp_out.returncode != 0:
                shutil.rmtree(tmp, ignore_errors=True)
                return {'success': False, 'error': cp_out.stderr}
            cp_in = subprocess.run(
                ['docker', 'cp', f'{staged}/.', f'{target_container}:/var/www/html/wp-content'],
                capture_output=True, text=True, timeout=600,
            )
            shutil.rmtree(tmp, ignore_errors=True)
            if cp_in.returncode != 0:
                return {'success': False, 'error': cp_in.stderr}
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ========================================
    # WORDPRESS STANDALONE (DOCKER) MANAGEMENT
    # ========================================

    WP_APP_NAME = 'serverkit-wordpress'
    WP_CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    WP_CONFIG_FILE = os.path.join(WP_CONFIG_DIR, 'wordpress.json')

    @classmethod
    def get_wordpress_standalone_status(cls) -> Dict:
        """Check if standalone WordPress is installed and running."""
        from app.models import Application

        app = Application.query.filter_by(name=cls.WP_APP_NAME).first()

        if not app:
            return {
                'installed': False,
                'running': False,
                'http_port': None,
                'url': None,
                'url_path': None
            }

        running = cls._is_wordpress_running()
        config = cls._load_wp_config()

        return {
            'installed': True,
            'running': running,
            'http_port': app.port or config.get('http_port'),
            'url_path': '/wordpress',
            'url': f"http://localhost:{app.port}" if app.port else None,
            'app_id': app.id,
            'version': config.get('version', '6.4')
        }

    @classmethod
    def _is_wordpress_running(cls) -> bool:
        """Check if WordPress container is running."""
        try:
            result = subprocess.run(
                ['docker', 'ps', '--filter', f'name={cls.WP_APP_NAME}', '--format', '{{.Names}}'],
                capture_output=True,
                text=True,
                timeout=10
            )
            return cls.WP_APP_NAME in result.stdout
        except Exception:
            return False

    @classmethod
    def _load_wp_config(cls) -> Dict:
        """Load WordPress standalone configuration."""
        if os.path.exists(cls.WP_CONFIG_FILE):
            try:
                with open(cls.WP_CONFIG_FILE, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    @classmethod
    def _save_wp_config(cls, config: Dict) -> bool:
        """Save WordPress standalone configuration."""
        try:
            os.makedirs(cls.WP_CONFIG_DIR, exist_ok=True)
            with open(cls.WP_CONFIG_FILE, 'w') as f:
                json.dump(config, f, indent=2)
            return True
        except Exception:
            return False

    @classmethod
    def get_wordpress_resource_requirements(cls) -> Dict:
        """Get resource requirements for WordPress installation."""
        return {
            'memory_min': '512MB',
            'memory_recommended': '1GB',
            'storage_min': '2GB',
            'storage_recommended': '10GB',
            'components': [
                {'name': 'WordPress', 'memory': '~256MB', 'storage': '~500MB'},
                {'name': 'MySQL 8.0', 'memory': '~256MB', 'storage': '~1GB'}
            ],
            'warning': 'Installation will spin up a MySQL database container'
        }

    @classmethod
    def install_wordpress_standalone(cls, admin_email: str = None) -> Dict:
        """Install WordPress as integrated ServerKit service via Docker."""
        from app.services.template_service import TemplateService
        from app.services.nginx_service import NginxService

        status = cls.get_wordpress_standalone_status()
        if status['installed']:
            return {'success': False, 'error': 'WordPress is already installed'}

        try:
            result = TemplateService.install_template(
                template_id='wordpress',
                app_name=cls.WP_APP_NAME,
                user_variables={},
                user_id=1
            )

            if not result.get('success'):
                return result

            variables = result.get('variables', {})
            http_port = variables.get('HTTP_PORT')

            # Create nginx config for /wordpress path
            nginx_result = NginxService.create_wordpress_config(int(http_port))
            if not nginx_result.get('success'):
                print(f"Warning: Failed to create WordPress nginx config: {nginx_result.get('error')}")

            config = {
                'admin_email': admin_email,
                'http_port': http_port,
                'db_password': variables.get('DB_PASSWORD'),
                'wp_db_password': variables.get('WP_DB_PASSWORD'),
                'installed_at': datetime.now().isoformat(),
                'version': '6.4',
                'url_path': '/wordpress'
            }
            cls._save_wp_config(config)

            return {
                'success': True,
                'message': 'WordPress installed successfully',
                'http_port': http_port,
                'url_path': '/wordpress'
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def uninstall_wordpress_standalone(cls, remove_data: bool = False) -> Dict:
        """Uninstall standalone WordPress."""
        from app import db
        from app.models import Application
        from app.services.docker_service import DockerService
        from app.services.nginx_service import NginxService

        app = Application.query.filter_by(name=cls.WP_APP_NAME).first()
        if not app:
            return {'success': False, 'error': 'WordPress is not installed'}

        try:
            NginxService.remove_wordpress_config()

            if app.root_path and os.path.exists(app.root_path):
                DockerService.compose_down(app.root_path, remove_volumes=remove_data)

                if remove_data:
                    shutil.rmtree(app.root_path, ignore_errors=True)

            db.session.delete(app)
            db.session.commit()

            if os.path.exists(cls.WP_CONFIG_FILE):
                os.remove(cls.WP_CONFIG_FILE)

            return {
                'success': True,
                'message': 'WordPress uninstalled successfully',
                'data_removed': remove_data
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def start_wordpress_standalone(cls) -> Dict:
        """Start WordPress containers."""
        from app import db
        from app.models import Application
        from app.services.docker_service import DockerService

        app = Application.query.filter_by(name=cls.WP_APP_NAME).first()
        if not app:
            return {'success': False, 'error': 'WordPress is not installed'}

        if not app.root_path or not os.path.exists(app.root_path):
            return {'success': False, 'error': 'WordPress installation path not found'}

        try:
            result = DockerService.compose_up(app.root_path, detach=True)
            if result.get('success'):
                app.status = 'running'
                db.session.commit()
                return {'success': True, 'message': 'WordPress started'}
            return result
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def stop_wordpress_standalone(cls) -> Dict:
        """Stop WordPress containers."""
        from app import db
        from app.models import Application
        from app.services.docker_service import DockerService

        app = Application.query.filter_by(name=cls.WP_APP_NAME).first()
        if not app:
            return {'success': False, 'error': 'WordPress is not installed'}

        if not app.root_path or not os.path.exists(app.root_path):
            return {'success': False, 'error': 'WordPress installation path not found'}

        try:
            result = DockerService.compose_stop(app.root_path)
            if result.get('success'):
                app.status = 'stopped'
                db.session.commit()
                return {'success': True, 'message': 'WordPress stopped'}
            return result
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restart_wordpress_standalone(cls) -> Dict:
        """Restart WordPress containers."""
        stop_result = cls.stop_wordpress_standalone()
        if not stop_result.get('success'):
            return stop_result
        return cls.start_wordpress_standalone()

    # ========================================
    # WORDPRESS SITES HUB (MULTI-SITE MANAGEMENT)
    # ========================================

    @classmethod
    def _enrich_site_data(cls, site, site_data: Dict) -> Dict:
        """Add runtime info (status, name, port, url) to site data dict."""
        if site.application:
            site_data['name'] = site.application.name
            site_data['port'] = site.application.port
            running = cls._check_container_running(site.application.name)
            if running and site.application.status != 'running':
                site.application.status = 'running'
            elif not running and site.application.status == 'running':
                site.application.status = 'stopped'
            site_data['status'] = site.application.status

            # Build access URL: prefer the primary domain, fall back to localhost:port
            domains = site.application.domains
            primary = next((d for d in domains if d.is_primary), None)
            if primary is None and domains:
                primary = domains[0]
            if primary is not None:
                scheme = 'https' if primary.ssl_enabled else 'http'
                site_data['url'] = f"{scheme}://{primary.name}"
            elif site.application.port:
                site_data['url'] = f"http://localhost:{site.application.port}"
        return site_data

    @classmethod
    def get_sites(cls) -> Dict:
        """Get all production WordPress sites with environment counts."""
        from app.models import WordPressSite

        sites = WordPressSite.query.filter_by(is_production=True).all()
        result = []

        for site in sites:
            site_data = site.to_dict()
            env_count = WordPressSite.query.filter_by(production_site_id=site.id).count()
            site_data['environment_count'] = env_count
            cls._enrich_site_data(site, site_data)
            result.append(site_data)

        return {'sites': result}

    @classmethod
    def get_site(cls, site_id: int) -> Dict:
        """Get a single WordPress site with its environments."""
        from app.models import WordPressSite

        site = WordPressSite.query.get(site_id)
        if not site:
            return {'error': 'Site not found'}

        site_data = site.to_dict(include_environments=True)
        cls._enrich_site_data(site, site_data)

        # Refresh the multisite flag from reality (single-site detail only;
        # never added to the hot list endpoint get_sites). One cheap wp_cli probe.
        if site.application and site.application.root_path:
            detected = cls.is_multisite(site.application.root_path)
            if detected != site.multisite:
                site.multisite = detected
                from app import db
                db.session.commit()
            site_data['multisite'] = detected

        # Also enrich environment data
        if 'environments' in site_data:
            for env_data in site_data['environments']:
                env = WordPressSite.query.get(env_data.get('id'))
                if env:
                    cls._enrich_site_data(env, env_data)

        return {'site': site_data}

    @classmethod
    def import_site(cls, name: str, admin_email: str, user_id: int, sql_path: str,
                    old_url: str, wp_content_zip_path: str = None) -> Dict:
        """Import an existing WordPress site from a SQL dump into a fresh Docker stack.

        Stands up a normal blank stack via create_site (reusing the full Docker
        provisioning + Application/WordPressSite rows), then OVERWRITES its DB
        with the uploaded dump and rewrites the site URL to the new localhost
        port. ``sql_path`` is a host-side temp file owned by the caller.
        """
        from app import db
        from app.models import WordPressSite
        from app.services.db_sync_service import DatabaseSyncService

        # 1) Stand up a fresh stack (reuses all Docker provisioning + rows).
        result = cls.create_site(name, admin_email, user_id)
        if not result.get('success'):
            return result
        http_port = result.get('http_port')
        wp_site = WordPressSite.query.get(result['site']['id'])
        root_path = wp_site.application.root_path
        compose_file = os.path.join(root_path, 'docker-compose.yml')

        try:
            # 2) Overwrite the fresh DB with the user's dump. Root user, since a
            #    real dump issues DROP/CREATE on the wordpress DB.
            db_password = cls._read_env_value(root_path, 'DB_PASSWORD')
            imp = DatabaseSyncService.import_to_container(
                compose_path=compose_file,
                snapshot_path=sql_path,
                db_name='wordpress',
                db_user='root',
                db_password=db_password,
            )
            if not imp.get('success'):
                return {'success': False,
                        'error': 'Database import failed: ' + (imp.get('error') or ''),
                        'site': wp_site.to_dict(), 'http_port': http_port}

            # 3) Rewrite the site URL to this server's localhost address.
            new_url = f'http://localhost:{http_port}' if http_port else 'http://localhost'
            cls.wp_cli(root_path, ['option', 'update', 'home', new_url])
            cls.wp_cli(root_path, ['option', 'update', 'siteurl', new_url])
            sr = cls.search_replace(root_path, old_url, new_url, dry_run=False)
            cls.wp_cli(root_path, ['cache', 'flush'])
            cls.wp_cli(root_path, ['rewrite', 'flush'])

            # 4) The imported DB carries the source's users, so the create-time
            #    admin no longer matches; clear it and re-detect multisite.
            wp_site.admin_user = None
            wp_site.multisite = cls.is_multisite(root_path)
            db.session.commit()

            out = {
                'success': True,
                'message': 'WordPress site imported successfully',
                'site': wp_site.to_dict(),
                'http_port': http_port,
                'old_url': old_url,
                'new_url': new_url,
            }
            if not sr.get('success'):
                out['warning'] = 'Search-replace reported an issue; verify links inside wp-admin.'
            if wp_content_zip_path:
                out['warning'] = 'wp-content import is not yet supported; only the database was imported.'
            return out
        except Exception as e:
            return {'success': False, 'error': str(e),
                    'site': wp_site.to_dict(), 'http_port': http_port}

    # WordPress core line baked into every managed stack's image tag. Kept in sync
    # with the template default (backend/templates/wordpress.yaml) and wp_version below.
    WP_CORE = '6.4'

    @classmethod
    def create_site(cls, name: str, admin_email: str, user_id: int, admin_user: str = 'admin',
                    php_version: str = None, enable_page_cache: bool = False,
                    enable_object_cache: bool = False) -> Dict:
        """Create a new WordPress site via Docker.

        One-click orchestration: provision the Docker stack on a chosen PHP version,
        finalize + harden the install, then optionally enable the full-page and/or
        Redis object cache — all in a single call. Cache enablement is best-effort
        and never fails the create. The generated admin password is returned ONCE.
        """
        from app import db
        from app.models import Application, WordPressSite
        from app.services.template_service import TemplateService

        # Sanitize name for Docker
        safe_name = name.lower().replace(' ', '-')
        safe_name = ''.join(c for c in safe_name if c.isalnum() or c == '-')

        # Check for duplicate name
        existing = Application.query.filter_by(name=safe_name).first()
        if existing:
            return {'success': False, 'error': f'A site with name "{safe_name}" already exists'}

        # Bake the chosen PHP version into the initial image tag so the site is
        # created on the right PHP from the start (no post-create container recreate).
        # Invalid/empty values fall through to the template default (WP_CORE-apache).
        user_variables = {}
        if php_version and php_version in cls.get_available_php_versions():
            user_variables['VERSION'] = f'{cls.WP_CORE}-php{php_version}-apache'

        try:
            result = TemplateService.install_template(
                template_id='wordpress',
                app_name=safe_name,
                user_variables=user_variables,
                user_id=user_id
            )

            if not result.get('success'):
                return result

            variables = result.get('variables', {})
            http_port = variables.get('HTTP_PORT')

            # Find the Application record created by TemplateService
            app = Application.query.filter_by(name=safe_name).first()
            if not app:
                return {'success': False, 'error': 'Application record not created'}

            # Finalize the WordPress install inside the container: the official
            # wordpress image only generates wp-config from env vars; it does NOT
            # run the install, so no admin user exists. Do it via the Docker-aware
            # wp_cli bridge (host-filesystem hardening does not apply to volumes).
            admin_password = cls._generate_password()
            site_url = f'http://localhost:{http_port}' if http_port else 'http://localhost'
            wp_warning = None
            harden_actions = []
            cache_actions = []
            cache_warnings = []
            page_cache_on = False
            if cls._wait_for_wp_ready(app.root_path):
                install_res = cls.wp_cli(app.root_path, [
                    'core', 'install',
                    f'--url={site_url}',
                    f'--title={name}',
                    f'--admin_user={admin_user}',
                    f'--admin_password={admin_password}',
                    f'--admin_email={admin_email}',
                    '--skip-email',
                ])
                if install_res.get('success'):
                    harden_actions = cls._harden_docker_site(app.root_path)
                    # Optional caches (best-effort; never fail the create). These are
                    # wp_cli calls inside the now-running container, so they must run
                    # AFTER the core install has finalized.
                    if enable_object_cache:
                        oc = cls.enable_object_cache(app.root_path)
                        # Record whatever work succeeded — the helper returns its partial
                        # 'actions' even on failure (e.g. redis added + plugin installed
                        # but the drop-in enable failed) — then note any failure non-fatally.
                        cache_actions.extend(oc.get('actions') or [])
                        if not oc.get('success'):
                            cache_warnings.append('object cache: ' + (oc.get('error') or 'unknown error'))
                    if enable_page_cache:
                        pc = cls.enable_page_cache(app.root_path)
                        if pc.get('success'):
                            cache_actions.append('Enabled full-page cache')
                            page_cache_on = True
                        else:
                            cache_warnings.append('page cache: ' + (pc.get('error') or 'unknown error'))
                else:
                    admin_password = None
                    wp_warning = (
                        'WordPress container did not accept the automated install; '
                        'complete setup via the WordPress wizard. '
                        + (install_res.get('error') or '')
                    ).strip()
            else:
                admin_password = None
                wp_warning = (
                    'WordPress container was not ready in time; the install was not '
                    'finalized. Complete setup via the WordPress wizard.'
                )

            # Detect multisite from the freshly installed site (cheap one-shot;
            # only meaningful if the automated install finalized).
            multisite = cls.is_multisite(app.root_path) if admin_password else False

            # Surface any best-effort cache failures without failing the create.
            if cache_warnings:
                note = 'Site created, but some caches could not be enabled — ' + '; '.join(cache_warnings) + '.'
                wp_warning = (wp_warning + ' ' + note) if wp_warning else note

            # Create WordPressSite record. Persist the page-cache flag in sync_config
            # to mirror the per-site page-cache route (object cache + PHP are read live).
            wp_site = WordPressSite(
                application_id=app.id,
                admin_user=admin_user if admin_password else None,
                admin_email=admin_email,
                is_production=True,
                environment_type='production',
                wp_version=cls.WP_CORE,
                compose_project_name=safe_name,
                multisite=multisite,
                sync_config=json.dumps({'page_cache_enabled': True}) if page_cache_on else None,
            )
            db.session.add(wp_site)
            db.session.commit()

            result = {
                'success': True,
                'message': 'WordPress site created successfully',
                'site': wp_site.to_dict(),
                'http_port': http_port,
                'admin_user': admin_user if admin_password else None,
                'admin_password': admin_password,
                'hardening': harden_actions,
                'cache': cache_actions,
            }
            if wp_warning:
                result['warning'] = wp_warning
            return result

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def clone_site(cls, source_site_id: int, new_name: str, user_id: int) -> Dict:
        """Clone an existing Docker WordPress site into a NEW independent top-level
        site (is_production=True, no production_site_id) with FRESH admin creds.

        (1) stand up a brand-new stack via create_site; (2) container-to-container
        clone the source DB into it with a URL search-replace to the new localhost
        URL; (3) best-effort copy wp-content between containers; (4) create a fresh
        admin user (new generated password) so the clone does NOT share the
        source's credentials. Returns the new admin_password ONCE.
        """
        from app import db
        from app.models import WordPressSite
        from app.services.db_sync_service import DatabaseSyncService

        source = WordPressSite.query.get(source_site_id)
        if not source:
            return {'success': False, 'error': 'Source site not found'}
        if not source.application or not source.application.root_path:
            return {'success': False, 'error': 'Source site has no application/root path'}
        source_root = source.application.root_path
        source_compose = os.path.join(source_root, 'docker-compose.yml')
        if not os.path.exists(source_compose):
            return {'success': False, 'error': 'Source is not a Docker-stack site (no docker-compose.yml)'}

        # 1) Stand up a NEW independent stack (fresh install + an admin we will replace).
        admin_email = source.admin_email or ''
        create_res = cls.create_site(new_name, admin_email, user_id)
        if not create_res.get('success'):
            return create_res
        new_site = WordPressSite.query.get(create_res['site']['id'])
        new_root = new_site.application.root_path
        new_compose = os.path.join(new_root, 'docker-compose.yml')
        http_port = create_res.get('http_port')
        new_url = f'http://localhost:{http_port}' if http_port else 'http://localhost'

        try:
            src_port = source.application.port
            source_url = f'http://localhost:{src_port}' if src_port else None

            # 2) Clone the source DB into the new stack (root user for a clean overwrite;
            #    both stacks use db name 'wordpress'; root pw lives in each .env DB_PASSWORD).
            src_pw = cls._read_env_value(source_root, 'DB_PASSWORD')
            new_pw = cls._read_env_value(new_root, 'DB_PASSWORD')
            clone_options = {
                'truncate_tables': ['actionscheduler_actions', 'actionscheduler_logs'],
            }
            if source_url and new_url and source_url != new_url:
                clone_options['search_replace'] = {
                    source_url: new_url,
                    f'localhost:{src_port}': f'localhost:{http_port}',
                }
            clone_res = DatabaseSyncService.clone_between_containers(
                source_compose_path=source_compose,
                target_compose_path=new_compose,
                source_db='wordpress', target_db='wordpress',
                source_user='root', target_user='root',
                source_password=src_pw, target_password=new_pw,
                options=clone_options,
            )
            if not clone_res.get('success'):
                return {'success': False, 'error': f"Database clone failed: {clone_res.get('error')}"}

            # 3) Best-effort copy wp-content from source container to the new one.
            cls._copy_wp_content_between_containers(source.application.name, new_site.application.name)

            # 4) Fresh admin: the DB import replaced users with the SOURCE users, so
            #    create a brand-new administrator with a generated password.
            new_admin_user = 'admin'
            new_admin_pass = cls._generate_password()
            exists = cls.wp_cli(new_root, ['user', 'get', new_admin_user, '--field=ID'])
            if exists.get('success'):
                new_admin_user = f'admin_{new_site.id}'
            cu = cls.create_user(new_root, new_admin_user, admin_email or f'{new_admin_user}@example.com',
                                 role='administrator', password=new_admin_pass)
            if not cu.get('success'):
                return {'success': False, 'error': f"Failed to create fresh admin: {cu.get('error')}"}

            new_site.admin_user = new_admin_user
            if admin_email:
                new_site.admin_email = admin_email
            db.session.commit()

            return {
                'success': True,
                'message': f'Site cloned from "{source.application.name}" successfully',
                'site': new_site.to_dict(),
                'http_port': http_port,
                'admin_user': new_admin_user,
                'admin_password': new_admin_pass,
            }
        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_site(cls, site_id: int, create_backup: bool = True) -> Dict:
        """Delete a WordPress site and all its environments.

        By default a final files + database backup of the production site is
        captured to ``BACKUP_DIR`` before anything is torn down, so a deleted
        site stays restorable. The backup lives outside the site root, so it
        survives the filesystem teardown. Pass ``create_backup=False`` to skip.
        """
        from app import db
        from app.models import WordPressSite

        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.is_production:
            return {'success': False, 'error': 'Can only delete production sites from this endpoint. Use delete_environment for non-production.'}

        # Capture a final backup BEFORE any destructive action, while the
        # containers are still up (wp db export runs inside the running stack).
        backup_info = None
        if create_backup and site.application and site.application.root_path:
            backup_result = cls.backup_wordpress(site.application.root_path, include_db=True)
            if backup_result.get('success'):
                backup_info = {
                    'backup_name': backup_result.get('backup_name'),
                    'backup_path': backup_result.get('backup_path'),
                    'size': backup_result.get('size'),
                }

        try:
            # Delete all child environments first
            environments = WordPressSite.query.filter_by(production_site_id=site.id).all()
            for env in environments:
                cls._teardown_wp_site(env)

            # Delete the production site
            cls._teardown_wp_site(site)

            db.session.commit()
            return {
                'success': True,
                'message': 'Site and all environments deleted',
                'backup': backup_info,
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def archive_site(cls, site_id: int) -> Dict:
        """Archive a site: stop its stack but keep all data (volumes + files).

        Unlike delete, archiving is fully reversible via ``unarchive_site`` —
        the Docker volumes (database) and files are preserved, and a final
        backup is captured for safety. Applies to the production site and all
        of its child environments.
        """
        from app import db
        from app.models import WordPressSite
        from app.services.docker_service import DockerService

        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.is_production:
            return {'success': False, 'error': 'Only production sites can be archived'}

        # Best-effort safety backup (archiving keeps the data either way).
        backup_info = None
        if site.application and site.application.root_path:
            backup_result = cls.backup_wordpress(site.application.root_path, include_db=True)
            if backup_result.get('success'):
                backup_info = backup_result.get('backup_name')

        try:
            targets = [site] + WordPressSite.query.filter_by(production_site_id=site.id).all()
            for wp in targets:
                if (wp.application and wp.application.root_path
                        and os.path.exists(wp.application.root_path)):
                    # Keep volumes so the database/files survive.
                    DockerService.compose_down(wp.application.root_path, volumes=False)
                if wp.application:
                    wp.application.status = 'archived'

            db.session.commit()
            return {'success': True, 'message': 'Site archived', 'backup': backup_info}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def unarchive_site(cls, site_id: int) -> Dict:
        """Bring an archived site back online by starting its stack again."""
        from app import db
        from app.models import WordPressSite
        from app.services.docker_service import DockerService

        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.is_production:
            return {'success': False, 'error': 'Only production sites can be unarchived'}

        try:
            targets = [site] + WordPressSite.query.filter_by(production_site_id=site.id).all()
            for wp in targets:
                if (wp.application and wp.application.root_path
                        and os.path.exists(wp.application.root_path)):
                    DockerService.compose_up(wp.application.root_path)
                if wp.application:
                    wp.application.status = 'running'

            db.session.commit()
            return {'success': True, 'message': 'Site restored from archive'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_environments(cls, site_id: int) -> Dict:
        """Get all environments for a production WordPress site."""
        from app.models import WordPressSite

        site = WordPressSite.query.get(site_id)
        if not site:
            return {'error': 'Site not found'}

        if not site.is_production:
            return {'error': 'Not a production site'}

        # Production env first
        prod_data = site.to_dict()
        cls._enrich_site_data(site, prod_data)
        environments = [prod_data]

        # Child environments
        children = WordPressSite.query.filter_by(production_site_id=site.id).all()
        for child in children:
            env_data = child.to_dict()
            cls._enrich_site_data(child, env_data)
            environments.append(env_data)

        return {'environments': environments}

    @classmethod
    def create_environment(cls, site_id: int, env_type: str, user_id: int = 1) -> Dict:
        """Create a staging or development environment for a site."""
        from app import db
        from app.models import WordPressSite, Application
        from app.services.template_service import TemplateService

        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.is_production:
            return {'success': False, 'error': 'Can only create environments from a production site'}

        if env_type not in ('staging', 'development'):
            return {'success': False, 'error': 'Environment type must be staging or development'}

        # Check if this environment type already exists
        existing = WordPressSite.query.filter_by(
            production_site_id=site.id,
            environment_type=env_type
        ).first()
        if existing:
            return {'success': False, 'error': f'{env_type.capitalize()} environment already exists'}

        # Build name from parent
        parent_name = site.application.name if site.application else f'wp-site-{site.id}'
        env_name = f'{parent_name}-{env_type[:3]}'  # e.g., mysite-sta, mysite-dev

        try:
            result = TemplateService.install_template(
                template_id='wordpress',
                app_name=env_name,
                user_variables={},
                user_id=user_id
            )

            if not result.get('success'):
                return result

            variables = result.get('variables', {})
            http_port = variables.get('HTTP_PORT')

            app = Application.query.filter_by(name=env_name).first()
            if not app:
                return {'success': False, 'error': 'Application record not created'}

            wp_env = WordPressSite(
                application_id=app.id,
                admin_email=site.admin_email,
                is_production=False,
                production_site_id=site.id,
                environment_type=env_type,
                wp_version=site.wp_version or '6.4',
                compose_project_name=env_name
            )
            db.session.add(wp_env)
            db.session.commit()

            return {
                'success': True,
                'message': f'{env_type.capitalize()} environment created',
                'environment': wp_env.to_dict(),
                'http_port': http_port
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_environment(cls, env_id: int) -> Dict:
        """Delete a non-production environment."""
        from app import db
        from app.models import WordPressSite

        env = WordPressSite.query.get(env_id)
        if not env:
            return {'success': False, 'error': 'Environment not found'}

        if env.is_production:
            return {'success': False, 'error': 'Cannot delete production environment. Delete the site instead.'}

        try:
            cls._teardown_wp_site(env)
            db.session.commit()
            return {'success': True, 'message': 'Environment deleted'}
        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def _teardown_wp_site(cls, wp_site, remove_volumes: bool = True) -> None:
        """Tear down Docker stack and delete records for a WordPressSite."""
        from app import db
        from app.services.docker_service import DockerService

        if wp_site.application and wp_site.application.root_path:
            root_path = wp_site.application.root_path
            if os.path.exists(root_path):
                DockerService.compose_down(root_path, volumes=remove_volumes)
                shutil.rmtree(root_path, ignore_errors=True)

        if wp_site.application:
            db.session.delete(wp_site.application)

        db.session.delete(wp_site)

    @classmethod
    def _check_container_running(cls, app_name: str) -> bool:
        """Check if a Docker container is running by app name."""
        try:
            import subprocess
            result = subprocess.run(
                ['docker', 'ps', '--filter', f'name={app_name}', '--format', '{{.Names}}'],
                capture_output=True,
                text=True,
                timeout=10
            )
            return app_name in result.stdout
        except Exception:
            return False
