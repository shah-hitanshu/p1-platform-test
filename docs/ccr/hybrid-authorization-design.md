# Hybrid Authorization Design

> **Last Updated:** February 2026
> **System:** Collaborative Content Repository (CCR)

This document describes the CCR authorization model, which resolves a user's effective role from multiple sources: MAS (Membership Authorization Service), local grants, and branch-level grants.

---

## Architecture Overview

CCR uses a **dual-source authorization model** that combines Pantheon's centralized membership system (MAS) with locally-managed grants. This hybrid approach allows:

- **Pantheon users** to inherit their site roles from the Pantheon platform via MAS.
- **External collaborators** (e.g., Google-authenticated users) to receive access via local grants without requiring a Pantheon account.
- **Branch-level elevation** to temporarily promote a user's role on a specific branch (e.g., granting an EDITOR temporary ADMIN access on a feature branch).

```
                    ┌─────────────────────────────────┐
                    │         Effective Role           │
                    │                                  │
                    │  max(siteRole, branchGrant)       │
                    └──────────┬──────────────────────┘
                               │
               ┌───────────────┼───────────────┐
               │                               │
    ┌──────────▼──────────┐         ┌──────────▼──────────┐
    │     Site Role        │         │   Branch Grant       │
    │                      │         │                      │
    │  max(MAS, local)     │         │  branch_grants table │
    └──────────┬───────────┘         └─────────────────────┘
               │
       ┌───────┼───────┐
       │               │
┌──────▼──────┐ ┌──────▼──────┐
│  MAS Role    │ │ Local Grant │
│              │ │             │
│ (Pantheon    │ │ (user_site_ │
│  users only) │ │  roles)     │
└─────────────┘ └─────────────┘
```

---

## Role Resolution Formula

The effective role for a user on a specific branch is calculated as:

```
effectiveRole = max(siteRole, branchGrant)
```

Where `siteRole` is itself:

```
siteRole = max(masRole, localGrant)
```

So the full formula is:

```
effectiveRole = max(max(masRole, localGrant), branchGrant)
```

Grants can **only elevate** access, never restrict it. If a user has ADMIN from MAS and EDITOR from a local grant, their effective site role is ADMIN.

### Role Hierarchy

Roles are ordered from lowest to highest privilege:

| Level | Role | Key Permissions |
|-------|------|-----------------|
| 0 | `NO_ACCESS` | None |
| 1 | `VIEWER` | `canView` |
| 2 | `EDITOR` | `canView`, `canEdit`, `canCreateBranch`, `canEditDocuments`, `canCreateCheckpoint`, `canProposeMerge`, `canMerge` |
| 3 | `ADMIN` | All of EDITOR + `canMergeToMain`, `canManageGrants` |

The `max()` operation selects the role with the higher privilege level.

---

## When Each Source Is Used

### MAS Roles

MAS roles apply to **Pantheon users** identified by `authProvider === 'auth0'`. These are users who authenticated through Pantheon's Auth0 tenant.

- CCR queries MAS to look up the user's site membership and role.
- MAS returns Pantheon roles (`admin`, `owner`, `developer`, `team_member`, `unprivileged`) which are mapped to CCR roles.
- If MAS is unavailable, CCR falls back to cached roles or JWT-embedded roles.

### Local Grants

Local grants can be assigned to **any authenticated user** regardless of auth provider. They are stored directly in the CCR database (`user_site_roles` table).

- Used for Google-authenticated external collaborators who have no Pantheon account.
- Can also supplement MAS roles for Pantheon users (e.g., granting elevated access on a specific CCR site).
- Managed via the Collaborator API.

### Branch Grants

Branch grants provide **temporary role elevation** on a specific branch. They are stored in the `branch_grants` table.

- Apply to any authenticated user or agent on a specific branch.
- Managed via the Grants API (`/api/sites/{siteId}/branches/{branchId}/grants`).
- Common use case: granting an EDITOR temporary ADMIN access on a branch for merge operations.

