# Workspace Scoping — the one visibility & permission contract

> Status: LIVE (plan 19). This is the single source of truth for "who can see and
> do what to a resource that belongs to an app in a workspace." Plans 21/22/24/26
> cite this document instead of re-deciding scoping per surface.

ServerKit's tenancy chain is `Workspace → Project → Environment → Application`.
Most resources (domains, env vars, volumes, deployments, managed DBs, WordPress
sites, backups…) hang off an `application_id`. Workspaces landed after most
features, so this contract retrofits ONE model over all of them.

## 1. The three ideas

1. **Derived scope, never duplicated.** A resource does not store its own
   workspace. It references an `application_id` (or is app-derived) and the
   workspace/project resolve *through* the app at read time. The only rows that
   carry `workspace_id` directly are `Application`, `Server`, and the born-in-a-
   workspace resources (vaults, webhook gateways).

2. **Visibility = union(owned, granted, workspace-member).** A user sees a
   resource if they own its app, have a `ResourceGrant` on its app, **or** are a
   member of the app's workspace (any role). Membership grants **READ**.

3. **Visibility ≠ permission.** Seeing a resource does not mean you can change
   it. Mutation is gated by capability tier *and* by whether the action can reach
   the host (see the write matrix below).

## 2. Visibility (READ)

Use one of two seams — never hand-roll a filter:

- **A model that carries `workspace_id`** (i.e. `Application`): scope its list
  with `WorkspaceService.scope_query(..., membership=True)`. This unions
  `owner ∪ granted ∪ apps-in-my-workspaces`, then narrows to the active
  workspace context if one is supplied.

- **An app-derived model** (`domain.application_id`, `managed_database.
  owner_application_id`, …): resolve the visible app-id set once with
  `WorkspaceService.visible_application_ids(user, workspace_id)` and filter
  `Model.<app_fk>.in_(ids)`. The helper returns `None` for a panel admin, the
  sentinel for "no restriction":

  ```python
  ids = WorkspaceService.visible_application_ids(user, ws_id)
  q = Model.query if ids is None else Model.query.filter(Model.application_id.in_(ids))
  ```

`visible_application_ids` runs a small fixed number of queries per request, so
downstream lists apply a single `IN`-clause — no N+1.

For a **single** resource, gate the route with `require_app_member(min_role)`
(below) rather than re-deriving visibility.

## 3. The app-scoped gate

`app_access_tier(user, application)` folds every path to an app into ONE
capability tier, highest wins:

| Path to the app                     | Tier      |
|-------------------------------------|-----------|
| panel admin, or the app's owner     | `owner`   |
| `ResourceGrant` role `editor`       | `member`  |
| `ResourceGrant` role `viewer`       | `viewer`  |
| member of the app's workspace       | that workspace role (`owner`/`admin`/`member`/`viewer`) |
| none of the above                   | `None` (no access) |

Tier order: `viewer < member < admin < owner`.

`require_app_member(min_role='viewer', arg='app_id')` is the decorator: it
resolves the app from the named view kwarg, **404s** a missing app (no info
leak), **403s** an insufficient tier, and stashes the app on
`g.current_application`. Read routes use `min_role='viewer'`; member-writes
`'member'`; app-scoped destructive `'admin'`.

## 4. The write matrix (by capability class, NOT per endpoint)

| Capability class | Examples | Gate |
|---|---|---|
| **App-scoped, no host reach** | env vars, restart/redeploy own app, backup-policy schedule for own app | workspace **member+** (`require_app_member('member')` / `can_edit_app`) |
| **App-scoped destructive** | delete app, delete domain, drop managed DB | workspace **admin/owner** (`require_app_member('admin')`) |
| **Host-touching or global** | nginx/system config, system DB engines, Docker system ops, SSL issuance, FTP, firewall, fleet | **panel admin only** — a workspace role NEVER unlocks these (`@admin_required`) |

A workspace role can never inflate into a host-touching power. When a member
needs a host-adjacent effect, it goes through a **member action template**
(Phase 5) — a curated, parameterized, audit-logged action — never through role
inflation or free-text shell input.

## 5. The System bucket

Resources with **no** app association are "System": global DNS zones, the SSL
store, FTP accounts, email domains, host Docker objects, unassociated cron. They
are admin-only surfaces, labeled "System" in the UI, and are **never** mixed into
a member's workspace views. Do not give a System surface a membership filter —
gate it `@admin_required`.

## 6. Onboarding a new surface — the checklist

1. **Association.** Does the resource reference an `application_id` (or a model
   that does)? If not, it is **System** → `@admin_required`, stop here.
2. **List read.** App-derived list → filter on `visible_application_ids`. A model
   with its own `workspace_id` → `scope_query(..., membership=True)`.
3. **Single read.** Gate with `require_app_member('viewer')`.
4. **Writes.** Classify each mutation into the write matrix and gate it:
   member-write → `require_app_member('member')` / `can_edit_app`; destructive →
   `require_app_member('admin')`; host-touching → `@admin_required`.
5. **Bucket header.** Put a one-line comment at the top of the route file
   stating its bucket (`# Bucket: app-scoped` / `# Bucket: System (admin-only)`)
   so the grep audit (Phase 4 #16) can verify it.
6. **Matrix test.** Add the surface's declaration on top of the shared
   `scoping_rbac` fixture (`tests/conftest.py`) — see
   `tests/test_workspace_scoping_matrix.py` for the reference apps+domains pair.

## 7. Locked decisions (see plan 19)

- `scope_query` is canonical and grew exactly one mode (`membership`).
- The two gates live in `middleware/rbac.py` (`require_app_member`,
  `require_workspace_role`); the `secrets_webhooks.py` duplicate is gone.
- `ResourceGrant.role` widens visibility only; a per-resource role matrix is out
  of scope (`editor` folds to `member`, `viewer` to `viewer`).
- Project/environment are display groupings; visibility is decided at workspace
  level.
- Workspace admins get no host-adjacent powers — ever.

## 8. Member action templates (Phase 5)

A member's only write escape hatch beyond the matrix is a **member action
template**: a curated, parameterized action a member may trigger for their own
app. No free text ever reaches a shell. Each template declares
`(id, label, param schema, executor, min_role)`, is audit-logged, and is
feature-flagged. See `app/services/member_action_service.py`.

**Enabling / disabling the surface (plan 29 #13).** Member actions are **ON by
default** — the shipped templates are deliberately narrow (typed enums / bounded
ints, no free text, vetted service calls only). The surface has two independent
kill switches, and *both* must allow it:

- the `MEMBER_ACTIONS_ENABLED` app config (deployment-level), and
- the admin-visible **`security_member_actions_enabled`** system setting, exposed
  as the *Member Actions* card in **Settings → System** security section.

Turning either off disables the whole surface (the catalog goes empty and runs
return 403). The default is unchanged; the plan-29 change only made the flag
*visible* so an operator isn't relying on something silently on.
