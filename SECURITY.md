# Security Policy

## Supported Versions

ServerKit is under active development. Security fixes are applied to the latest
release line and the `main` branch.

| Version | Supported |
|---------|-----------|
| 1.6.x   | ✅ |
| < 1.6   | ❌ (please upgrade) |

The **agent** is versioned independently (`agent-vX.Y.Z`); always run a recent
agent build, as several Windows service and credential-handling fixes landed in
the 1.6.x line.

## Reporting a Vulnerability

Please report security issues **privately** — do not open a public issue for
anything exploitable.

- Preferred: [open a GitHub Security Advisory](https://github.com/jhd3197/ServerKit/security/advisories/new)
- We aim to acknowledge reports within a few days and to provide a remediation
  timeline after triage.

Please include affected version(s), reproduction steps, and impact. Coordinated
disclosure is appreciated — give us a reasonable window to ship a fix before any
public write-up.

## Agent Trust Model

The multi-server agent is powerful by design — operators should understand its
trust boundaries:

- **`agent.key` is a host-equivalent secret.** Agent API credentials are stored
  AES-256-GCM encrypted under a key derived from host-stable identifiers
  (hostname + machine ID on Linux, hostname + computer name on Windows). Because
  that key is derived only from values available on the host itself, the
  encryption is at-rest tamper-resistance / off-host-exfil protection (e.g. a
  leaked backup) — **not** confidentiality against a local root/SYSTEM user, who
  can re-derive the key. Anyone who can read this file on the host can recover
  the credentials. The `0600` file permissions are the real access control;
  protect it like a root/SYSTEM secret.
- **Remote command execution is gated.** Arbitrary command execution
  (`system:exec`) and interactive PTY sessions are controlled by the agent's
  `Features.Exec` flag, which is **off by default**. Enable it only on servers
  where you intend the panel to run shell commands.
- **Transport & connection controls.** Agents authenticate to the panel with
  per-connection HMAC-SHA256 (with nonce/replay protection and a timestamp-skew
  check), and the panel enforces a per-server IP allowlist. Use `wss://`
  (TLS-terminated) in production.
- **`SERVERKIT_INSECURE_TLS=true` disables certificate verification** for all
  agent connections. It is intended for local development/testing only — never
  set it in production.

For a detailed internal audit of the panel, see
[SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Client-IP Trust & Login Brute-Force

The panel keys several security decisions — rate-limit buckets, login lockout,
audit-log source IPs, API-key attribution, dynamic DNS — on the client's IP.
Behind a reverse proxy the raw socket peer is the proxy, and the real client
arrives in `X-Forwarded-For`. That header is **client-controlled**, so ServerKit
never hand-parses it. Instead it derives the client IP through one trusted seam
(Werkzeug `ProxyFix`, `app/utils/client_ip.py::get_client_ip`) gated by config:

| Variable | Default | Meaning |
|----------|---------|---------|
| `TRUST_PROXY_HEADERS` | `false` | Trust forwarding headers to derive the client IP. **Set `true` only where a reverse proxy is guaranteed in front** (the shipped nginx deploy sets it). Leave `false` for a directly-exposed server so headers can't be forged. |
| `TRUSTED_PROXY_HOPS` | `1` | Number of trusted proxy hops in front of Flask (bundled nginx = 1). Raise it only if you add another proxy (e.g. Cloudflare on top). |

With trust on, `ProxyFix` takes the **rightmost** `TRUSTED_PROXY_HOPS` entries of
`X-Forwarded-For` — the hops your own proxies appended — so a forged *leftmost*
value is discarded. Setting a hop count higher than the real number of proxies,
or turning trust on for a directly-exposed panel, re-introduces spoofing — don't.

> **Behavior change:** audit-log source IPs now record the real client IP
> instead of the proxy's address. Update any dashboards or alerts that were built
> on the old (proxy-IP-or-forged) values.

On top of the per-user account lockout, a **per-IP login throttle** blocks a
client IP after repeated failed logins (also covering login-link redeem and 2FA
verification), returning `429` with `Retry-After`. This stops password-spraying
across many usernames from one source and prevents a single attacker draining
the shared login rate-limit for everyone. It is in-memory and relies on the
single-worker deployment (see the Deployment Note below).

| Variable | Default | Meaning |
|----------|---------|---------|
| `AUTH_IP_MAX_ATTEMPTS` | `10` | Failed auths from one IP within the window before it is blocked. |
| `AUTH_IP_WINDOW_MINUTES` | `15` | Rolling window for counting failures. |
| `AUTH_IP_BLOCK_MINUTES` | `15` | How long a blocked IP stays blocked. |

## Deployment Note

The agent gateway keeps all connected-agent state in-memory in a single process.
Run the panel with a **single** gunicorn worker process (threaded worker,
`-w 1 --threads N` — not the gevent-websocket worker class); multi-worker
deployments can misroute agent commands. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
