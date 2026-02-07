# Migration Plan: User-Site Role Mappings to D1 Database

## Problem Statement

Currently, user-site and agent-site role mappings are hardcoded in `mock-identity.config.json` (and the `DEFAULT_MOCK_CONFIG` fallback in `index.ts`). This means:

1. Adding a new site requires source code changes and redeployment
2. Cannot dynamically provision access for new sites
3. Blocks integration with external authentication providers

## Goals

1. Store user-site and agent-site role mappings in D1 database
2. Query database at authorization time instead of reading from JWT
3. Maintain backwards compatibility with existing branch grants
4. Prepare for external identity provider integration

## Current Flow

```
┌────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Mock Identity     │────▶│   JWT with           │────▶│  getEffective   │
│  Provider          │     │   pantheonSiteRoles  │     │  Role()         │
│  (config.json)     │     │   embedded           │     │                 │
└────────────────────┘     └──────────────────────┘     └─────────────────┘
                                     │
                                     ▼
                           Roles come FROM JWT
```

## Target Flow

```
┌────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  External Identity │────▶│   JWT with           │────▶│  getEffective   │
│  Provider          │     │   principal ID only  │     │  Role()         │
│                    │     │   (no site roles)    │     │  ↓              │
└────────────────────┘     └──────────────────────┘     │  Query D1 for   │
                                                         │  site roles     │
                                                         └─────────────────┘
                                                                  │
                                                                  ▼
                                                         Roles come FROM DB
```

---

## Phase 1: Database Schema

### Migration 014: Site Roles Tables

File: `src/db/migrations/014_site_roles.sql`

```sql
-- Migration 014: Site Roles
-- Stores user-site and agent-site role mappings
-- Replaces hardcoded config in mock-identity.config.json

-- User-Site Roles
-- Maps Pantheon users to sites with their Pantheon role
CREATE TABLE app.user_site_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,          -- External user ID (from identity provider)
    site_id UUID NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
    role TEXT NOT NULL,             -- 'owner', 'admin', 'developer', 'team_member'

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_id TEXT,

    UNIQUE(user_id, site_id)
);

CREATE INDEX idx_user_site_roles_user ON app.user_site_roles(user_id);
CREATE INDEX idx_user_site_roles_site ON app.user_site_roles(site_id);

-- Agent-Site Roles
-- Maps AI agents to sites with their access level
CREATE TABLE app.agent_site_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,         -- Agent ID (from agent registry)
    site_id UUID NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
    role TEXT NOT NULL,             -- 'viewer', 'editor', 'admin'

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_id TEXT,

    UNIQUE(agent_id, site_id)
);

CREATE INDEX idx_agent_site_roles_agent ON app.agent_site_roles(agent_id);
CREATE INDEX idx_agent_site_roles_site ON app.agent_site_roles(site_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION app.update_site_roles_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_site_roles_updated
    BEFORE UPDATE ON app.user_site_roles
    FOR EACH ROW EXECUTE FUNCTION app.update_site_roles_timestamp();

CREATE TRIGGER trg_agent_site_roles_updated
    BEFORE UPDATE ON app.agent_site_roles
    FOR EACH ROW EXECUTE FUNCTION app.update_site_roles_timestamp();
```

### Migration 015: Seed Demo Site Roles

File: `src/db/migrations/015_seed_demo_site_roles.sql`

```sql
-- Migration 015: Seed Demo Site Roles
-- Adds default access for demo users on demo sites

-- First, ensure the demo sites exist
INSERT INTO app.sites (id, pantheon_site_id, name, workflow_settings)
VALUES
    (
        '35b800c4-6010-4908-a724-f1512e2a2144',
        'audi-demo-site',
        'Audi Demo Site',
        '{"mergeApprovalMode": "optional", "minApprovers": 1, "allowSelfApproval": true}'::jsonb
    )
ON CONFLICT (id) DO NOTHING;

-- Demo users with access to the Audi demo site
INSERT INTO app.user_site_roles (user_id, site_id, role) VALUES
    ('user-alice', '35b800c4-6010-4908-a724-f1512e2a2144', 'admin'),
    ('user-bob', '35b800c4-6010-4908-a724-f1512e2a2144', 'developer'),
    ('user-carol', '35b800c4-6010-4908-a724-f1512e2a2144', 'developer')
ON CONFLICT (user_id, site_id) DO UPDATE SET role = EXCLUDED.role;

-- Zappy AI agent access to demo sites
INSERT INTO app.agent_site_roles (agent_id, site_id, role) VALUES
    ('a0000000-0000-0000-0000-000000000001', '35b800c4-6010-4908-a724-f1512e2a2144', 'admin'),
    ('a0000000-0000-0000-0000-000000000001', '5da7f0d0-81d8-4e92-9a4b-a4cb07090768', 'admin'),
    ('a0000000-0000-0000-0000-000000000001', 'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22', 'admin')
ON CONFLICT (agent_id, site_id) DO UPDATE SET role = EXCLUDED.role;
```

