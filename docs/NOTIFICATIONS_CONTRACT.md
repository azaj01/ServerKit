# The ServerKit notification delivery contract

*One page every producer and plugin author reads before calling
`notify.send()`. It defines who hears about an event, on which channel, and
when. The code cites this file as the source of truth — when the code and this
document disagree, it's a bug in one of them, so fix both together.*

> This document is **tracked** (committed). Planning and status notes live in the
> git-ignored `docs/NOTIFICATIONS_ROADMAP.md`; the resolution/digest rules that
> the bus actually enforces live here.

---

## Preference resolution order

For a given `(user, event, channel)`, the bus (`app/notifications/service.py`,
`_plan()` → `_resolve_channels()`) resolves "does this channel fire?" as a
two-stage decision.

### Stage A — does the event reach this user at all?

Evaluated top-down; the first rule that applies wins:

1. **Account-wide kill switch** — `NotificationPreferences.enabled == False`
   stops **everything**, including `critical` and a per-event override. Nothing
   below runs.
2. **Per-event force-ON override** — if `events_json[event_key]` turns **any**
   channel ON, the event is **resurrected**: it reaches the user even when the
   category opt-out or severity list below would exclude it. A per-event
   override is the most specific preference a user can express, so it wins over
   the coarser category/severity gates (plan 33 Decision 1). A pure force-**OFF**
   map (all channels `false`) is *not* a resurrect — it only trims channels the
   normal path would have fired.
3. **Category opt-out** — `categories[event.category] == False` stops the event,
   *including a critical* (only a force-ON override at rule 2, or the event not
   being opted out, lets it through).
4. **Severity gate** — the event's severity must be in `severities`. `critical`
   always passes this gate.

If Stage A lets the event through, Stage B decides the channel set.

### Stage B — which channels fire?

Per channel, first match wins (`_resolve_channels()`):

1. **User per-event override** — `events_json[event_key][channel]` (`true` /
   `false`). Explicit on/off for this event + channel.
2. **User channel selection** — `channels` (the in-app bell is always on for an
   enabled user, independent of this list).
3. **Org default floor** — `notify.defaults[category][channel]` (admin-set): a
   per-category channel floor, e.g. "backups → email off for everyone".
4. **Catalog default** — on if the channel is user-selected.

**Hard invariant:** `severity == 'critical'` reaches an enabled, non-category-
opted-out user on **every** configured channel — it pierces the severity gate,
quiet hours, the org floor, and a per-event force-**OFF**. Only the account-wide
`enabled=False` (Stage A rule 1) or a category opt-out (Stage A rule 3) stops a
critical.

---

## Quiet hours

Quiet hours **delay** non-critical notifications; they never delete them
(plan 33 Decision 3).

- **Email** — a non-critical email suppressed by quiet hours is written
  `queued_digest` and flushed by the hourly digest job once the user is past
  their quiet window (its catch-up; see below).
- **Chat** (Discord / Slack / Telegram / webhook) — a non-critical chat delivery
  suppressed by quiet hours is written `queued_digest` too, then flushed as **one
  compact per-connection summary** when the window ends. No per-item replay spam:
  one summary per destination per quiet window.
- **In-app** — always recorded immediately (the bell is silent), so there's a
  catch-up record when the user returns.
- **Critical** — pierces quiet hours on every channel, immediately.

---

## Digest severity rules

Digesting batches low-value events into one branded email instead of N sends.
Per severity, the **default** routing is:

| Severity | In-app | Email |
|---|---|---|
| `info` / `success` | immediate | **digested** |
| `warning` | immediate | **digested** |
| `critical` | immediate | immediate (never digested) |

- Users pick a **digest cadence** (`daily` \| `weekly` \| `off`) in their prefs.
  `off` (default) = the pre-digest behavior (email sends immediately).
- A digestable email delivery is written `queued_digest`; the consumer skips it;
  the hourly `notifications.digest.run` job groups a user's `queued_digest` rows,
  renders one `digest.html` grouped by category, sends it, and marks the rows
  `sent` with the digest's provider message-id.
- **UX guards:** an empty digest never sends; a single-item digest uses that
  item's own subject line (no "1 update" shame mail).

---

## Deep links

Every notification carries an optional `action_path` (+ `action_label`),
computed **at send time** (catalog link builder or a producer override) and
persisted on the `Notification` row so a later route change never breaks old
rows. Bell, history, and the email CTA all consume the same field.

Deep links follow a **fragment contract** (plan 33 Decision 2): a link is a bare
page path plus an optional `?focus=<kind>:<id>` query param
(e.g. `/backups?focus=policy:12`, `/domains?focus=domain:example.com`,
`/cron?focus=job:job_2026...`). The destination page reads `focus` once on mount
and opens its existing drawer / panel / modal, then clears the param so a refresh
doesn't re-trigger.

---

## Per-user vs org chat targeting

Both apply and are **additive**, deduped per destination (plan 33 Decision 5):

- **Per-user chat** — `_target_for` resolves a user's personal Discord webhook /
  Telegram chat id from their prefs; delivered per recipient.
- **Org broadcast** — every active `ChatWebhookConnection` whose category filter
  matches receives the event once (`conn:<id>` target), independent of the
  per-user recipients.

A `(user_id, channel, target)` / `(None, kind, conn:<id>)` de-dupe key prevents a
re-plan from double-sending to the same destination.

---

## Bounce / complaint handling

Provider bounce/complaint webhooks post to
`POST /api/v1/notifications/inbound/email` (HMAC-signed; 404 when unconfigured).
A hard bounce or complaint is recorded against the delivery's stored
provider message-id; after **N consecutive hard bounces** an address is
auto-muted (with an unmute affordance in the user's notification settings) and
admins are notified (plan 33 Decision 4 / roadmap #24).

### Pointing a provider's bounce webhook at ServerKit

1. **Set the shared secret.** Store a random secret under the SettingsService
   key `notify.inbound_secret` (until it's set, the endpoint 404s — the feature
   is off by default). Any panel process reading the same DB sees it.
2. **Configure the provider webhook** to `POST` bounce/complaint events to
   `https://<your-panel>/api/v1/notifications/inbound/email`, signing the **raw
   request body** with HMAC-SHA256 using the secret and sending the hex digest
   in an `X-ServerKit-Signature: sha256=<hex>` header. (If your provider signs
   with its own scheme, put a tiny signing proxy in front, or extend the one
   adapter seam.)
3. **Payload shapes** are mapped provider-agnostically — SendGrid event arrays,
   Postmark, Amazon SES (raw or SNS-wrapped), Mailgun, and a generic
   `{message_id, kind, reason, email}` all work. Soft/transient failures are
   ignored; only hard bounces and spam complaints count toward the mute.
4. **Correlation** is by the provider message-id captured at send time; when a
   payload also carries the recipient address, that's used as a fallback.

---

## Throttling

Throttling stays **code-side at the producer** (edge-triggered / first-failure +
recovery, per the doctor/health precedents). The bus adds no generic cooldown
engine.
