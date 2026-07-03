"""Hestia / VestaCP backup importer.

Understands the user backup layout produced by ``v-backup-user``
(``<user>.YYYY-MM-DD.tar``):

    pam/passwd, pam/group        — account identity
    user.conf                    — account config (also hestia/ or vesta/)
    hestia/ or vesta/            — panel object indexes (web.conf, db.conf,
                                   cron.conf — KEY='VALUE' lines)
    web/<domain>/                — per-domain data; the docroot ships as a
                                   nested public_html.tar.gz or
                                   domain_data.tar.gz
    db/<name>/<name>.sql[.gz]    — one dump (dir) per database
    cron/cron.conf               — cron jobs in panel config format
                                   (MIN='..' HOUR='..' ... CMD='..')
    mail/<domain>/               — mailboxes (not migrated)
    dns/                         — zone data (not imported)

The orchestrator's copy step expects site files under
``<source_root>/homedir/``, so ``analyze`` safely extracts each domain's
nested docroot archive into ``homedir/web/<domain>/`` inside the work
directory (mirroring how cPanel's nested homedir.tar gets unpacked).

Everything is parsed defensively: a missing or malformed piece becomes a
``warnings`` entry, never an exception — partial backups still analyse.
"""
import gzip
import os
import re
import shutil
import tarfile

from .base import BaseSiteImporter

# Old-style mysql_native_password hash: '*' + 40 hex chars.
_NATIVE_HASH_RE = re.compile(r'^\*[0-9A-Fa-f]{40}$')

# KEY='VALUE' pairs used throughout Hestia/Vesta config lines.
_KV_RE = re.compile(r"(\w+)='([^']*)'")

# PHP-FPM-81 / php-fpm-8.1 / php81 → ('8', '1')
_PHP_RE = re.compile(r'php[-_ ]?(?:fpm[-_]?)?(\d)\.?(\d{1,2})', re.IGNORECASE)

# Cap for decompressing a gzipped SQL dump (matches the archive cap).
_MAX_DUMP_BYTES = 20 * 1024 ** 3

# Directories that may hold the panel's object indexes.
_INDEX_DIRS = ('hestia', 'vesta')