---

## MAS Integration Details

### Service Account Setup

CCR authenticates to MAS using a GCP service account. The service account must be registered as an invoker in the MAS Terraform configuration.

**1. Register in `invokers.tf`:**

Submit a PR to [membership-authorization-service/invokers.tf](https://github.com/pantheon-systems/membership-authorization-service/blob/master/devops/terraform/gcp/invokers.tf):

```hcl
prod_api_invokers = [
  # ... existing entries
  "serviceAccount:css-worker@your-gcp-project.iam.gserviceaccount.com",
]

sbx_api_invokers = [
  # ... existing entries
  "serviceAccount:css-worker@your-gcp-sandbox.iam.gserviceaccount.com",
]
```

For admin-level access (reading any user's roles without user context), also add the service account to the bypass list.

**2. GCP IAM Authentication:**

The CCR worker authenticates to the MAS load balancer using a GCP identity token:

```typescript
// Generate identity token for MAS
const identityToken = await getGcpIdentityToken({
  audience: 'membership-authorization-api',
  serviceAccountKey: env.MAS_GCP_SERVICE_ACCOUNT_KEY,
});
```

### MAS API Endpoints

CCR uses the following MAS endpoint:

#### Get User's Site Role

```
GET /site/{site-id}/memberships/user
Authorization: Bearer <gcp-identity-token>
```

Query parameters:

| Parameter | Description |
|-----------|-------------|
| `inherited` | Include inherited memberships from parent workspaces |
| `role` | Filter by specific role |

Response:

```json
{
  "data": [
    {
      "user_id": "auth0|abc123",
      "role": "admin",
      "inherited": false
    }
  ],
  "page_info": {
    "has_next_page": false
  }
}
```

### Available MAS Roles

| MAS Role | Description |
|----------|-------------|
| `admin` | Full site admin |
| `owner` | Site owner (treated same as admin) |
| `developer` | Developer access |
| `team_member` | Team member access |
| `unprivileged` | No meaningful access |

---

## Cache-Through Pattern

CCR implements a cache-through pattern for MAS role lookups to avoid querying MAS on every request.

### How It Works

```
┌──────────┐     ┌───────────────┐     ┌──────────┐
│  Request  │────>│  CCR Cache    │────>│   MAS    │
│           │     │  (5-min TTL)  │     │   API    │
└──────────┘     └───────────────┘     └──────────┘
                        │
                  Cache hit? ──Yes──> Return cached role
                        │
                       No
                        │
                  Query MAS ──Success──> Cache result, return
                        │
                      Failure
                        │
                  Stale cache? ──Yes──> Return stale (log warning)
                        │
                       No
                        │
                  JWT fallback ──> Use JWT-embedded roles
```

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAS_CACHE_TTL_SECONDS` | `300` (5 min) | How long cached MAS roles remain fresh |

### Lazy Sync

- Roles are fetched from MAS **on demand** when a user makes their first request to a site.
- Cached roles are stored in the `user_site_roles` table with a `source='mas'` marker.
- On subsequent requests within the TTL window, the cached value is used.
- After TTL expiry, the next request triggers a background refresh.

### Graceful Degradation

When MAS is unavailable:

1. **Stale cache available:** Use the last-known MAS role (log a warning).
2. **No cache:** Fall back to JWT-embedded roles from the `pantheonSiteRoles` field on the `AuthenticatedPrincipal`.
3. **No JWT roles:** User gets `NO_ACCESS` for MAS-sourced authorization; local grants still apply independently.

---

## Collaborator API Endpoints

The collaborator API manages local grants (site-level role assignments).

### Grant Site Access

```
POST /api/sites/{siteId}/collaborators
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "role": "developer",
  "email": "collaborator@example.com"
}
```

- Requires `canManageGrants` permission (ADMIN role).
- Creates a `user_site_roles` record with `source='local'`.
- The `userId` is the CCR UUID (the UUIDv5-mapped ID for OAuth users).

**Response (201 Created):**

```json
{
  "id": "grant-uuid",
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "siteId": "site-uuid",
  "role": "developer",
  "source": "local",
  "createdAt": "2026-02-19T12:00:00.000Z"
}
```

### List Collaborators

```
GET /api/sites/{siteId}/collaborators
Authorization: Bearer <token>
```

Returns all users with access to the site, from both MAS and local sources:

**Response (200 OK):**

```json
{
  "collaborators": [
    {
      "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "email": "user@pantheon.io",
      "role": "admin",
      "source": "mas",
      "effectiveRole": "ADMIN",
      "lastSyncedAt": "2026-02-19T11:55:00.000Z"
    },
    {
      "userId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "email": "external@example.com",
      "role": "developer",
      "source": "local",
      "effectiveRole": "EDITOR",
      "createdAt": "2026-02-18T09:00:00.000Z"
    },
    {
      "userId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "email": "both@pantheon.io",
      "role": "developer",
      "source": "mas",
      "localRole": "admin",
      "effectiveRole": "ADMIN",
      "lastSyncedAt": "2026-02-19T11:55:00.000Z"
    }
  ]
}
```

The `source` field indicates the primary source. When a user has both MAS and local roles, both are shown with the `effectiveRole` reflecting the maximum.

### Remove Collaborator

```
DELETE /api/sites/{siteId}/collaborators/{userId}
Authorization: Bearer <token>
```

- Requires `canManageGrants` permission (ADMIN role).
- **Only removes the local grant.** MAS-sourced roles cannot be removed through CCR; they must be managed in the Pantheon dashboard.
- If the user only had a local grant, they lose access entirely.
- If the user also has a MAS role, their access falls back to that MAS role.

**Response (204 No Content)** on success.

**Response (404 Not Found)** if the user has no local grant on this site.

---

## Site Members Endpoint

The collaborator endpoints above manage grants and require `canManageGrants`. Reading
who the collaborators *are* is a different act, so it has its own endpoint gated only on
`canView` — it exists to populate pickers (a mention list, an assignee dropdown) for any
user who can see the site.

```
GET /api/sites/{siteId}/members
Authorization: Bearer <token>
```

**Response (200 OK):**

```json
{
  "members": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Ada Lovelace",
      "email": "ada@pantheon.io",
      "role": "admin",
      "avatar": "https://cdn.example.com/ada.png",
      "source": "mas"
    }
  ],
  "agents": [
    {
      "id": "agent-uuid",
      "name": "Copy Editor",
      "role": "editor",
      "avatar": null,
      "isGlobal": false
    }
  ]
}
```

- `members[].role` is a Pantheon role; `agents[].role` is an agent site role
  (`viewer` / `editor` / `admin`).
- `avatar` is always `null` for agents — there is no stored image for them, so clients
  derive one from the id.
- `isGlobal` is true for an agent that reaches every site rather than holding a grant on
  this one.
- Permission is `canView`, resolved against the site's main branch. A site with no main
  branch is a 404.

### How the members array is assembled

Two sources are folded together:

1. **`user_site_roles` for the site.** A person can hold two rows here — one `local`, one
   cached from MAS — so rows are folded per person and the higher role is reported,
   matching how authorization resolves an effective role. When both rows land on the same
   tier (`mapPantheonRole` collapses developer/team_member/author/editor onto `EDITOR`),
   the local grant wins the tie: it was made against this site deliberately, where the
   MAS value mirrors account-wide membership.
2. **The upstream MAS roster** (`getSiteMemberships`), unioned in. The cached rows only
   cover people who have had a request authorized recently, so local grants alone
   under-report on Pantheon-authenticated sites. A person who is in MAS but has never
   signed in to CCR has no `users` row and comes back with a null `name` and `avatar`
   rather than being dropped.

If the MAS roster is unavailable the request still succeeds with the locally-known members
and logs a degraded outcome — an upstream outage should not empty a mention picker.

### Caching

The response body is keyed on `siteId` alone — it is identical for everyone who can view
the site, and only the authorization is per-caller. That makes it cheap to cache *inside*
the worker and unsafe to cache in front of it: a CDN, ISR or browser cache keys on the bare
URL and never sees the per-member gate, so a `public` copy of a roster carrying names and
email addresses would be served to anyone who guessed the path. The endpoint therefore
returns `Cache-Control: private, no-store`, the same reasoning that governs non-main content
responses.

Behind the permission check, the upstream roster is memoized per site for 60s in worker
module scope (`services/mas-roster-cache.ts` — it wraps `MASClient`, so it sits with the
client it caches rather than inside the route that happens to be its only caller today). The upstream call is a paged HTTP round trip and is the
dominant cost of the request, so this is where the saving is. The memo is isolate-local: a
cold isolate always misses, and there is no invalidation protocol — the worst case is the
uncached behaviour. A minute of staleness is cheap in both directions, since a person
removed upstream has already lost access on the authorization path, which does not read
this memo.

Concurrent callers that miss together share one upstream read: the promise is registered
before it is awaited and dropped in a `finally`, so N viewers arriving on a cold site
produce one round trip rather than N — which is the busy-site case the memo exists for.

If the upstream call fails and a memo up to 10 minutes old is on hand, that stale roster is
served rather than dropping the MAS-only people from the list. Both the memo and the stale
fallback are visible in the logs via `roster_source`
(`upstream` / `memo` / `stale` / `unavailable` / `unconfigured`).

### Module layout

| File | Holds |
|------|-------|
| `routes/site-members/index.ts` | the gate and the shape: method, permission, status codes, the log line |
| `routes/site-members/types.ts` | the wire contract |
| `services/site-members-service.ts` | the roster: the SQL, the row shapes, the local/upstream union, the role fold |
| `services/mas-roster-cache.ts` | the memo in front of `MASClient.getSiteMemberships` |

Everything that touches the database sits in `services/`, as it does for the rest of this
worker; the route contributes no SQL of its own. `mas-roster-cache` is separate from the
service because it wraps `MASClient` and holds state, so it belongs with the client it
caches rather than with its one current caller.

Tests mock `src/db`, `branch-service` and `agent-site-role-service` by direct path rather
than through `src/services/index.ts` — mocking that barrel forks the error classes it
re-exports, which is how a real 403 turns into a 500.

### Observability

Every served request logs one `site members served` line carrying `site_id`,
`member_count`, `agent_count`, `roster_source`, `duration_ms` and an `outcome` of `ok` or
`degraded`. `stale` and `unavailable` both count as degraded — a request the memo rescued
after a failed upstream call is not a healthy one, and treating it as `ok` would hide an
outage that stays inside the ten-minute grace window. `unconfigured` stays `ok`: it is a
deployment state, not a failure. A 403 logs `site members denied`; a failure logs `site members route failed`
with the error. `member_count`, `agent_count` and `roster_source` are added to the worker's
`allowFields` in `telemetry.ts`, so they survive redaction in the deployed lanes — without
that they would appear in the `dropped` list instead of the log body.

Because the memo is isolate-local there is no cache-hit counter to read anywhere else;
`roster_source` on that one line is the only evidence of whether it is earning its keep, and
a rising share of `stale` or `unavailable` is the signal that the upstream roster service is
in trouble.

---

## Role Mapping

### MAS Roles to CCR Roles

| MAS Role | CCR Role | Permissions |
|----------|----------|-------------|
| `owner` | `ADMIN` | Full access including merge-to-main and grant management |
| `admin` | `ADMIN` | Full access including merge-to-main and grant management |
| `developer` | `EDITOR` | Can edit documents, create branches, merge (except to main) |
| `team_member` | `EDITOR` | Can edit documents, create branches, merge (except to main) |
| `unprivileged` | `NO_ACCESS` | No access |
| _(undefined)_ | `NO_ACCESS` | No access |

This mapping is implemented in `mapPantheonRole()` in `workers/src/auth/roles.ts`.

### Agent Roles to CCR Roles

| Agent Role | CCR Role |
|------------|----------|
| `admin` | `ADMIN` |
| `editor` | `EDITOR` |
| `viewer` | `VIEWER` |
| _(undefined)_ | `NO_ACCESS` |

---

## Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAS_BASE_URL` | Yes (prod) | - | MAS API base URL. Production: `https://memberships.svc.pantheon.io`. Sandbox: `https://memberships.sbx.pantheon.io` |
| `MAS_GCP_SERVICE_ACCOUNT_KEY` | Yes (prod) | - | JSON key for the GCP service account used to authenticate with MAS |
| `MAS_CACHE_TTL_SECONDS` | No | `300` | Cache TTL for MAS role lookups. Set to `0` to disable caching (not recommended). |
| `MAS_ENABLED` | No | `true` | Set to `false` to disable MAS integration entirely. When disabled, only local grants and JWT fallback are used. |
| `GOOGLE_CLIENT_ID` | No | - | Google OAuth client ID. Enables Google identity provider when set. |
| `AUTH0_ISSUER_BASE_URL` | No | - | Auth0 issuer URL. Enables Auth0 identity provider when set (along with `AUTH0_AUDIENCE`). |
| `AUTH0_NEW_ISSUER_BASE_URL` | No | - | New Auth0 issuer URL for tenant migration. |
| `AUTH0_AUDIENCE` | No | - | Expected audience for Auth0 token validation. |

