"""DirectAdmin full-backup importer.

Understands the account backup layout produced by DirectAdmin's backup
system (``user.admin.<user>.tar.gz`` / ``backup/<user>.tar.gz``). The tar
root is the account's home content plus metadata:

    backup/                      — account metadata
      user.conf                  — account config (username, primary domain)
      <domain>/domain.conf       — per-domain config
      <domain>/email/passwd      — mailbox credential file (not migrated)
      mysql.conf                 — the account's MySQL login
      <db>.sql or mysql/<db>.sql — one dump per database
      <db>.conf                  — per-database users/hosts
      crontab.conf               — the account crontab ("<id>=<cron line>")
    domains/<domain>/public_html — docroots (plain files, not nested tars)
    imap/<domain>/<box>/         — mail data (not migrated)

The orchestrator's copy step expects site files under
``<source_root>/homedir/``, so ``analyze`` stages a copy of ``domains/``
at ``homedir/domains/`` inside the work directory (mirroring how cPanel's
nested ``homedir.tar`` gets unpacked before the copy step).

Everything is parsed defensively: a missing or malformed piece becomes a
``warnings`` entry, never an exception — partial backups still analyse.
"""
import os
import re
import shutil

from .base import BaseSiteImporter

# Old-style mysql_native_password hash: '*' + 40 hex chars.
_NATIVE_HASH_RE = re.compile(r'^\*[0-9A-Fa-f]{40}$')

# '8.1', 'php81', '8_1' → ('8', '1')
_PHP_VER_RE = re.compile(r'(\d)[._-]?(\d{1,2})')

# "<id>=<cron line>" prefix used by crontab.conf.
_CRON_ID_RE = re.compile(r'^\d+=')

# conf keys naming per-database users: user, user0, user1, ...
_DB_USER_KEY_RE = re.compile(r'^user(\d*)$')

# backup/ entries that are metadata files, never domain dirs.
_NON_DOMAIN_DIRS = {'mysql', 'email', 'imap'}


