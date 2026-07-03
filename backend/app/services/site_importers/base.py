"""Base class for control-panel archive importers.

A format importer knows how to recognise one panel's backup layout, turn it
into a neutral analyse report, and propose the ordered migration steps the
orchestrator (``SiteImportService``) executes. Importers are pure inspectors:
they never touch Docker, MySQL or the filesystem outside ``extracted_dir`` —
all side effects live in the orchestration service so every format shares the
same battle-tested step implementations.

Contract for new formats (DirectAdmin, Hestia, ...):

* subclass ``BaseSiteImporter``, set ``format`` to the source_type slug;
* implement ``detect(extracted_dir) -> bool`` — cheap layout sniff, must not
  raise on foreign layouts;
* implement ``analyze(extracted_dir) -> dict`` returning the REPORT SHAPE
  below — missing pieces become entries in ``warnings``/``unsupported``,
  never exceptions;
* optionally override ``plan(analysis, options)`` if the default step list
  does not fit; step ``key`` values must map to ``_step_<key>`` methods on
  ``SiteImportService``;
* register with ``@register_importer`` (see package ``__init__``).

REPORT SHAPE (all keys present, defaulted):
    {
        'format': '<format slug>',
        'homedir_present': bool,
        'domains': [{'domain', 'docroot', 'type'}],
        'databases': [{'name', 'engine', 'dump_path', 'size'}],
        'db_users': [{'user', 'hash', 'hash_format', 'grants': [...]}],
        'crontab': ['<raw cron lines>'],
        'mail_accounts_count': int,   # informational only — mail not migrated
        'php_version': str | None,
        'warnings': [str],
        'unsupported': [str],
    }
"""


class BaseSiteImporter:
    """Interface every format importer implements."""

    #: source_type slug this importer handles ('cpanel', 'directadmin', ...).
    format = None

    # ── required interface ──
    def detect(self, extracted_dir):
        """Return True if ``extracted_dir`` looks like this panel's backup."""
        raise NotImplementedError

    def analyze(self, extracted_dir):
        """Return the analyse report dict (see module docstring)."""
        raise NotImplementedError

    def plan(self, analysis, options):
        """Return the ordered list of step dicts for ``analysis``.

        Each step: {'key': str, 'title': str}. ``key`` must correspond to a
        ``_step_<key>`` method on SiteImportService. The default plan covers
        the common docroot+MySQL+cron migration; skip steps that have no
        inputs so retries and progress bars stay honest.
        """
        options = options or {}
        steps = [
            {'key': 'create_app', 'title': 'Create the application'},
            {'key': 'copy_files', 'title': 'Copy site files'},
        ]
        if analysis.get('databases'):
            steps.append({'key': 'create_databases',
                          'title': 'Create and import databases'})
        if analysis.get('db_users'):
            steps.append({'key': 'create_db_users',
                          'title': 'Recreate database users'})
        if analysis.get('crontab'):
            steps.append({'key': 'install_crontab',
                          'title': 'Install cron jobs'})
        steps.append({'key': 'fix_permissions', 'title': 'Fix permissions'})
        steps.append({'key': 'validate', 'title': 'Validate the migration'})
        return steps

    # ── shared helpers ──
    @staticmethod
    def _empty_report(fmt):
        return {
            'format': fmt,
            'homedir_present': False,
            'domains': [],
            'databases': [],
            'db_users': [],
            'crontab': [],
            'mail_accounts_count': 0,
            'php_version': None,
            'warnings': [],
            'unsupported': [],
        }

    @staticmethod
    def _read_text(path, warnings=None, label=None):
        """Best-effort text read; returns '' and records a warning on failure."""
        try:
            with open(path, 'r', encoding='utf-8', errors='replace') as fh:
                return fh.read()
        except OSError as exc:
            if warnings is not None:
                warnings.append(f'Could not read {label or path}: {exc}')
            return ''