---

## Database Schema

### user_site_roles Table

Stores both MAS-synced and locally-granted site roles:

```sql
CREATE TABLE app.user_site_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    site_id UUID NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
    role TEXT NOT NULL,          -- 'owner', 'admin', 'developer', 'team_member'
    source TEXT NOT NULL DEFAULT 'local',  -- 'mas' or 'local'

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_id TEXT,

    UNIQUE(user_id, site_id, source)
);
```

**Key design decisions:**

- The `source` column distinguishes MAS-synced roles from locally-granted roles.
- The unique constraint is on `(user_id, site_id, source)`, allowing a user to have both a MAS role and a local grant on the same site. The effective role is `max(mas_role, local_role)`.
- `user_id` is `TEXT` (not UUID) to accommodate external provider subject IDs and UUIDv5-mapped IDs.

### branch_grants Table

Stores branch-level role elevations:

```sql
CREATE TABLE app.branch_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,    -- 'user', 'agent'
    role TEXT NOT NULL,          -- 'VIEWER', 'EDITOR', 'ADMIN'

    granted_by_id UUID NOT NULL,
    granted_by_type TEXT NOT NULL,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT,

    UNIQUE(branch_id, actor_id)
);
```

### agent_site_roles Table

Stores AI agent access to sites:

```sql
CREATE TABLE app.agent_site_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
    role TEXT NOT NULL,          -- 'viewer', 'editor', 'admin'

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_id TEXT,

    UNIQUE(agent_id, site_id)
);
```