---

## Phase 2: Authorization Code Changes

### Update `getEffectiveRole()` in `src/auth/authorization.ts`

```typescript
export async function getEffectiveRole(
  principal: AuthenticatedPrincipal,
  siteId: string,
  branchId: string,
): Promise<EffectiveRoleResult> {
  // Step 1: Get baseline role from database (instead of JWT)
  const baselineRoleName = await getSiteRole(principal, siteId);

  // Step 2: Check for branch-level elevation (unchanged)
  const branchGrant = await query<{ role: RoleName }>(
    `SELECT role FROM branch_grants
     WHERE branch_id = $1 AND actor_id = $2`,
    [branchId, principal.id],
  );

  const grantRoleName = branchGrant.rows[0]?.role;

  // Step 3: Effective role is the higher of the two
  const effectiveRoleName = maxRole(baselineRoleName, grantRoleName);

  return {
    role: ROLES[effectiveRoleName],
    roleName: effectiveRoleName,
  };
}

/**
 * Gets the site-level role for a principal from the database.
 * Falls back to JWT-embedded roles for backwards compatibility.
 */
async function getSiteRole(
  principal: AuthenticatedPrincipal,
  siteId: string,
): Promise<RoleName> {
  if (principal.type === 'agent') {
    // Query agent_site_roles table
    const result = await query<{ role: AgentSiteRole }>(
      `SELECT role FROM agent_site_roles
       WHERE agent_id = $1 AND site_id = $2`,
      [principal.id, siteId],
    );

    if (result.rows[0]) {
      return mapAgentRole(result.rows[0].role);
    }
  } else {
    // Query user_site_roles table
    const result = await query<{ role: PantheonRole }>(
      `SELECT role FROM user_site_roles
       WHERE user_id = $1 AND site_id = $2`,
      [principal.id, siteId],
    );

    if (result.rows[0]) {
      return mapPantheonRole(result.rows[0].role);
    }
  }

  // Fallback to JWT-embedded roles for backwards compatibility
  const jwtRole = principal.pantheonSiteRoles[siteId];
  return mapPantheonRole(jwtRole);
}
```

### Add `mapAgentRole()` to `src/auth/roles.ts`

```typescript
/**
 * Maps an agent site role to the corresponding system role name.
 *
 * Agent roles map as follows:
 * - admin -> ADMIN
 * - editor -> EDITOR
 * - viewer -> VIEWER
 * - undefined -> NO_ACCESS
 */
export function mapAgentRole(agentRole: AgentSiteRole | undefined): RoleName {
  switch (agentRole) {
    case 'admin':
      return 'ADMIN';
    case 'editor':
      return 'EDITOR';
    case 'viewer':
      return 'VIEWER';
    default:
      return 'NO_ACCESS';
  }
}
```

---

## Phase 3: API Endpoints for Site Role Management

### New Routes in `src/routes/`

#### `GET /api/v1/sites/:siteId/roles`
List all user and agent roles for a site.

#### `PUT /api/v1/sites/:siteId/roles/users/:userId`
Set or update a user's role on a site.

```typescript
// Request body
{ "role": "admin" | "developer" | "team_member" }
```

#### `DELETE /api/v1/sites/:siteId/roles/users/:userId`
Remove a user's access to a site.

#### `PUT /api/v1/sites/:siteId/roles/agents/:agentId`
Set or update an agent's role on a site.

#### `DELETE /api/v1/sites/:siteId/roles/agents/:agentId`
Remove an agent's access to a site.

---

## Phase 4: Update Mock Identity Provider

The mock identity provider can be simplified:

1. Remove `siteRoles` from `MockUser` and `MockAgent` types
2. JWT tokens only contain identity (id, email, type) not authorization
3. Authorization is always queried from the database

For backwards compatibility, keep reading `mock-identity.config.json` for user identity, but ignore the `siteRoles` fields.

---

## Implementation Order

1. **Migration 014**: Create `user_site_roles` and `agent_site_roles` tables
2. **Migration 015**: Seed demo site roles for existing demo users/agents
3. **Add `mapAgentRole()`**: New function in `roles.ts`
4. **Update `getEffectiveRole()`**: Query database instead of JWT
5. **Add API endpoints**: CRUD for site roles
6. **Update mock identity provider**: Simplify to identity-only

---

## Testing Checklist

- [ ] Existing branch grants still work
- [ ] Users without DB role but with JWT role still work (backwards compat)
- [ ] Users with DB role but no JWT role work correctly
- [ ] Agents can be granted site access via database
- [ ] API endpoints correctly manage site roles
- [ ] Demo users can access presence on Audi demo site

---

## Rollback Plan

If issues arise:
1. Revert `getEffectiveRole()` to use `principal.pantheonSiteRoles` only
2. Keep migrations in place (tables are additive, not destructive)
3. Re-add `siteRoles` to mock identity config if needed
