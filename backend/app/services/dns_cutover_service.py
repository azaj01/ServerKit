"""Reversible DNS cutover — snapshot a domain's live records, flip them at the new
box, verify propagation, and (if needed) revert to the pre-cutover WORLD.

A migration cutover repoints a domain's records at the freshly-imported site.
ServerKit's DNS activity ledger only records the *after* value of each write, so
it cannot power a revert on its own. This service therefore:

* **snapshots** the domain's existing provider records (server-sourced — the
  panel reads them itself; the client may only filter which *names* to include,
  never supply record data — plan 31 #2);
* performs the **cutover** (with a dry-run that returns the exact provider ops
  without writing — plan 31 #1), tracking the records it *creates* so the revert
  can undo them;
* **verifies** post-cutover resolution across public resolvers (plan 31 #1);
* **reverts** by DELETING the records the cutover created (reverse order) and
  re-applying every captured record, restoring the world byte-for-byte
  (plan 31 #3, Decision 3).

The provider client is resolved through the registered ``DNSProviderConfig``
providers (Decision 4); providers without a shared client stay a clean 501
``NO_PROVIDER`` naming the provider.
"""
import logging

from app import db
from app.models.dns_cutover_snapshot import DnsCutoverSnapshot
from app.services.dns_ownership_service import DnsOwnershipService

logger = logging.getLogger(__name__)

# Recommended TTL to lower records to before a cutover (5 minutes).
RECOMMENDED_CUTOVER_TTL = 300