---

## Example Scenarios

### Scenario 1: Pantheon User with Both MAS and Local Roles

A Pantheon employee (`auth0|user123`) has `developer` role in MAS for a site, but a site admin also grants them local `admin` access for CCR.

| Source | Pantheon Role | CCR Role |
|--------|---------------|----------|
| MAS | `developer` | `EDITOR` |
| Local | `admin` | `ADMIN` |
| **Effective site role** | | **ADMIN** |

The local `ADMIN` grant wins because `max(EDITOR, ADMIN) = ADMIN`.

If the local admin grant is later removed via `DELETE /api/sites/{siteId}/collaborators/{userId}`, the user's effective role drops back to `EDITOR` from MAS.

### Scenario 2: External Collaborator with Only Local Grant

A freelancer (`user@gmail.com`) authenticated via Google OAuth. They have no Pantheon account and no MAS membership.

| Source | Role | CCR Role |
|--------|------|----------|
| MAS | _(none)_ | `NO_ACCESS` |
| Local | `developer` | `EDITOR` |
| **Effective site role** | | **EDITOR** |

The local grant provides all their access. `max(NO_ACCESS, EDITOR) = EDITOR`.

### Scenario 3: MAS Outage (Stale Cache + JWT Fallback)

MAS becomes unavailable. The system degrades gracefully:

