# Hybrid Authorization Design

> **Last Updated:** February 2026
> **System:** Collaborative State System (CSS)

This document describes the CSS authorization model, which resolves a user's effective role from multiple sources: MAS (Membership Authorization Service), local grants, and branch-level grants.

---

## Architecture Overview

CSS uses a **dual-source authorization model** that combines Pantheon's centralized membership system (MAS) with locally-managed grants. This hybrid approach allows:

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

- CSS queries MAS to look up the user's site membership and role.
- MAS returns Pantheon roles (`admin`, `owner`, `developer`, `team_member`, `unprivileged`) which are mapped to CSS roles.
- If MAS is unavailable, CSS falls back to cached roles or JWT-embedded roles.

### Local Grants

Local grants can be assigned to **any authenticated user** regardless of auth provider. They are stored directly in the CSS database (`user_site_roles` table).

- Used for Google-authenticated external collaborators who have no Pantheon account.
- Can also supplement MAS roles for Pantheon users (e.g., granting elevated access on a specific CSS site).
- Managed via the Collaborator API.

### Branch Grants

Branch grants provide **temporary role elevation** on a specific branch. They are stored in the `branch_grants` table.

- Apply to any authenticated user or agent on a specific branch.
- Managed via the Grants API (`/api/sites/{siteId}/branches/{branchId}/grants`).
- Common use case: granting an EDITOR temporary ADMIN access on a branch for merge operations.

---

## MAS Integration Details

### Service Account Setup

CSS authenticates to MAS using a GCP service account. The service account must be registered as an invoker in the MAS Terraform configuration.

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

The CSS worker authenticates to the MAS load balancer using a GCP identity token:

```typescript
// Generate identity token for MAS
const identityToken = await getGcpIdentityToken({
  audience: 'membership-authorization-api',
  serviceAccountKey: env.MAS_GCP_SERVICE_ACCOUNT_KEY,
});
```

### MAS API Endpoints

CSS uses the following MAS endpoint:

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

CSS implements a cache-through pattern for MAS role lookups to avoid querying MAS on every request.

### How It Works

```
┌──────────┐     ┌───────────────┐     ┌──────────┐
│  Request  │────>│  CSS Cache    │────>│   MAS    │
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
- The `userId` is the CSS UUID (the UUIDv5-mapped ID for OAuth users).

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
- **Only removes the local grant.** MAS-sourced roles cannot be removed through CSS; they must be managed in the Pantheon dashboard.
- If the user only had a local grant, they lose access entirely.
- If the user also has a MAS role, their access falls back to that MAS role.

**Response (204 No Content)** on success.

**Response (404 Not Found)** if the user has no local grant on this site.

---

## Role Mapping

### MAS Roles to CSS Roles

| MAS Role | CSS Role | Permissions |
|----------|----------|-------------|
| `owner` | `ADMIN` | Full access including merge-to-main and grant management |
| `admin` | `ADMIN` | Full access including merge-to-main and grant management |
| `developer` | `EDITOR` | Can edit documents, create branches, merge (except to main) |
| `team_member` | `EDITOR` | Can edit documents, create branches, merge (except to main) |
| `unprivileged` | `NO_ACCESS` | No access |
| _(undefined)_ | `NO_ACCESS` | No access |

This mapping is implemented in `mapPantheonRole()` in `workers/src/auth/roles.ts`.

### Agent Roles to CSS Roles

| Agent Role | CSS Role |
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

A Pantheon employee (`auth0|user123`) has `developer` role in MAS for a site, but a site admin also grants them local `admin` access for CSS.

| Source | Pantheon Role | CSS Role |
|--------|---------------|----------|
| MAS | `developer` | `EDITOR` |
| Local | `admin` | `ADMIN` |
| **Effective site role** | | **ADMIN** |

The local `ADMIN` grant wins because `max(EDITOR, ADMIN) = ADMIN`.

If the local admin grant is later removed via `DELETE /api/sites/{siteId}/collaborators/{userId}`, the user's effective role drops back to `EDITOR` from MAS.

### Scenario 2: External Collaborator with Only Local Grant

A freelancer (`user@gmail.com`) authenticated via Google OAuth. They have no Pantheon account and no MAS membership.

| Source | Role | CSS Role |
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

Local grants are always available regardless of MAS status because they are stored in the CSS database.

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
