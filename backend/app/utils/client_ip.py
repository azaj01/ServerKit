"""Single seam for deriving the trusted client IP.

Every consumer that keys on the client's IP — rate-limit buckets, audit-log
source IPs, API-key attribution, the per-IP auth throttle, dynamic DNS — must
call :func:`get_client_ip` instead of hand-parsing ``X-Forwarded-For``. That
header is client-controlled: its leftmost token is whatever the caller chose,
so ``X-Forwarded-For.split(',')[0]`` trusts a forgeable value and lets an
attacker rotate the IP we rate-limit / lock out / audit on.

The trust decision lives in exactly one place: the config-gated Werkzeug
``ProxyFix`` applied in :func:`app.create_app` (see ``config.TRUST_PROXY_HEADERS``
/ ``config.TRUSTED_PROXY_HOPS``). When a proxy is trusted, ProxyFix has already
rewritten ``request.remote_addr`` to the real client (the rightmost trusted
hops of XFF); when it isn't, ``remote_addr`` is the direct socket peer. Either
way this returns the one value the app has decided to trust — never a
hand-parsed header.
"""
from flask import has_request_context, request


def get_client_ip():
    """Return the client IP the app trusts for the current request.

    Post-ProxyFix (when ``TRUST_PROXY_HEADERS`` is on) ``request.remote_addr``
    is the real client IP; otherwise it is the direct socket peer. Returns
    ``None`` when called outside a request context.
    """
    if not has_request_context():
        return None
    return request.remote_addr