```
Request arrives
    │
    ▼
Check MAS cache (user_site_roles where source='mas')
    │
    ├── Cache exists (within TTL) ──> Use cached role
    │
    ├── Cache exists (stale, past TTL)
    │       │
    │       ▼
    │   Try MAS API ──> Timeout/Error
    │       │
    │       ▼
    │   Use stale cache (log warning)
    │
    └── No cache at all
            │
            ▼
        Check JWT-embedded roles (principal.pantheonSiteRoles)
            │
            ├── JWT has role ──> Use JWT role
            │
            └── No JWT role ──> NO_ACCESS (local grants still apply separately)
```

| Time | MAS Status | Cache State | Effective MAS Role | Combined with Local |
|------|------------|-------------|--------------------|--------------------|
| T+0 | Healthy | Fresh: `admin` | ADMIN | max(ADMIN, local) |
| T+3m | Down | Fresh (TTL=5m): `admin` | ADMIN | max(ADMIN, local) |
| T+6m | Down | Stale: `admin` | ADMIN (stale, warning logged) | max(ADMIN, local) |
| T+60m | Down | Stale: `admin` | ADMIN (stale, warning logged) | max(ADMIN, local) |
| New user | Down | No cache | JWT fallback or NO_ACCESS | max(fallback, local) |

