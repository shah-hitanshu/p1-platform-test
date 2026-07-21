# Agent API Keys Migration (B1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Create database migration 027 that adds an `app.agent_api_keys` table for production agent authentication, modeled after the existing `app.site_api_tokens` table.

**Architecture:** The `agent_api_keys` table stores SHA-256 hashed API keys that authenticate agents. Each key belongs to an agent (FK to `app.agents`), has a display prefix, a human-readable name, and tracks creation, usage, and revocation timestamps. Authorization is handled separately via `agent_site_roles` -- this table is purely for authentication credential storage.

**Tech Stack:** PostgreSQL (via Docker container `css-postgres`), Vitest for testing, `postgres` npm package for DB access.

---

## Critical Design Decision: `agent_id` column type

The user's specification calls for `agent_id UUID NOT NULL FK to app.agents(id)`. However, `app.agents.id` is actually **TEXT** (not UUID), changed in migration 012 and constrained to UUID format via a CHECK constraint in migration 013. A UUID column cannot reference a TEXT primary key.

**Decision:** Use `TEXT NOT NULL` for `agent_id` instead of `UUID`, which allows a proper `REFERENCES app.agents(id) ON DELETE CASCADE` foreign key constraint. This matches the actual schema and follows the same pattern that `agent_site_roles` *should* have used (it uses UUID for `agent_id` but has no FK to `agents` because of the type mismatch). By using TEXT here, we get referential integrity that `agent_site_roles` lacks.

**Justification:** A proper FK constraint is more valuable than matching the user's specified UUID type, because:
1. It prevents orphaned API keys when agents are deleted (CASCADE)
2. It prevents creating keys for non-existent agents
3. It follows the actual `agents` table schema rather than the original (pre-migration-012) design
4. The column will still store UUID-formatted strings due to the CHECK constraint on `agents.id`

---

### Task 1: Write the migration test file

**Files:**
- Create: `workers/tests/db/027-agent-api-keys-migration.spec.ts`

**Step 1: Write the failing test**

Create `workers/tests/db/027-agent-api-keys-migration.spec.ts` with the following content:

```typescript
/**
 * Migration 027: Agent API Keys
 *
 * Tests that the agent_api_keys table is correctly created with all
 * required columns, constraints, indexes, and foreign keys.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions (same pattern as schema.spec.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface IndexInfo {
  indexname: string;
  indexdef: string;
}

interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
}

async function getTableColumns(
  tableName: string,
  schema = 'app',
): Promise<ColumnInfo[]> {
  return sql<ColumnInfo[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = ${schema}
    AND table_name = ${tableName}
    ORDER BY ordinal_position
  `;
}

