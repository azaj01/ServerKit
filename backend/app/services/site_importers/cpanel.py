"""cPanel/WHM full-backup importer.

Understands the ``backup-M.D.YYYY_HH-MM-SS_user.tar.gz`` layout produced by
cPanel's "Full Account Backup":

    backup-.../ (single top-level dir)
      homedir/ or homedir.tar     — the account home (docroots live here)
      mysql/<db>.sql              — one dump per database
      mysql.sql                   — CREATE USER / GRANT statements
      cp/<user>                   — account metadata (main domain, plan)
      userdata/<domain>           — per-domain config (documentroot, php)
      userdata/main               — index of main/addon/sub domains
      cron/<user>                 — the account crontab
      dnszones/<zone>.db          — BIND zone files (not migrated)
      va/                         — vacation autoresponders (not migrated)

Everything is parsed defensively: a missing or malformed piece becomes a
``warnings`` entry, never an exception — partial backups still analyse.
"""
import os
import re

from .base import BaseSiteImporter

# Old-style mysql_native_password hash: '*' + 40 hex chars.
_NATIVE_HASH_RE = re.compile(r'^\*[0-9A-Fa-f]{40}$')

# GRANT ... TO 'user'@'host' [IDENTIFIED BY PASSWORD '*hash']
_GRANT_RE = re.compile(
    r"GRANT\s+(?P<privs>.+?)\s+ON\s+(?P<scope>\S+)\s+TO\s+"
    r"['`\"](?P<user>[^'`\"]+)['`\"]@['`\"](?P<host>[^'`\"]+)['`\"]"
    r"(?:\s+IDENTIFIED\s+BY\s+PASSWORD\s+'(?P<hash>[^']*)')?",
    re.IGNORECASE)