class DirectadminImporter(BaseSiteImporter):
    format = 'directadmin'

    # ── layout ──
    @staticmethod
    def _root(extracted_dir):
        """The backup content root: the extraction dir itself, or its single
        top-level directory (archives usually extract to one wrapper dir)."""
        markers = ('backup', 'domains', 'imap')
        if any(os.path.isdir(os.path.join(extracted_dir, m)) for m in markers):
            return extracted_dir
        try:
            entries = [e for e in os.listdir(extracted_dir)
                       if os.path.isdir(os.path.join(extracted_dir, e))]
        except OSError:
            return extracted_dir
        for entry in entries:
            candidate = os.path.join(extracted_dir, entry)
            if any(os.path.isdir(os.path.join(candidate, m)) for m in markers):
                return candidate
        return extracted_dir

    def detect(self, extracted_dir):
        root = self._root(extracted_dir)
        backup_dir = os.path.join(root, 'backup')
        if not os.path.isdir(backup_dir):
            return False
        return (os.path.isfile(os.path.join(backup_dir, 'user.conf'))
                or os.path.isfile(os.path.join(backup_dir, 'mysql.conf'))
                or os.path.isfile(os.path.join(backup_dir, 'crontab.conf'))
                or os.path.isdir(os.path.join(root, 'domains')))

    # ── analyse ──
    def analyze(self, extracted_dir):
        report = self._empty_report(self.format)
        warnings = report['warnings']
        root = self._root(extracted_dir)
        report['source_root'] = os.path.relpath(root, extracted_dir)
        backup_dir = os.path.join(root, 'backup')
        if not os.path.isdir(backup_dir):
            warnings.append('No backup/ metadata directory found — '
                            'account metadata unavailable.')

        # account config (backup/user.conf)
        user_conf = {}
        user_conf_path = os.path.join(backup_dir, 'user.conf')
        if os.path.isfile(user_conf_path):
            user_conf = self._parse_conf_pairs(self._read_text(
                user_conf_path, warnings, 'backup/user.conf'))
        else:
            warnings.append('No backup/user.conf found — account username '
                            'and primary domain unavailable.')
        username = user_conf.get('username') or user_conf.get('name')
        if username:
            report['account_user'] = username

        # domains + php version
        self._parse_domains(root, backup_dir, user_conf, report)
        if not report['domains']:
            warnings.append('No domains found in the backup — the app will '
                            'be created without a docroot mapping.')

        # stage domains/ as homedir/domains/ for the shared copy step
        self._stage_homedir(root, report)

        # databases (backup/mysql/*.sql or backup/*.sql)
        self._parse_databases(backup_dir, extracted_dir, report)

        # db users (backup/mysql.conf + backup/<db>.conf)
        self._parse_db_users(backup_dir, report)

        # crontab (backup/crontab.conf or crontab/)
        self._parse_crontab(root, backup_dir, report)

        # mail accounts — informational only, never migrated.
        report['mail_accounts_count'] = self._count_mail_accounts(
            root, backup_dir)
        if report['mail_accounts_count']:
            report['unsupported'].append(
                f"{report['mail_accounts_count']} mail account(s) found — "
                'mailbox migration is not supported; recreate them manually.')

        return report

    # ── conf parsing ──
    @staticmethod
    def _parse_conf_pairs(text):
        """Parse DirectAdmin conf content: ``key=value`` per line, or
        ``&``-joined single-line query style. Values may be quoted."""
        pairs = {}
        for chunk in re.split(r'[&\r\n]+', text or ''):
            chunk = chunk.strip()
            if not chunk or chunk.startswith('#') or '=' not in chunk:
                continue
            key, _, value = chunk.partition('=')
            pairs[key.strip().lower()] = value.strip().strip('\'"')
        return pairs

    # ── domains ──
    def _parse_domains(self, root, backup_dir, user_conf, report):
        primary = (user_conf.get('domain') or '').lower() or None
        username = report.get('account_user') or 'user'
        found = {}

        # per-domain metadata dirs under backup/
        if os.path.isdir(backup_dir):
            try:
                entries = sorted(os.listdir(backup_dir))
            except OSError as exc:
                report['warnings'].append(f'Could not list backup/: {exc}')
                entries = []
            for entry in entries:
                path = os.path.join(backup_dir, entry)
                if (os.path.isdir(path) and '.' in entry
                        and entry.lower() not in _NON_DOMAIN_DIRS):
                    found[entry] = path

        # docroot dirs under domains/
        domains_dir = os.path.join(root, 'domains')
        if os.path.isdir(domains_dir):
            try:
                for entry in sorted(os.listdir(domains_dir)):
                    if (os.path.isdir(os.path.join(domains_dir, entry))
                            and '.' in entry):
                        found.setdefault(entry, None)
            except OSError as exc:
                report['warnings'].append(f'Could not list domains/: {exc}')

        for domain in sorted(found):
            report['domains'].append({
                'domain': domain,
                'docroot': f'/home/{username}/domains/{domain}/public_html',
                'type': 'primary' if domain == primary else 'secondary',
            })
            if not os.path.isdir(os.path.join(domains_dir, domain,
                                              'public_html')):
                report['warnings'].append(
                    f'No domains/{domain}/public_html directory in the '
                    'backup — site files for this domain are missing.')
        if primary and primary not in found and report['domains']:
            report['warnings'].append(
                f'Primary domain {primary!r} from user.conf has no data in '
                'the backup.')
        # Primary first so downstream steps can just take domains[0].
        report['domains'].sort(key=lambda d: d['type'] != 'primary')

        # php version: user.conf then per-domain domain.conf
        report['php_version'] = self._find_php_version(
            [user_conf] + [self._parse_conf_pairs(self._read_text(
                os.path.join(meta, 'domain.conf')))
                for meta in found.values() if meta])

    @staticmethod
    def _find_php_version(conf_dicts):
        for conf in conf_dicts:
            for key, value in conf.items():
                if 'php' not in key:
                    continue
                if 'release' not in key and 'ver' not in key:
                    continue
                match = _PHP_VER_RE.search(value or '')
                if match:
                    return f'{match.group(1)}.{match.group(2)}'
        return None

    # ── homedir staging ──
    @staticmethod
    def _stage_homedir(root, report):
        """The shared copy step reads ``<source_root>/homedir/…`` — stage a
        copy of domains/ there (the DirectAdmin analogue of unpacking
        cPanel's nested homedir.tar)."""
        domains_dir = os.path.join(root, 'domains')
        if not os.path.isdir(domains_dir):
            report['warnings'].append('No domains/ directory found — '
                                      'site files cannot be copied.')
            return
        staged = os.path.join(root, 'homedir', 'domains')
        try:
            if not os.path.isdir(staged):
                shutil.copytree(domains_dir, staged)
                report['warnings'].append(
                    'Staged domains/ under homedir/ in the work directory '
                    'so the shared file-copy step can run (extra copy).')
            report['homedir_present'] = True
        except OSError as exc:
            report['warnings'].append(
                f'Could not stage domains/ for the copy step: {exc}')

    # ── databases ──
    @staticmethod
    def _parse_databases(backup_dir, extracted_dir, report):
        candidates = []
        mysql_dir = os.path.join(backup_dir, 'mysql')
        for directory in (mysql_dir, backup_dir):
            if not os.path.isdir(directory):
                continue
            try:
                entries = sorted(os.listdir(directory))
            except OSError as exc:
                report['warnings'].append(
                    f'Could not list {os.path.basename(directory)}/: {exc}')
                continue
            candidates = [os.path.join(directory, e) for e in entries
                          if e.endswith('.sql')
                          and os.path.isfile(os.path.join(directory, e))]
            if candidates:
                break
        if not candidates:
            report['warnings'].append('No database dumps (*.sql) found in '
                                      'backup/ — no databases to import.')
            return
        for path in candidates:
            try:
                size = os.path.getsize(path)
            except OSError:
                size = 0
            report['databases'].append({
                'name': os.path.basename(path)[:-4],
                'engine': 'mysql',
                'dump_path': os.path.relpath(
                    path, extracted_dir).replace('\\', '/'),
                'size': size,
            })

    # ── db users ──
    def _parse_db_users(self, backup_dir, report):
        users = {}

        def _record(name, password):
            if not name:
                return
            entry = users.setdefault(name, {
                'user': name, 'hash': None,
                'hash_format': 'unknown', 'grants': [],
            })
            if password and _NATIVE_HASH_RE.match(password):
                entry['hash'] = password
                entry['hash_format'] = 'mysql_native_password'
            elif password and not entry['hash']:
                entry['hash'] = password  # opaque — new password on import

        # the account's own MySQL login (backup/mysql.conf)
        mysql_conf = os.path.join(backup_dir, 'mysql.conf')
        if os.path.isfile(mysql_conf):
            pairs = self._parse_conf_pairs(self._read_text(
                mysql_conf, report['warnings'], 'backup/mysql.conf'))
            _record(pairs.get('user'), pairs.get('passwd'))
        else:
            report['warnings'].append('No backup/mysql.conf found — the '
                                      "account's MySQL login is unavailable.")

        # per-database user lists (backup/<db>.conf)
        for database in report['databases']:
            conf_path = os.path.join(backup_dir, f"{database['name']}.conf")
            if not os.path.isfile(conf_path):
                continue
            pairs = self._parse_conf_pairs(self._read_text(conf_path))
            for key, value in pairs.items():
                match = _DB_USER_KEY_RE.match(key)
                if match:
                    _record(value, pairs.get(f'passwd{match.group(1)}'))

        report['db_users'] = list(users.values())
        for entry in report['db_users']:
            if entry['hash_format'] != 'mysql_native_password':
                report['warnings'].append(
                    f"Password for DB user '{entry['user']}' is not a "
                    'portable mysql_native_password hash — a new password '
                    'will be generated on import.')

    # ── crontab ──
    def _parse_crontab(self, root, backup_dir, report):
        candidates = [os.path.join(backup_dir, 'crontab.conf')]
        crontab_dir = os.path.join(root, 'crontab')
        if os.path.isdir(crontab_dir):
            try:
                candidates.extend(os.path.join(crontab_dir, e)
                                  for e in sorted(os.listdir(crontab_dir)))
            except OSError:
                pass
        for path in candidates:
            if not os.path.isfile(path):
                continue
            for line in self._read_text(path).splitlines():
                stripped = _CRON_ID_RE.sub('', line.strip())
                if not stripped or stripped.startswith('#'):
                    continue
                parts = stripped.split(None, 5)
                if len(parts) < 6 or stripped[0] not in '*0123456789/@-':
                    continue  # env lines (MAILTO=...) and malformed rows
                if stripped not in report['crontab']:
                    report['crontab'].append(stripped)
            break  # first crontab source wins

    # ── mail ──
    @staticmethod
    def _count_mail_accounts(root, backup_dir):
        count = 0
        # mailbox credential files: backup/<domain>/email/passwd
        if os.path.isdir(backup_dir):
            try:
                for entry in os.listdir(backup_dir):
                    passwd = os.path.join(backup_dir, entry, 'email', 'passwd')
                    if '.' in entry and os.path.isfile(passwd):
                        with open(passwd, 'r', encoding='utf-8',
                                  errors='replace') as fh:
                            count += sum(1 for line in fh if line.strip())
            except OSError:
                pass
        if count:
            return count
        # fall back to mailbox dirs: imap/<domain>/<box>/
        imap_dir = os.path.join(root, 'imap')
        if os.path.isdir(imap_dir):
            try:
                for domain in os.listdir(imap_dir):
                    domain_dir = os.path.join(imap_dir, domain)
                    if not os.path.isdir(domain_dir):
                        continue
                    count += sum(
                        1 for box in os.listdir(domain_dir)
                        if os.path.isdir(os.path.join(domain_dir, box)))
            except OSError:
                pass
        return count
