# Cloudflare API token scopes for zone operations

ServerKit connects Cloudflare as a DNS provider with a scoped API token (or a
global key). DNS records and Dynamic DNS need only **DNS: Edit**. The per-zone
**Cloudflare control panel** (reached from a Cloudflare-managed domain) reaches
further into your zone, and each tab needs its own token permission.

Grant only what you plan to use. The zone page runs a live scope check and flags
any tab your token can't reach, so you can start minimal and widen later.

## Scope matrix

| Feature (tab)            | Cloudflare API token permission                                   |
|-------------------------|-------------------------------------------------------------------|
| DNS records, Dynamic DNS | Zone → DNS: Edit                                                 |
| Settings                | Zone → Zone Settings: Edit                                        |
| Cache purge             | Zone → Cache Purge: Purge                                         |
| DNSSEC                  | Zone → DNS: Edit                                                  |
| WAF / Redirects / Transforms | Zone → Zone WAF: Edit *(or Account → Account Rulesets: Edit)* |
| Origin CA               | Zone → SSL and Certificates: Edit *(see note below)*             |
| Workers                | Account → Workers Scripts: Edit                                   |
| Tunnels                | Account → Cloudflare Tunnel: Edit                                 |
| Storage — R2           | Account → Workers R2 Storage: Edit                               |
| Storage — KV           | Account → Workers KV Storage: Edit                              |
| Storage — D1           | Account → D1: Edit                                                |

Account-scoped features (Workers, Tunnels, Storage) also need **Zone → Zone:
Read** so ServerKit can resolve the account that owns the zone.

## Origin CA note

Issuing origin certificates uses the Cloudflare **Origin CA** API. Most accounts
accept a token with **SSL and Certificates: Edit**. Some accounts require the
separate **Origin CA key** (a per-account key from *My Profile → API Tokens →
Origin CA Registration*). If issuing fails with a permission error, add the Origin
CA key to the connection and retry — ServerKit stores it encrypted at rest.

Origin certificates are trusted **only between Cloudflare's edge and your origin**.
Keep the covered hostname proxied (orange cloud) and set the SSL/TLS mode to
**Full (strict)** for end-to-end encryption. A browser reaching your origin
directly will reject an origin certificate.

## Creating a scoped token

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token**.
2. Start from **Create Custom Token**.
3. Add the permissions for the features you want (from the matrix above).
4. Scope **Zone Resources** to the specific zones ServerKit should manage.
5. Create the token, copy it, and paste it into ServerKit's Cloudflare connection.

To widen scope later, edit the token in Cloudflare and reconnect — no ServerKit
change is needed beyond re-entering the token.
