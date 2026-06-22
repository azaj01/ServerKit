"""Email provider connection for the Notification Bus.

A configured outbound transport (SMTP or a native API: SendGrid / Postmark /
Amazon SES / Mailgun) the email channel uses to actually send. Credentials are
stored Fernet-encrypted (per-field) in ``credentials_json``; the public
``to_dict`` never exposes them. Follows the Connections pattern used by DNS /
cloud / registrar providers.
"""
import json
from datetime import datetime

from app import db
from app.utils.crypto import decrypt_secret_safe


class EmailProviderConnection(db.Model):
    __tablename__ = 'email_provider_connections'

    id = db.Column(db.Integer, primary_key=True)
    provider = db.Column(db.String(40), nullable=False)   # smtp|sendgrid|postmark|ses|mailgun
    name = db.Column(db.String(120), nullable=False)

    # JSON map of credential fields; secret fields are Fernet-encrypted at rest.
    credentials_json = db.Column(db.Text)

    from_address = db.Column(db.String(255))
    from_name = db.Column(db.String(120), default='ServerKit')

    is_default = db.Column(db.Boolean, default=False, index=True)
    is_active = db.Column(db.Boolean, default=True)

    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_tested_at = db.Column(db.DateTime)
    last_test_ok = db.Column(db.Boolean)

    def raw_credentials(self):
        try:
            return json.loads(self.credentials_json) if self.credentials_json else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    def credentials(self):
        """Decrypted credentials for use at send/test time (never serialized)."""
        out = {}
        for key, value in self.raw_credentials().items():
            out[key] = decrypt_secret_safe(value) if isinstance(value, str) else value
        return out

    def to_dict(self):
        creds = self.raw_credentials()
        # Surface which non-secret fields are set / the masked tail — never secrets.
        return {
            'id': self.id,
            'provider': self.provider,
            'name': self.name,
            'from_address': self.from_address,
            'from_name': self.from_name,
            'is_default': self.is_default,
            'is_active': self.is_active,
            'configured_fields': sorted(creds.keys()),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_tested_at': self.last_tested_at.isoformat() if self.last_tested_at else None,
            'last_test_ok': self.last_test_ok,
        }

    def __repr__(self):
        return f'<EmailProviderConnection {self.id} {self.provider} default={self.is_default}>'