class HestiaImporter(BaseSiteImporter):
    format = 'hestia'

    # ── layout ──
    @staticmethod
    def _root(extracted_dir):
        """The backup content root: the extraction dir itself, or its single
        top-level directory (archives usually extract to one wrapper dir)."""
        markers = ('pam', 'user.conf', 'hestia', 'vesta', 'web', 'db', 'cron')
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
        identity = (os.path.isdir(os.path.join(root, 'pam'))
                    or os.path.isfile(os.path.join(root, 'user.conf'))
                    or any(os.path.isfile(os.path.join(root, d, 'user.conf'))
                           for d in _INDEX_DIRS))
        content = (os.path.isdir(os.path.join(root, 'web'))
                   or os.path.isdir(os.path.join(root, 'db'))
                   or os.path.isdir(os.path.join(root, 'mail'))
                   or os.path.isfile(os.path.join(root, 'cron', 'cron.conf')))
        return identity and content

    # ── analyse ──
    def analyze(self, extracted_dir):
        report = self._empty_report(self.format)
        warnings = report['warnings']
        root = self._root(extracted_dir)
        report['source_root'] = os.path.relpath(root, extracted_dir)

        # account username (pam/passwd)
        username = self._account_username(root)
        if username:
            report['account_user'] = username
        else:
            warnings.append('No pam/passwd found — account username '
                            'unavailable.')

        # web domains: stage nested docroot archives under homedir/
        self._parse_web(root, report)
        if not report['domains']:
            warnings.append('No domains found under web/ — the app will be '
                            'created without a docroot mapping.')
        homedir = os.path.join(root, 'homedir')
        report['homedir_present'] = os.path.isdir(homedir)
        if not report['homedir_present']:
            warnings.append('No site files could be staged — '
                            'nothing to copy.')

        # php version (per-domain web.conf, index web.conf, user.conf)
        report['php_version'] = self._find_php_version(root)

        # databases (db/<name>/) + users (db.conf index)
        self._parse_databases(root, extracted_dir, report)
        self._parse_db_users(root, report)

        # cron (panel config format → standard crontab lines)
        self._parse_crontab(root, report)

        # mail accounts — informational only, never migrated.
        report['mail_accounts_count'] = self._count_mail_accounts(root)
        if report['mail_accounts_count']:
            report['unsupported'].append(
                f"{report['mail_accounts_count']} mail account(s) found — "
                'mailbox migration is not supported; recreate them manually.')

        if os.path.isdir(os.path.join(root, 'dns')):
            report['unsupported'].append(
                'DNS zone data found (dns/) — zones are not imported; '
                'manage DNS from the Domains page instead.')

        return report

    @staticmethod
    def _account_username(root):
        passwd = os.path.join(root, 'pam', 'passwd')
        if not os.path.isfile(passwd):
            return None
        try:
            with open(passwd, 'r', encoding='utf-8', errors='replace') as fh:
                for line in fh:
                    line = line.strip()
                    if line and not line.startswith('#') and ':' in line:
                        return line.split(':', 1)[0]
        except OSError:
            pass
        return None

    # ── web domains + docroot staging ──
    def _parse_web(self, root, report):
        web_dir = os.path.join(root, 'web')
        if not os.path.isdir(web_dir):
            report['warnings'].append('No web/ directory found — '
                                      'domain list unavailable.')
            return
        try:
            domains = sorted(e for e in os.listdir(web_dir)
                             if os.path.isdir(os.path.join(web_dir, e)))
        except OSError as exc:
            report['warnings'].append(f'Could not list web/: {exc}')
            return
        username = report.get('account_user') or 'user'
        for index, domain in enumerate(domains):
            docroot_rel = self._stage_docroot(root, domain,
                                              report['warnings'])
            report['domains'].append({
                'domain': domain,
                'docroot': (f'/home/{username}/{docroot_rel}'
                            if docroot_rel else None),
                # Hestia has no primary-domain marker; first domain leads.
                'type': 'primary' if index == 0 else 'secondary',
            })

    def _stage_docroot(self, root, domain, warnings):
        """Materialise the domain's docroot under homedir/web/<domain>/ and
        return its path relative to homedir (or None)."""
        domain_dir = os.path.join(root, 'web', domain)
        stage = os.path.join(root, 'homedir', 'web', domain)
        rel = f'web/{domain}'

        archive = None
        for name in ('public_html.tar.gz', 'domain_data.tar.gz'):
            candidate = os.path.join(domain_dir, name)
            if os.path.isfile(candidate):
                archive = candidate
                break
        if archive:
            if not os.path.isdir(stage):  # idempotent on re-analyse
                os.makedirs(stage, exist_ok=True)
                if not self._extract_nested(archive, stage, warnings):
                    shutil.rmtree(stage, ignore_errors=True)
                    return None
                warnings.append(
                    f'Extracted nested {os.path.basename(archive)} for '
                    f'{domain} into the work directory (extra step).')
        elif os.path.isdir(os.path.join(domain_dir, 'public_html')):
            # rare: plain (already unpacked) docroot
            try:
                if not os.path.isdir(os.path.join(stage, 'public_html')):
                    shutil.copytree(os.path.join(domain_dir, 'public_html'),
                                    os.path.join(stage, 'public_html'))
            except OSError as exc:
                warnings.append(f'Could not stage docroot for {domain}: {exc}')
                return None
        else:
            warnings.append(f'No docroot archive found for {domain} '
                            '(public_html.tar.gz / domain_data.tar.gz).')
            return None
        if os.path.isdir(os.path.join(stage, 'public_html')):
            return f'{rel}/public_html'
        return rel

    @classmethod
    def _extract_nested(cls, archive_path, dest, warnings):
        """Safely extract a nested docroot archive; True on success."""
        try:
            try:
                from app.services.site_import_service import SiteImportService
                SiteImportService._extract_tar(archive_path, dest,
                                               warnings=warnings)
            except ImportError:
                cls._fallback_extract(archive_path, dest, warnings)
            return True
        except Exception as exc:
            warnings.append('Could not extract nested archive '
                            f'{os.path.basename(archive_path)}: {exc}')
            return False

    @staticmethod
    def _fallback_extract(archive_path, dest, warnings):
        """Traversal-guarded extraction for use outside the app context."""
        os.makedirs(dest, exist_ok=True)
        with tarfile.open(archive_path, 'r:*') as tar:
            members = []
            for member in tar.getmembers():
                name = member.name.replace('\\', '/')
                if name.startswith('/') or os.path.isabs(member.name):
                    raise ValueError(
                        f'archive member has an absolute path: {member.name!r}')
                if '..' in name.split('/'):
                    raise ValueError(
                        f'archive member escapes the extraction dir: '
                        f'{member.name!r}')
                if member.issym() or member.islnk():
                    warnings.append(f'Skipped link member {member.name!r}')
                    continue
                if member.isdev():
                    continue
                members.append(member)
            tar.extractall(dest, members=members)

    # ── php ──
    @classmethod
    def _find_php_version(cls, root):
        candidates = []
        # per-domain web.conf files anywhere under web/<domain>/
        web_dir = os.path.join(root, 'web')
        if os.path.isdir(web_dir):
            for base, _dirs, files in os.walk(web_dir):
                candidates.extend(os.path.join(base, f) for f in files
                                  if f == 'web.conf')
        # object indexes + user config
        for index_dir in _INDEX_DIRS:
            candidates.append(os.path.join(root, index_dir, 'web.conf'))
            candidates.append(os.path.join(root, index_dir, 'user.conf'))
        candidates.append(os.path.join(root, 'user.conf'))
        for path in candidates:
            if not os.path.isfile(path):
                continue
            match = _PHP_RE.search(cls._read_text(path))
            if match:
                return f'{match.group(1)}.{match.group(2)}'
        return None

    # ── databases ──
    def _parse_databases(self, root, extracted_dir, report):
        db_dir = os.path.join(root, 'db')
        if not os.path.isdir(db_dir):
            report['warnings'].append('No db/ directory found — '
                                      'no databases to import.')
            return
        try:
            names = sorted(e for e in os.listdir(db_dir)
                           if os.path.isdir(os.path.join(db_dir, e)))
        except OSError as exc:
            report['warnings'].append(f'Could not list db/: {exc}')
            return
        engines = self._db_engines(root)
        for name in names:
            dump = self._find_dump(os.path.join(db_dir, name), name,
                                   report['warnings'])
            if not dump:
                report['warnings'].append(
                    f'No SQL dump found for database {name} — '
                    'it will be created empty.')
            try:
                size = os.path.getsize(dump) if dump else 0
            except OSError:
                size = 0
            report['databases'].append({
                'name': name,
                'engine': engines.get(name, 'mysql'),
                'dump_path': (os.path.relpath(dump, extracted_dir)
                              .replace('\\', '/') if dump else None),
                'size': size,
            })

    def _find_dump(self, db_path, name, warnings):
        """Locate (and if needed gunzip) the dump inside db/<name>/."""
        try:
            entries = sorted(os.listdir(db_path))
        except OSError:
            return None
        preferred = f'{name}.sql'
        sql = [e for e in entries if e.endswith('.sql')]
        if preferred in sql:
            return os.path.join(db_path, preferred)
        if sql:
            return os.path.join(db_path, sql[0])
        gzipped = [e for e in entries if e.endswith('.sql.gz')]
        if gzipped:
            src = os.path.join(db_path, gzipped[0])
            dest = src[:-3]
            try:
                self._gunzip(src, dest)
                warnings.append(
                    f'Decompressed {gzipped[0]} for database {name} '
                    '(extra step in the work directory).')
                return dest
            except (OSError, ValueError) as exc:
                warnings.append(
                    f'Could not decompress dump {gzipped[0]}: {exc}')
        return None

    @staticmethod
    def _gunzip(src, dest, max_bytes=_MAX_DUMP_BYTES):
        total = 0
        with gzip.open(src, 'rb') as fin, open(dest, 'wb') as fout:
            while True:
                chunk = fin.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError('decompressed dump exceeds size limit')
                fout.write(chunk)

    @classmethod
    def _db_conf_records(cls, root):
        """Parse the db.conf object index (one KEY='VALUE' line per DB)."""
        for candidate in ([os.path.join(root, d, 'db.conf')
                           for d in _INDEX_DIRS]
                          + [os.path.join(root, 'db', 'db.conf'),
                             os.path.join(root, 'db.conf')]):
            if not os.path.isfile(candidate):
                continue
            records = []
            for line in cls._read_text(candidate).splitlines():
                pairs = dict(_KV_RE.findall(line))
                if pairs.get('DB'):
                    records.append(pairs)
            return records
        return None

    def _db_engines(self, root):
        records = self._db_conf_records(root) or []
        return {r['DB']: (r.get('TYPE') or 'mysql').lower() for r in records}

    def _parse_db_users(self, root, report):
        records = self._db_conf_records(root)
        if records is None:
            if report['databases']:
                report['warnings'].append(
                    'No db.conf index found — database users cannot be '
                    'preserved.')
            return
        users = {}
        for record in records:
            name = record.get('DBUSER')
            if not name:
                continue
            entry = users.setdefault(name, {
                'user': name, 'hash': None,
                'hash_format': 'unknown', 'grants': [],
            })
            digest = record.get('MD5') or record.get('PASSWORD')
            if digest and _NATIVE_HASH_RE.match(digest):
                entry['hash'] = digest
                entry['hash_format'] = 'mysql_native_password'
            elif digest and not entry['hash']:
                entry['hash'] = digest
        report['db_users'] = list(users.values())
        for entry in report['db_users']:
            if entry['hash_format'] != 'mysql_native_password':
                report['warnings'].append(
                    f"Password hash for DB user '{entry['user']}' is not a "
                    'portable mysql_native_password hash — a new password '
                    'will be generated on import.')

    # ── cron ──
    @classmethod
    def _parse_crontab(cls, root, report):
        candidates = [os.path.join(root, 'cron', 'cron.conf')]
        candidates.extend(os.path.join(root, d, 'cron.conf')
                          for d in _INDEX_DIRS)
        path = next((p for p in candidates if os.path.isfile(p)), None)
        if not path:
            return
        for line in cls._read_text(path).splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            pairs = dict(_KV_RE.findall(line))
            if not pairs:
                continue
            if pairs.get('SUSPENDED', 'no').lower() == 'yes':
                report['warnings'].append(
                    'Skipped a suspended cron job: '
                    f"{pairs.get('CMD', '?')!r}")
                continue
            fields = [pairs.get(k) for k in
                      ('MIN', 'HOUR', 'DAY', 'MONTH', 'WDAY')]
            command = pairs.get('CMD')
            if not command or any(f is None for f in fields):
                report['warnings'].append(
                    f'Unparseable cron entry skipped: {line!r}')
                continue
            converted = ' '.join(fields + [command])
            if converted not in report['crontab']:
                report['crontab'].append(converted)

    # ── mail ──
    @staticmethod
    def _count_mail_accounts(root):
        mail_dir = os.path.join(root, 'mail')
        if not os.path.isdir(mail_dir):
            return 0
        count = 0
        try:
            for domain in os.listdir(mail_dir):
                domain_dir = os.path.join(mail_dir, domain)
                if not os.path.isdir(domain_dir):
                    continue
                # account list files: mail/<domain>/*.conf (ACCOUNT='..')
                accounts = 0
                for entry in os.listdir(domain_dir):
                    if entry.endswith('.conf'):
                        path = os.path.join(domain_dir, entry)
                        with open(path, 'r', encoding='utf-8',
                                  errors='replace') as fh:
                            accounts += sum(1 for line in fh
                                            if "ACCOUNT='" in line)
                if not accounts:
                    # fall back to per-mailbox directories
                    boxes = os.path.join(domain_dir, 'accounts')
                    scan = boxes if os.path.isdir(boxes) else domain_dir
                    accounts = sum(
                        1 for e in os.listdir(scan)
                        if os.path.isdir(os.path.join(scan, e)))
                count += accounts
        except OSError:
            pass
        return count