Local grants are always available regardless of MAS status because they are stored in the CCR database.

### Scenario 4: Branch Elevation Stacking on Top of Site Role

A user has an effective site role of `EDITOR` (from MAS `developer` + no local grant). An ADMIN grants them temporary `ADMIN` access on a feature branch for merge review.

| Layer | Role |
|-------|------|
| MAS site role | `EDITOR` (from `developer`) |
| Local grant | _(none)_ |
| Effective site role | `EDITOR` |
| Branch grant | `ADMIN` (on `feature-branch-1`) |
| **Effective branch role** | **ADMIN** |

```
getEffectiveRole(principal, siteId, 'feature-branch-1')
    │
    ├── getSiteRole() ──> EDITOR (from MAS)
    │
    ├── branch_grants lookup ──> ADMIN (for feature-branch-1)
    │
    └── max(EDITOR, ADMIN) ──> ADMIN
```

On `main` branch (no branch grant):

```
getEffectiveRole(principal, siteId, 'main')
    │
    ├── getSiteRole() ──> EDITOR (from MAS)
    │
    ├── branch_grants lookup ──> (none)
    │
    └── max(EDITOR, undefined) ──> EDITOR
```

The branch grant only applies to the specific branch where it was created. The user remains an EDITOR on all other branches.

### Summary Table

| Scenario | MAS Role | Local Grant | Branch Grant | Effective Site Role | Effective Branch Role |
|----------|----------|-------------|--------------|---------------------|----------------------|
| Pantheon user, MAS only | `admin` | - | - | ADMIN | ADMIN |
| Pantheon user, both sources | `developer` | `admin` | - | ADMIN | ADMIN |
| External collaborator | - | `developer` | - | EDITOR | EDITOR |
| External + branch elevation | - | `developer` | `ADMIN` | EDITOR | ADMIN |
| MAS outage, cache available | stale `admin` | - | - | ADMIN (stale) | ADMIN (stale) |
| MAS outage, no cache | JWT fallback | `developer` | - | max(fallback, EDITOR) | max(fallback, EDITOR) |