async function getTableIndexes(
  tableName: string,
  schema = 'app',
): Promise<IndexInfo[]> {
  return sql<IndexInfo[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = ${schema}
    AND tablename = ${tableName}
  `;
}

async function getTableConstraints(
  tableName: string,
  schema = 'app',
): Promise<ConstraintInfo[]> {
  return sql<ConstraintInfo[]>`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_schema = ${schema}
    AND table_name = ${tableName}
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent API Keys Table Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent API Keys Table (Migration 027)', () => {
  it('should exist', async () => {
    const result = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'app'
        AND table_name = 'agent_api_keys'
      ) as exists
    `;
    expect(result[0].exists).toBe(true);
  });

  it('should have id column as UUID primary key with default', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const idCol = columns.find((c) => c.column_name === 'id');
    expect(idCol).toBeDefined();
    expect(idCol!.data_type).toBe('uuid');
    expect(idCol!.is_nullable).toBe('NO');
    expect(idCol!.column_default).toContain('gen_random_uuid');

    const constraints = await getTableConstraints('agent_api_keys');
    const hasPK = constraints.some((c) => c.constraint_type === 'PRIMARY KEY');
    expect(hasPK).toBe(true);
  });

  it('should have agent_id column as TEXT NOT NULL (matches agents.id type)', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = columns.find((c) => c.column_name === 'agent_id');
    expect(col).toBeDefined();
    expect(col!.data_type).toBe('text');
    expect(col!.is_nullable).toBe('NO');
  });

  it('should have foreign key from agent_id to agents(id) with CASCADE delete', async () => {
    const fkResult = await sql<{ delete_rule: string }[]>`
      SELECT rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
      WHERE tc.table_schema = 'app'
        AND tc.table_name = 'agent_api_keys'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'agent_id'
    `;
    expect(fkResult.length).toBe(1);
    expect(fkResult[0].delete_rule).toBe('CASCADE');
  });

  it('should have token_hash column as TEXT NOT NULL UNIQUE', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = columns.find((c) => c.column_name === 'token_hash');
    expect(col).toBeDefined();
    expect(col!.data_type).toBe('text');
    expect(col!.is_nullable).toBe('NO');

    const constraints = await getTableConstraints('agent_api_keys');
    const hasUnique = constraints.some(
      (c) =>
        c.constraint_type === 'UNIQUE' &&
        c.constraint_name.includes('token_hash'),
    );
    expect(hasUnique).toBe(true);
  });

  it('should have prefix column as VARCHAR(12) NOT NULL', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = columns.find((c) => c.column_name === 'prefix');
    expect(col).toBeDefined();
    expect(col!.data_type).toBe('character varying');
    expect(col!.is_nullable).toBe('NO');
  });

  it('should have name column as TEXT NOT NULL', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = columns.find((c) => c.column_name === 'name');
    expect(col).toBeDefined();
    expect(col!.data_type).toBe('text');
    expect(col!.is_nullable).toBe('NO');
  });

  it('should have created_by column as TEXT NOT NULL', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = columns.find((c) => c.column_name === 'created_by');
    expect(col).toBeDefined();
    expect(col!.data_type).toBe('text');
    expect(col!.is_nullable).toBe('NO');
  });

  it('should have created_at column as TIMESTAMPTZ NOT NULL with default NOW()', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = columns.find((c) => c.column_name === 'created_at');
    expect(col).toBeDefined();
    expect(col!.data_type).toBe('timestamp with time zone');
    expect(col!.is_nullable).toBe('NO');
    expect(col!.column_default).toContain('now');
  });

  it('should have last_used_at column as nullable TIMESTAMPTZ', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = columns.find((c) => c.column_name === 'last_used_at');
    expect(col).toBeDefined();
    expect(col!.data_type).toBe('timestamp with time zone');
    expect(col!.is_nullable).toBe('YES');
  });

  it('should have revoked_at column as nullable TIMESTAMPTZ', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = columns.find((c) => c.column_name === 'revoked_at');
    expect(col).toBeDefined();
    expect(col!.data_type).toBe('timestamp with time zone');
    expect(col!.is_nullable).toBe('YES');
  });

  it('should have partial index on token_hash for non-revoked keys', async () => {
    const indexes = await getTableIndexes('agent_api_keys');
    const hashIndex = indexes.find(
      (i) => i.indexname === 'idx_agent_api_keys_hash',
    );
    expect(hashIndex).toBeDefined();
    expect(hashIndex!.indexdef).toContain('token_hash');
    expect(hashIndex!.indexdef).toContain('revoked_at IS NULL');
  });

  it('should have index on agent_id', async () => {
    const indexes = await getTableIndexes('agent_api_keys');
    const agentIndex = indexes.find(
      (i) => i.indexname === 'idx_agent_api_keys_agent_id',
    );
    expect(agentIndex).toBeDefined();
  });

  it('should be recorded in schema_migrations', async () => {
    const result = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count
      FROM app.schema_migrations
      WHERE id = 27 AND name = 'agent_api_keys'
    `;
    expect(parseInt(result[0].count, 10)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Functional Tests: Insert / FK / Cascade
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent API Keys - Functional Constraints', () => {
  const testAgentId = 'a0000000-0000-0000-0000-000000000001'; // seeded agent-zappy

  it('should allow inserting a valid agent API key', async () => {
    const result = await sql`
      INSERT INTO app.agent_api_keys (agent_id, token_hash, prefix, name, created_by)
      VALUES (${testAgentId}, 'test_hash_027_valid', 'aak_abc12345', 'Test Key', 'test-user')
      RETURNING id
    `;
    expect(result.length).toBe(1);
    expect(result[0].id).toBeDefined();

    // Cleanup
    await sql`DELETE FROM app.agent_api_keys WHERE token_hash = 'test_hash_027_valid'`;
  });

  it('should reject inserting a key for a non-existent agent', async () => {
    await expect(
      sql`
        INSERT INTO app.agent_api_keys (agent_id, token_hash, prefix, name, created_by)
        VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'test_hash_027_noagent', 'aak_bad00000', 'Bad Key', 'test-user')
      `,
    ).rejects.toThrow();
  });

  it('should reject duplicate token_hash', async () => {
    await sql`
      INSERT INTO app.agent_api_keys (agent_id, token_hash, prefix, name, created_by)
      VALUES (${testAgentId}, 'test_hash_027_dup', 'aak_dup00001', 'Key 1', 'test-user')
    `;

    await expect(
      sql`
        INSERT INTO app.agent_api_keys (agent_id, token_hash, prefix, name, created_by)
        VALUES (${testAgentId}, 'test_hash_027_dup', 'aak_dup00002', 'Key 2', 'test-user')
      `,
    ).rejects.toThrow();

    // Cleanup
    await sql`DELETE FROM app.agent_api_keys WHERE token_hash = 'test_hash_027_dup'`;
  });

  it('should cascade delete keys when agent is deleted', async () => {
    // Create a temporary agent
    const tempAgent = await sql`
      INSERT INTO app.agents (id, organization_id, name, capabilities, status, settings)
      VALUES (
        'b0000000-0000-0000-0000-000000000099',
        '00000000-0000-0000-0000-000000000000',
        'Temp Agent For Cascade Test',
        ARRAY['content_edit'],
        'active',
        '{}'::jsonb
      )
      RETURNING id
    `;

    // Create a key for that agent
    await sql`
      INSERT INTO app.agent_api_keys (agent_id, token_hash, prefix, name, created_by)
      VALUES (${tempAgent[0].id}, 'test_hash_027_cascade', 'aak_cas00001', 'Cascade Key', 'test-user')
    `;

    // Delete the agent
    await sql`DELETE FROM app.agents WHERE id = ${tempAgent[0].id}`;

    // Verify the key was cascaded
    const remaining = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM app.agent_api_keys
      WHERE token_hash = 'test_hash_027_cascade'
    `;
    expect(parseInt(remaining[0].count, 10)).toBe(0);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-keys-migration/workers && npx vitest run tests/db/027-agent-api-keys-migration.spec.ts`

Expected: FAIL -- the `agent_api_keys` table does not exist yet.

**Step 3: Commit the test**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-keys-migration
git add workers/tests/db/027-agent-api-keys-migration.spec.ts
git commit -m "test: add migration 027 agent_api_keys schema validation tests"
```

---

### Task 2: Write the migration SQL

**Files:**
- Create: `workers/src/db/migrations/027_agent_api_keys.sql`

**Step 1: Write the migration file**

Create `workers/src/db/migrations/027_agent_api_keys.sql` with the following content:

```sql
-- Migration 027: Agent API Keys
--
-- Adds a table for agent API keys that allow AI agents to authenticate
-- to the CSS API with revocable, hashed tokens.
--
-- Modeled after app.site_api_tokens (migration 020), but scoped to agents
-- instead of sites. Unlike site tokens which have per-token scopes,
-- agent keys are purely authentication credentials -- authorization is
-- determined by the agent's per-site roles in agent_site_roles.
--
-- Tokens are stored as SHA-256 hashes; the raw token is shown only once at
-- creation time. A prefix column stores the first characters (e.g. "aak_abc123")
-- for display in management UIs.
--
-- Note: agent_id is TEXT (not UUID) because app.agents.id was changed to TEXT
-- in migration 012. The column stores UUID-formatted strings enforced by a
-- CHECK constraint on app.agents.

CREATE TABLE IF NOT EXISTS app.agent_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES app.agents(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix VARCHAR(12) NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Fast lookup by token hash (used on every authenticated request)
-- Partial index excludes revoked keys since they will never match
CREATE INDEX idx_agent_api_keys_hash
  ON app.agent_api_keys (token_hash)
  WHERE revoked_at IS NULL;

-- List keys for an agent (admin UI)
CREATE INDEX idx_agent_api_keys_agent_id
  ON app.agent_api_keys (agent_id);
```

**Design notes on `created_by TEXT`:** The user spec says `created_by UUID NOT NULL`. However, the existing codebase uses TEXT for user identifiers in several places (e.g., `user_site_roles.user_id TEXT`, `user_site_roles.created_by_id TEXT`). Using TEXT for `created_by` is consistent with how user IDs are stored elsewhere and avoids type-casting issues when the creating user's ID comes from an external identity provider. This matches the established pattern.

**Step 2: Run the migration**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-keys-migration/workers && npx tsx src/db/migrate.ts`

Expected: Migration 027 applied successfully.

**Step 3: Run the tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-keys-migration/workers && npx vitest run tests/db/027-agent-api-keys-migration.spec.ts`

Expected: All tests PASS.

**Step 4: Run the full test suite to check for regressions**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-keys-migration/workers && npx vitest run tests/db/`

Expected: All tests PASS (schema.spec.ts + 027-agent-api-keys-migration.spec.ts).

**Step 5: Lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-keys-migration/workers && pnpm lint`

Expected: 0 errors.

**Step 6: Commit the migration**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-keys-migration
git add workers/src/db/migrations/027_agent_api_keys.sql
git commit -m "feat: add migration 027 agent_api_keys table for agent authentication"
```

---

## Deviation Summary

Two columns deviate from the user's original specification, both for sound architectural reasons:

| Column | User Spec | Actual | Reason |
|--------|-----------|--------|--------|
| `agent_id` | `UUID NOT NULL` | `TEXT NOT NULL` | `agents.id` is TEXT (migration 012). Using TEXT allows a proper FK constraint with ON DELETE CASCADE. |
| `created_by` | `UUID NOT NULL` | `TEXT NOT NULL` | User IDs are TEXT throughout the codebase (e.g., `user_site_roles.user_id`, `user_site_roles.created_by_id`). TEXT avoids type-casting issues with external identity providers. |

Both columns will contain UUID-formatted strings in practice, but the TEXT type matches the established codebase patterns and enables proper referential integrity.