class DnsCutoverError(Exception):
    """A cutover operation that maps to an HTTP error.

    ``status_code`` (default 400) and ``code`` are surfaced by the API layer so
    an unsupported provider becomes a clean ``501 NO_PROVIDER`` rather than a
    generic 500.
    """

    def __init__(self, message, status_code=400, code=None, provider=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        # The provider this error is about (surfaced in the API body so a
        # ``NO_PROVIDER`` names the unsupported provider, not just the code).
        self.provider = provider


class DnsCutoverService:
    """Snapshot / cutover / verify / revert for a reversible DNS migration."""

    # ── provider resolution (Decision 4) ─────────────────────────────────────
    @classmethod
    def _resolve_dns_client(cls, provider=None, provider_zone_id=None):
        """Resolve a shared DNS client + its provider config, routing through the
        registered providers rather than hardcoding Cloudflare.

        Returns ``(client, config)``. Raises :class:`DnsCutoverError` (501
        ``NO_PROVIDER``, provider named) when nothing is connected or the
        provider has no shared client yet.
        """
        from app.models.email import DNSProviderConfig
        from app.services.dns import DnsCredential, get_client

        query = DNSProviderConfig.query
        if provider:
            query = query.filter_by(provider=provider)
        config = query.filter_by(is_default=True).first() or query.first()
        if not config:
            named = f' for provider {provider!r}' if provider else ''
            raise DnsCutoverError(
                f'No connected DNS provider{named} to perform this cutover.',
                status_code=501, code='NO_PROVIDER', provider=provider)
        try:
            client = get_client(DnsCredential.from_provider_config(config))
        except ValueError:
            raise DnsCutoverError(
                f'DNS cutover is not supported for provider {config.provider!r} '
                'yet — connect Cloudflare or perform this change manually.',
                status_code=501, code='NO_PROVIDER', provider=config.provider)
        return client, config

    # ── TTL guidance ─────────────────────────────────────────────────────────
    @classmethod
    def ttl_guidance(cls, records):
        """Advise lowering TTLs before a cutover so the switch propagates fast.

        Returns the recommended pre-cutover TTL, the current max TTL across the
        supplied records (the worst-case propagation wait), and a per-record
        breakdown flagging records that still need lowering.
        """
        records = records or []
        ttls = []
        for rec in records:
            try:
                ttl = int(rec.get('ttl'))
            except (TypeError, ValueError):
                continue
            if ttl > 0:
                ttls.append(ttl)
        current_max = max(ttls) if ttls else None
        breakdown = []
        for rec in records:
            try:
                ttl = int(rec.get('ttl'))
            except (TypeError, ValueError):
                ttl = None
            breakdown.append({
                'name': rec.get('name'),
                'type': rec.get('type') or rec.get('record_type'),
                'ttl': ttl,
                'needs_lowering': bool(ttl and ttl > RECOMMENDED_CUTOVER_TTL),
            })
        return {
            'recommended_ttl': RECOMMENDED_CUTOVER_TTL,
            'current_max_ttl': current_max,
            # Worst-case seconds a stale answer may linger after the flip.
            'propagation_wait_seconds': current_max if current_max else 3600,
            'advice': (
                'Lower the TTL of the records you will cut over to '
                f'{RECOMMENDED_CUTOVER_TTL}s and wait for the previous (higher) '
                'TTL to elapse before flipping — resolvers then pick up the new '
                'target within minutes, and a revert is just as fast.'),
            'records': breakdown,
        }

    # ── snapshots (server-sourced, Decision 2) ───────────────────────────────
    @classmethod
    def create_snapshot(cls, domain, provider_zone_id, provider=None, names=None):
        """Snapshot the domain's live provider records before a cutover.

        The panel reads the records itself from the provider (server-sourced);
        ``names`` may only FILTER which record names to include — the client
        never supplies record data. Returns the persisted snapshot row.
        """
        domain = (domain or '').strip().lower().rstrip('.')
        if not domain:
            raise DnsCutoverError('A domain is required to snapshot.')
        if not provider_zone_id:
            raise DnsCutoverError('A provider_zone_id is required to snapshot.')

        client, config = cls._resolve_dns_client(provider, provider_zone_id)
        res = client.list_records(provider_zone_id)
        if not res.get('success'):
            raise DnsCutoverError(
                f"Could not read live records for the zone: {res.get('error')}",
                status_code=502)
        records = res.get('records', []) or []

        if names:
            wanted = {(n or '').strip().lower().rstrip('.') for n in names}
            records = [r for r in records
                       if (r.get('name') or '').strip().lower().rstrip('.') in wanted]

        snapshot = DnsCutoverSnapshot(
            domain=domain, provider=config.provider,
            provider_zone_id=provider_zone_id, status='captured')
        snapshot.set_records(records)
        snapshot.set_created_records([])
        db.session.add(snapshot)
        db.session.commit()
        logger.info('Captured DNS cutover snapshot %s for %s (%d record(s))',
                    snapshot.id, domain, len(records))
        return snapshot

    @classmethod
    def snapshot(cls, domain, records, provider=None, provider_zone_id=None):
        """Stage a cutover snapshot from EXPLICIT, caller-supplied records.

        Unlike :meth:`create_snapshot` (server-sourced — reads the live records
        via the provider client), this stages a snapshot from records the caller
        already holds, so it needs NO connected provider client at snapshot time:
        the provider guard fires later, at :meth:`cutover`, through
        ``_resolve_dns_client`` (so an unsupported provider still stages cleanly
        and only fails — by name — when the cutover is actually attempted). The
        provider/zone are remembered on the row so the later cutover can resolve
        them. Returns the persisted snapshot.
        """
        domain = (domain or '').strip().lower().rstrip('.')
        if not domain:
            raise DnsCutoverError('A domain is required to snapshot.')
        records = list(records or [])
        snapshot = DnsCutoverSnapshot(
            domain=domain, provider=provider,
            provider_zone_id=provider_zone_id, status='captured')
        snapshot.set_records(records)
        snapshot.set_created_records([])
        db.session.add(snapshot)
        db.session.commit()
        logger.info('Staged DNS cutover snapshot %s for %s (%d record(s))',
                    snapshot.id, domain, len(records))
        return snapshot

    @classmethod
    def list_snapshots(cls, domain=None):
        query = DnsCutoverSnapshot.query
        if domain:
            query = query.filter_by(domain=(domain or '').strip().lower().rstrip('.'))
        return query.order_by(DnsCutoverSnapshot.created_at.desc(),
                              DnsCutoverSnapshot.id.desc()).all()

    @classmethod
    def get_snapshot(cls, snapshot_id):
        return DnsCutoverSnapshot.query.get(snapshot_id)

    # ── cutover (Decision 1) ─────────────────────────────────────────────────
    @classmethod
    def _plan_ops(cls, snapshot, target, record_types):
        """Compute the exact provider ops a cutover would perform: for each
        record type, repoint ``snapshot.domain`` at ``target``. An op is a
        ``create`` when the snapshot has no matching (type, name) predecessor,
        else an ``update`` carrying the old value.
        """
        domain = snapshot.domain
        captured = snapshot.get_records()
        ops = []
        for record_type in record_types:
            record_type = (record_type or '').strip().upper()
            if not record_type:
                continue
            predecessor = next(
                (r for r in captured
                 if (r.get('type') or '').upper() == record_type
                 and (r.get('name') or '').strip().lower().rstrip('.') == domain),
                None)
            ops.append({
                'action': 'update' if predecessor else 'create',
                'type': record_type,
                'name': domain,
                'old': predecessor.get('content') if predecessor else None,
                'new': target,
            })
        return ops

    @classmethod
    def cutover(cls, snapshot, target, record_types=('A',), dry_run=False):
        """Repoint the snapshotted domain's records at ``target``.

        A cutover structurally requires a snapshot row (so a revert is always
        possible). ``dry_run`` returns the exact provider ops WITHOUT writing and
        needs no connected provider. A real cutover applies each op via the
        ownership-guarded upsert (``allow_foreign=True`` — the operator is
        deliberately taking over their own record), records the ids of records it
        CREATED for the revert, and flips the snapshot to ``cutover``.
        """
        from datetime import datetime

        from app.services.dns import DnsRecordSpec

        if snapshot is None:
            raise DnsCutoverError('A snapshot is required to cut over.')
        target = (target or '').strip()
        if not target:
            raise DnsCutoverError('A cutover target (the new address) is required.')
        record_types = list(record_types or ['A'])

        ops = cls._plan_ops(snapshot, target, record_types)
        if dry_run:
            return {'success': True, 'dry_run': True,
                    'snapshot_id': snapshot.id, 'domain': snapshot.domain,
                    'target': target, 'ops': ops}

        client, config = cls._resolve_dns_client(snapshot.provider,
                                                 snapshot.provider_zone_id)
        results = []
        created = list(snapshot.get_created_records())
        for op in ops:
            spec = DnsRecordSpec(record_type=op['type'], name=op['name'],
                                 content=target)
            res = DnsOwnershipService.guarded_upsert(
                client, provider=config.provider,
                provider_zone_id=snapshot.provider_zone_id, spec=spec,
                source='cutover', config_id=config.id, allow_foreign=True)
            ok = bool(res.get('success'))
            results.append({'type': op['type'], 'name': op['name'],
                            'action': op['action'], 'success': ok,
                            'error': res.get('error')})
            # A record with no snapshot predecessor is one the cutover CREATED;
            # remember its provider id so revert can delete it (Decision 3).
            if ok and op['action'] == 'create':
                created.append({'id': res.get('record_id'), 'type': op['type'],
                                'name': op['name'], 'content': target})

        snapshot.set_created_records(created)
        snapshot.status = 'cutover'
        snapshot.applied_at = datetime.utcnow()
        db.session.commit()

        all_ok = all(r['success'] for r in results)
        return {'success': all_ok, 'dry_run': False, 'snapshot_id': snapshot.id,
                'domain': snapshot.domain, 'target': target, 'ops': ops,
                'results': results, 'snapshot': snapshot.to_dict()}

    # ── verify (plan 31 #1) ──────────────────────────────────────────────────
    @classmethod
    def verify(cls, domain, record_type='A', expected=None, snapshot_id=None):
        """Check post-cutover resolution across public resolvers.

        Thin wrapper over the multi-resolver propagation check. When
        ``expected`` (the address the cutover pointed at) is given, annotate the
        result with whether every resolver already returns it (plan 31 #1).
        """
        from app.services.dns_zone_service import DNSZoneService

        domain = (domain or '').strip().lower().rstrip('.')
        if not domain:
            raise DnsCutoverError('A domain is required to verify.')
        record_type = (record_type or 'A').strip().upper()

        resolvers = DNSZoneService.check_propagation(domain, record_type)
        answered = [r for r in resolvers if r.get('propagated')]
        result = {
            'domain': domain,
            'record_type': record_type,
            'snapshot_id': snapshot_id,
            'resolvers': resolvers,
            'propagated': bool(resolvers) and all(r.get('propagated') for r in resolvers),
            'answered_count': len(answered),
            'resolver_count': len(resolvers),
        }
        if expected is not None:
            result['expected'] = expected
            result['matches_expected'] = bool(answered) and all(
                expected in (r.get('result') or []) for r in answered)
        return result

    # ── revert (Decision 3) ──────────────────────────────────────────────────
    @classmethod
    def revert(cls, snapshot):
        """Restore the pre-cutover WORLD, not just the captured values.

        First DELETE (in reverse creation order) the records the cutover created,
        so a create-only cutover reverts to *empty*, not to a stale target. Then
        re-apply every captured record with ``allow_foreign=True`` (the record
        now points at the new box — our own cutover write — and we deliberately
        restore the operator's original value). (plan 31 #3, Decision 3.)
        """
        from app.services.dns import DnsRecordSpec

        if snapshot is None:
            raise DnsCutoverError('A snapshot is required to revert.')

        client, config = cls._resolve_dns_client(snapshot.provider,
                                                 snapshot.provider_zone_id)

        # 1) Delete cutover-created records, newest first.
        deletions = []
        for rec in reversed(snapshot.get_created_records()):
            res = DnsOwnershipService.guarded_delete(
                client, provider_zone_id=snapshot.provider_zone_id,
                record_type=rec.get('type'), name=rec.get('name'),
                provider_record_id=rec.get('id'), provider=config.provider,
                source='cutover-revert', config_id=config.id)
            deletions.append({'type': rec.get('type'), 'name': rec.get('name'),
                              'deleted': bool(res.get('success')),
                              'error': res.get('error')})

        # 2) Re-apply every captured record, restoring the operator's values.
        restorations = []
        for rec in snapshot.get_records():
            spec = DnsRecordSpec(
                record_type=rec.get('type'), name=rec.get('name'),
                content=rec.get('content', ''), ttl=rec.get('ttl') or 3600,
                priority=rec.get('priority'), proxied=bool(rec.get('proxied')))
            res = DnsOwnershipService.guarded_upsert(
                client, provider=config.provider,
                provider_zone_id=snapshot.provider_zone_id, spec=spec,
                source='cutover-revert', config_id=config.id, allow_foreign=True)
            restorations.append({'type': rec.get('type'), 'name': rec.get('name'),
                                 'restored': bool(res.get('success')),
                                 'error': res.get('error')})

        deleted_count = sum(1 for d in deletions if d.get('deleted'))
        snapshot.status = 'reverted_with_deletions' if deletions else 'reverted'
        db.session.commit()

        restored_ok = all(r.get('restored') for r in restorations)
        return {
            'success': restored_ok,
            'snapshot_id': snapshot.id,
            'domain': snapshot.domain,
            'status': snapshot.status,
            'deletions': deletions,
            'deleted_count': deleted_count,
            'restorations': restorations,
            'snapshot': snapshot.to_dict(),
        }
