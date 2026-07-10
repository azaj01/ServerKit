from datetime import datetime

from app import db


class CfOpsChange(db.Model):
    """Audit trail of every Cloudflare *operations* write ServerKit makes to a zone
    (settings, DNSSEC, WAF, redirect/transform rules, Origin CA, Workers, Tunnels,
    R2/KV/D1) — the ops-layer sibling of :class:`DnsChange`, which only covers DNS
    *record* writes.

    Powers the per-zone Activity tab so an operator can see exactly what the panel
    changed on a Cloudflare zone (and what failed) without leaving ServerKit.
    Written best-effort at the extension's service layer via
    :meth:`CfOpsChangeService.record`, which never raises — an audit write must not
    break the operation it describes. Keyed by ``provider_zone_id`` for per-zone
    filtering.
    """
    __tablename__ = 'cf_ops_changes'

    id = db.Column(db.Integer, primary_key=True)
    dns_provider_config_id = db.Column(
        db.Integer, db.ForeignKey('dns_provider_configs.id'), nullable=True, index=True)
    provider_zone_id = db.Column(db.String(128), index=True)
    product = db.Column(db.String(32), nullable=False)
    action = db.Column(db.String(32), nullable=False)
    target = db.Column(db.String(256))
    result = db.Column(db.String(16), nullable=False, default='ok')
    error = db.Column(db.Text)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    def to_dict(self):
        return {
            'id': self.id,
            'dns_provider_config_id': self.dns_provider_config_id,
            'provider_zone_id': self.provider_zone_id,
            'product': self.product,
            'action': self.action,
            'target': self.target,
            'result': self.result,
            'error': self.error,
            'user_id': self.user_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
