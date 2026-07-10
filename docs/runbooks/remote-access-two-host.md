# Runbook — Remote access, two hosts (closing the remote-access proving debt)

> Plan 26 Phase 6 #17. The remote-access feature (WireGuard tunnels via agent
> pairing — `/remote-access`, `TunnelBrokerService`, `TunnelPublishService`)
> shipped and is unit + panel↔agent e2e tested, but **the full two-host flow
> has never been proven end-to-end on real infrastructure**: pair an edge box to
> a NAT'd home box and publish a home-only service to the public internet
> through the tunnel. This runbook is that verification.
>
> **Status: NOT YET EXECUTED.** Requires two real machines — a public-IP edge
> VPS and a NAT'd home host running a service (e.g. Jellyfin) — with agents
> paired to the same panel. Dev is a single Windows box; execute on real infra
> and paste the scrubbed transcript into "Result".

## Topology

```
        internet ──▶ edge VPS (public IP, agent "edge")
                        │  WireGuard tunnel
                        ▼
                     home host (behind NAT, agent "home")
                        │
                        ▼
                     Jellyfin :8096  (home-only service)
```

The edge box terminates public traffic and forwards it over the WireGuard
tunnel to the home box's service. Keys stay on the hosts; the panel is
authoritative for config only (see `docs/REMOTE_ACCESS_ROADMAP.md`).

## Preconditions

- **Edge**: a VPS with a public IP, the agent installed and paired (server id
  `$EDGE`), capable of running WireGuard (the agent embeds wireguard-go) and
  opening its listen port in the firewall.
- **Home**: a machine behind NAT running Jellyfin (or any HTTP service) on
  `:8096`, agent installed and paired (server id `$HOME`).
- Both agents **online** in the panel (Servers page shows both green).
- A domain/subdomain for the public URL (e.g. `media.example.com`) — ideally via
  a connected DNS provider so the panel can create the record and cert.
- `$PANEL` = panel base URL, `$TOKEN` = an admin/developer JWT.

## Steps

### 1. Confirm both agents are connected

```bash
curl -s "$PANEL/api/v1/servers/available" -H "Authorization: Bearer $TOKEN" \
  | jq '.servers[] | {id, name, status}'
```

Both the edge and home servers must be `online`. Note their ids as `$EDGE`
(public) and `$HOME` (NAT'd).

### 2. Pair the two boxes into a WireGuard tunnel

```bash
curl -s -X POST "$PANEL/api/v1/tunnels/" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"edge_server_id\":\"$EDGE\",\"private_server_id\":\"$HOME\",\"name\":\"home-media\"}" \
  | jq .
```

Expected: `201` with a tunnel object (note its `id` → `$TID`) and a `firewall`
hint. If `firewall.auto_open` is present it shows whether the agent opened the
edge listen port automatically; otherwise open it by hand per the hint.

### 3. Confirm the tunnel is up (handshake on both peers)

```bash
curl -s "$PANEL/api/v1/tunnels/$TID" -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: live status shows both peers with a recent WireGuard **handshake** and
a non-zero transfer once traffic flows. A missing handshake means the edge
listen port isn't reachable (firewall) or a key/config mismatch — fix before
publishing.

### 4. Publish the home service through the tunnel

```bash
curl -s -X POST "$PANEL/api/v1/tunnels/$TID/services" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"jellyfin","upstream_host":"127.0.0.1","upstream_port":8096,"public_hostname":"media.example.com"}' \
  | jq .
```

This wires the edge nginx to reverse-proxy `media.example.com` over the tunnel to
the home box's `127.0.0.1:8096`, and (with a DNS provider) creates the A record +
best-effort cert. Confirm the DNS record and, if issued, HTTPS.

### 5. Verify end-to-end from the public internet

From a machine **outside** both networks (e.g. a phone on cellular):

```bash
curl -sI https://media.example.com/System/Info/Public
# or open https://media.example.com in a browser and confirm Jellyfin loads
```

Expected: the home-only Jellyfin responds through the edge over the tunnel. To
prove the traffic really traverses the tunnel and not some other path, stop the
tunnel (`DELETE /api/v1/tunnels/$TID`) and confirm the public URL goes dead, then
re-create it and confirm it recovers.

### 6. Tear down (leave infra clean)

```bash
curl -s -X DELETE "$PANEL/api/v1/tunnels/$TID" -H "Authorization: Bearer $TOKEN" | jq .
```

## Result (paste scrubbed transcript here)

> Fill this in after executing. Scrub real hostnames/IPs/keys. Include: both
> agents online, the `201` tunnel create response, the live status showing a
> WireGuard handshake on both peers, the publish response, and a public `curl`
> to `media.example.com` returning the home service (plus the stop→dead,
> restart→recovers proof). Once filled with a real pass, mark plan 26 #17 ✅ and
> update the [Fleet Contract](../FLEET_CONTRACT.md) remote-access row.

```
(pending two-host execution)
```