# CREATE USER 'user'@'host' IDENTIFIED WITH mysql_native_password AS '*hash'
# (also matches the legacy IDENTIFIED BY PASSWORD form)
_CREATE_USER_RE = re.compile(
    r"CREATE\s+USER\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    r"['`\"](?P<user>[^'`\"]+)['`\"]@['`\"](?P<host>[^'`\"]+)['`\"]\s+"
    r"IDENTIFIED\s+(?:WITH\s+(?P<plugin>\S+)\s+AS|BY\s+PASSWORD)\s+"
    r"'(?P<hash>[^']*)'",
    re.IGNORECASE)

_EA_PHP_RE = re.compile(r'ea-php(\d)(\d+)', re.IGNORECASE)

# userdata files that are not domain configs.
_USERDATA_SKIP = {'main', 'cache', 'cache.json'}


class CpanelImporter(BaseSiteImporter):
    format = 'cpanel'

    # ── layout ──
    @staticmethod
    def _root(extracted_dir):
        """The backup content root: the extraction dir itself, or its single
        ``backup-*``-style top-level directory."""
        markers = ('cp', 'userdata', 'homedir', 'homedir.tar', 'mysql')
        if any(os.path.exists(os.path.join(extracted_dir, m)) for m in markers):
            return extracted_dir
        try:
            entries = [e for e in os.listdir(extracted_dir)
                       if os.path.isdir(os.path.join(extracted_dir, e))]
        except OSError:
            return extracted_dir
        for entry in entries:
            candidate = os.path.join(extracted_dir, entry)
            if any(os.path.exists(os.path.join(candidate, m)) for m in markers):
                return candidate
        return extracted_dir

    def detect(self, extracted_dir):
        root = self._root(extracted_dir)
        has_cp = os.path.isdir(os.path.join(root, 'cp'))
        has_userdata = os.path.isdir(os.path.join(root, 'userdata'))
        has_homedir = (os.path.isdir(os.path.join(root, 'homedir'))
                       or os.path.isfile(os.path.join(root, 'homedir.tar')))
        # cp/ alone is a strong signal; otherwise require two markers.
        return has_cp or (has_userdata and has_homedir)

    # ── analyse ──
    def analyze(self, extracted_dir):
        report = self._empty_report(self.format)
        warnings = report['warnings']
        root = self._root(extracted_dir)
        report['source_root'] = os.path.relpath(root, extracted_dir)

        # homedir
        homedir = os.path.join(root, 'homedir')
        homedir_tar = os.path.join(root, 'homedir.tar')
        report['homedir_present'] = (os.path.isdir(homedir)
                                     or os.path.isfile(homedir_tar))
        if not report['homedir_present']:
            warnings.append('No homedir/ or homedir.tar found — '
                            'site files cannot be copied.')

        # account username (cp/<user>)
        username = self._account_username(root)
        if username:
            report['account_user'] = username

        # domains + php version (userdata/)
        self._parse_userdata(root, report)
        if not report['domains']:
            warnings.append('No domains found in userdata/ — the app will be '
                            'created without a docroot mapping.')

        # databases (mysql/*.sql)
        self._parse_databases(root, extracted_dir, report)

        # db users + grants (mysql.sql)
        self._parse_db_users(root, report)

        # crontab (cron/<user>)
        self._parse_crontab(root, username, report)

        # mail accounts — informational only, never migrated.
        report['mail_accounts_count'] = self._count_mail_accounts(root)
        if report['mail_accounts_count']:
            report['unsupported'].append(
                f"{report['mail_accounts_count']} mail account(s) found — "
                'mailbox migration is not supported; recreate them manually.')

        if os.path.isdir(os.path.join(root, 'dnszones')):
            report['unsupported'].append(
                'DNS zone files found (dnszones/) — zones are not imported; '
                'manage DNS from the Domains page instead.')

        return report

    @staticmethod
    def _account_username(root):
        cp_dir = os.path.join(root, 'cp')
        if not os.path.isdir(cp_dir):
            return None
        try:
            entries = [e for e in os.listdir(cp_dir)
                       if os.path.isfile(os.path.join(cp_dir, e))]
        except OSError:
            return None
        return entries[0] if entries else None

    @classmethod
    def _parse_kv_file(cls, path):
        """Parse a cPanel ``key: value`` userdata file into a dict."""
        data = {}
        text = cls._read_text(path)
        for line in text.splitlines():
            if ':' not in line or line.lstrip().startswith('#'):
                continue
            key, _, value = line.partition(':')
            data[key.strip().lower()] = value.strip().strip("'\"")
        return data

    def _parse_userdata(self, root, report):
        userdata = os.path.join(root, 'userdata')
        if not os.path.isdir(userdata):
            report['warnings'].append('No userdata/ directory found — '
                                      'domain list unavailable.')
            return
        main_meta = self._parse_kv_file(os.path.join(userdata, 'main'))
        main_domain = main_meta.get('main_domain')
        try:
            entries = sorted(os.listdir(userdata))
        except OSError as exc:
            report['warnings'].append(f'Could not list userdata/: {exc}')
            return
        for entry in entries:
            path = os.path.join(userdata, entry)
            if (not os.path.isfile(path) or entry in _USERDATA_SKIP
                    or entry.endswith('.json') or entry.endswith('_SSL')):
                continue
            meta = self._parse_kv_file(path)
            docroot = meta.get('documentroot')
            if not docroot and '.' not in entry:
                continue  # not a domain config
            report['domains'].append({
                'domain': entry,
                'docroot': docroot,
                'type': 'primary' if entry == main_domain else 'secondary',
            })
            php = meta.get('phpversion')
            if php and (entry == main_domain or not report['php_version']):
                report['php_version'] = self._normalize_php(php)
        # Primary first so downstream steps can just take domains[0].
        report['domains'].sort(key=lambda d: d['type'] != 'primary')

    @staticmethod
    def _normalize_php(raw):
        match = _EA_PHP_RE.search(raw or '')
        if match:
            return f'{match.group(1)}.{match.group(2)}'
        return raw or None

    @staticmethod
    def _parse_databases(root, extracted_dir, report):
        mysql_dir = os.path.join(root, 'mysql')
        if not os.path.isdir(mysql_dir):
            report['warnings'].append('No mysql/ directory found — '
                                      'no databases to import.')
            return
        try:
            entries = sorted(os.listdir(mysql_dir))
        except OSError as exc:
            report['warnings'].append(f'Could not list mysql/: {exc}')
            return
        for entry in entries:
            if not entry.endswith('.sql'):
                continue
            path = os.path.join(mysql_dir, entry)
            if not os.path.isfile(path):
                continue
            try:
                size = os.path.getsize(path)
            except OSError:
                size = 0
            report['databases'].append({
                'name': entry[:-4],
                'engine': 'mysql',
                'dump_path': os.path.relpath(path, extracted_dir).replace('\\', '/'),
                'size': size,
            })

    @classmethod
    def _parse_db_users(cls, root, report):
        grants_file = os.path.join(root, 'mysql.sql')
        if not os.path.isfile(grants_file):
            report['warnings'].append('No mysql.sql grants file found — '
                                      'database users cannot be preserved.')
            return
        text = cls._read_text(grants_file, report['warnings'], 'mysql.sql')
        users = {}

        def _user(name):
            return users.setdefault(name, {
                'user': name, 'hash': None,
                'hash_format': 'unknown', 'grants': [],
            })

        for match in _CREATE_USER_RE.finditer(text):
            entry = _user(match.group('user'))
            cls._record_hash(entry, match.group('hash'),
                             plugin=match.group('plugin'))
        for match in _GRANT_RE.finditer(text):
            entry = _user(match.group('user'))
            statement = match.group(0).strip()
            # Never carry password material inside the grant list.
            statement = re.sub(r"\s+IDENTIFIED\s+BY\s+PASSWORD\s+'[^']*'", '',
                               statement, flags=re.IGNORECASE)
            entry['grants'].append(statement)
            if match.group('hash'):
                cls._record_hash(entry, match.group('hash'))
        report['db_users'] = list(users.values())
        for entry in report['db_users']:
            if entry['hash_format'] != 'mysql_native_password':
                report['warnings'].append(
                    f"Password hash for DB user '{entry['user']}' is not a "
                    'mysql_native_password hash — a new password will be '
                    'generated on import.')

    @staticmethod
    def _record_hash(entry, hash_value, plugin=None):
        if not hash_value:
            return
        entry['hash'] = hash_value
        plugin = (plugin or '').lower()
        if _NATIVE_HASH_RE.match(hash_value) and plugin in ('', 'mysql_native_password'):
            entry['hash_format'] = 'mysql_native_password'
        elif plugin:
            entry['hash_format'] = plugin

    @classmethod
    def _parse_crontab(cls, root, username, report):
        cron_dir = os.path.join(root, 'cron')
        if not os.path.isdir(cron_dir):
            return
        candidates = []
        if username:
            candidates.append(os.path.join(cron_dir, username))
        try:
            candidates.extend(os.path.join(cron_dir, e)
                              for e in sorted(os.listdir(cron_dir)))
        except OSError:
            pass
        for path in candidates:
            if not os.path.isfile(path):
                continue
            for line in cls._read_text(path).splitlines():
                stripped = line.strip()
                if (not stripped or stripped.startswith('#')
                        or re.match(r'^[A-Z_]+=', stripped)):
                    continue  # comments and SHELL=/PATH= env lines
                if stripped not in report['crontab']:
                    report['crontab'].append(stripped)
            break  # first crontab file wins

    @staticmethod
    def _count_mail_accounts(root):
        """Count mailbox entries in homedir/etc/<domain>/passwd (informational)."""
        etc_dir = os.path.join(root, 'homedir', 'etc')
        if not os.path.isdir(etc_dir):
            return 0
        count = 0
        try:
            for domain in os.listdir(etc_dir):
                passwd = os.path.join(etc_dir, domain, 'passwd')
                if os.path.isfile(passwd):
                    with open(passwd, 'r', encoding='utf-8',
                              errors='replace') as fh:
                        count += sum(1 for line in fh if line.strip())
        except OSError:
            pass
        return count
