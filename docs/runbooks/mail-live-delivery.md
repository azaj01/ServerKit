# Runbook — Mail live delivery (closing the serverkit-mail proving debt)

> Plan 26 Phase 6 #16. The serverkit-mail extension shipped its blocking
> preflight (PTR / port-25 egress / RBL) and all the DNS/DKIM/cert/jail rails,
> but **live outbound delivery has never been proven on a real box** — dev is
> Windows + WSL with port 25 blocked. This runbook is the verification: run it
> on a real internet-facing Linux server, paste the scrubbed transcript into the
> "Result" section, and the debt is closed.
>
> **Status: NOT YET EXECUTED.** Requires a real box with a clean IP, a real
> domain, and unblocked outbound port 25 — none of which exist in the dev
> environment. Execute on the DO test box (or any VPS whose provider permits
> SMTP) and record the result below.

## Preconditions

- A Linux server reachable on a public IP, running the panel with the
  **serverkit-mail** extension installed and its Docker engine up.
- A domain you control (call it `example.com`) with the ability to add DNS
  records (ideally a connected DNS provider so the panel can deploy them).
- The VPS provider must **not** block outbound TCP 25. Many providers block it
  by default and require a support ticket to open — do that first.
- A reverse-DNS (PTR) record for the server IP pointing at the mail hostname
  (e.g. `mail.example.com`). PTR is set at the **provider/IP-owner** level, not
  in your zone.
- An external mailbox you can read (Gmail/Fastmail/etc.) as the delivery target.

## Steps

All API calls are admin-authenticated; `$PANEL` is the panel base URL and
`$TOKEN` an admin JWT.

### 1. Run and pass preflight

```bash
curl -s -X POST "$PANEL/api/v1/mail/preflight" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"hostname":"mail.example.com"}' | jq .
```

Expected: `passed: true` with `ptr.ok`, `port25.ok`, `rbl.ok` all true. If any
critical check fails, fix it before continuing (PTR at the provider; port 25 via
a provider ticket; RBL delisting if the IP is on a blocklist). **Do not** use
`force=true` for this runbook — the point is a clean, un-forced send.

### 2. Add the domain, generate DKIM, deploy DNS

```bash
# Add the mail domain
curl -s -X POST "$PANEL/api/v1/mail/domains" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"domain":"example.com"}' | jq .        # note the returned domain id -> $DID

# Generate the DKIM keypair
curl -s -X POST "$PANEL/api/v1/mail/domains/$DID/dkim" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Fetch the DNS records to publish (MX, SPF, DKIM, DMARC)
curl -s "$PANEL/api/v1/mail/domains/$DID/dns" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Deploy them through the connected provider (or add them by hand)
curl -s -X POST "$PANEL/api/v1/mail/domains/$DID/dns/deploy" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Wait for propagation, then confirm:

```bash
dig +short MX example.com
dig +short TXT example.com                     # SPF
dig +short TXT default._domainkey.example.com  # DKIM
dig +short TXT _dmarc.example.com              # DMARC
```

### 3. Activate the domain (the preflight gate)

```bash
curl -s -X PATCH "$PANEL/api/v1/mail/domains/$DID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"is_active":true}' | jq .
```

Expected: `200` with the domain now active. If preflight had NOT passed this
returns **409** ("blocked by preflight; re-run … or activate with force") —
that gate is the whole point of the preflight; it working is itself a check.

### 4. Create a mailbox and send a real message

```bash
curl -s -X POST "$PANEL/api/v1/mail/domains/$DID/mailboxes" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"local_part":"postmaster","password":"<strong-password>"}' | jq .
```

Send an authenticated message from that mailbox to your external address using
`swaks` (submission on 587 with STARTTLS):

```bash
swaks --server mail.example.com:587 --tls \
  --auth LOGIN --auth-user postmaster@example.com --auth-password '<strong-password>' \
  --from postmaster@example.com --to you@gmail.com \
  --h-Subject 'ServerKit live-delivery proof' \
  --body 'If you can read this with a passing DKIM/SPF/DMARC, the debt is closed.'
```

### 5. Verify the received message

In the target mailbox, open the message and inspect the **raw headers**. Confirm:

- `Authentication-Results:` shows `spf=pass`, `dkim=pass`, `dmarc=pass`.
- `Received:` chain shows the message came from `mail.example.com` at your IP.
- The message landed in the **inbox**, not spam.

Optionally cross-check with a scoring service (e.g. mail-tester) for a 10/10.

## Result (paste scrubbed transcript here)

> Fill this in after executing. Scrub the real domain, IP, and any passwords.
> Include: the preflight JSON (`passed: true`), the `swaks` send transcript
> (250 accepted), and the received message's `Authentication-Results` header
> line. Once this section is filled with a real pass, mark plan 26 #16 ✅ and
> update the [Fleet Contract](../FLEET_CONTRACT.md) mail row.

```
(pending real-box execution)
```
