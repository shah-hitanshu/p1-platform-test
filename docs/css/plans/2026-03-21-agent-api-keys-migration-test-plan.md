# Test Plan: Migration 027 - Agent API Keys

**Component:** B1 (Agent API Keys Migration)
**Test file:** `workers/tests/db/027-agent-api-keys-migration.spec.ts`
**Migration file:** `workers/src/db/migrations/027_agent_api_keys.sql`
**Pattern reference:** `workers/tests/db/schema.spec.ts` (schema introspection style)

---

## Overview

This test plan validates that migration 027 correctly creates the `app.agent_api_keys` table with all required columns, types, constraints, indexes, and foreign keys. Tests use the same approach as the existing `schema.spec.ts` -- querying `information_schema` and `pg_indexes` against the live Docker PostgreSQL container.

## Test Categories

### Category 1: Table Existence

| # | Test | Assertion |
|---|------|-----------|
| 1 | `app.agent_api_keys` table exists | Query `information_schema.tables` returns `true` |

### Category 2: Column Schema Validation

Each column is verified for name, data type, nullability, and default value where applicable.

| # | Column | Expected Type | Nullable | Default | Notes |
|---|--------|--------------|----------|---------|-------|
| 2 | `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| 3 | `agent_id` | `text` | NO | none | TEXT to match `agents.id` type (migration 012) |
| 4 | `token_hash` | `text` | NO | none | UNIQUE constraint |
| 5 | `prefix` | `character varying` (VARCHAR(12)) | NO | none | Display prefix (e.g., `aak_abc123`) |
| 6 | `name` | `text` | NO | none | Human-readable key name |
| 7 | `created_by` | `text` | NO | none | TEXT to match user ID patterns in codebase |
| 8 | `created_at` | `timestamp with time zone` | NO | `now()` | Auto-set on insert |
| 9 | `last_used_at` | `timestamp with time zone` | YES | none | Updated on each authenticated request |
| 10 | `revoked_at` | `timestamp with time zone` | YES | none | Null means active; set to revoke |

### Category 3: Constraints

| # | Test | Constraint Type | Details |
|---|------|----------------|---------|
| 11 | Primary key exists on `id` | PRIMARY KEY | Via `information_schema.table_constraints` |
| 12 | `token_hash` has UNIQUE constraint | UNIQUE | Prevents duplicate hashes |
| 13 | `agent_id` has FK to `app.agents(id)` | FOREIGN KEY | References `agents.id` |
| 14 | FK delete rule is CASCADE | FOREIGN KEY | `ON DELETE CASCADE` verified via `information_schema.referential_constraints` |

### Category 4: Indexes

| # | Test | Index Name | Columns | Partial? |
|---|------|-----------|---------|----------|
| 15 | Token hash lookup index | `idx_agent_api_keys_hash` | `token_hash` | Yes: `WHERE revoked_at IS NULL` |
| 16 | Agent ID listing index | `idx_agent_api_keys_agent_id` | `agent_id` | No |

### Category 5: Migration Tracking

| # | Test | Assertion |
|---|------|-----------|
| 17 | Migration recorded in `schema_migrations` | Row with `id = 27` and `name = 'agent_api_keys'` exists |

### Category 6: Functional Constraint Tests (DML)

These tests exercise the constraints via INSERT/DELETE operations against the live database.

| # | Test | Operation | Expected Result |
|---|------|-----------|-----------------|
| 18 | Insert valid agent API key | INSERT with valid `agent_id` (seeded agent `a0000000-0000-0000-0000-000000000001`) | Success, returns UUID `id` |
| 19 | Reject key for non-existent agent | INSERT with `agent_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'` | FK violation error (throw) |
| 20 | Reject duplicate `token_hash` | Two INSERTs with same `token_hash` | UNIQUE violation error (throw) on second |
| 21 | CASCADE delete removes keys | Create temp agent, insert key, DELETE agent, verify key is gone | Key count = 0 after agent deletion |

---

## Test Execution

```bash
# Run migration tests only
cd workers && npx vitest run tests/db/027-agent-api-keys-migration.spec.ts

# Run all DB tests (regression check)
cd workers && npx vitest run tests/db/

# Lint
cd workers && pnpm lint
```

## Prerequisites

- Docker container `css-postgres` running with `cssdb` database
- All prior migrations (001-026) applied
- Seed data present (specifically the seeded agent `a0000000-0000-0000-0000-000000000001`)

## Key Design Decisions Validated by Tests

1. **`agent_id` is TEXT, not UUID** -- Test #3 verifies `text` type. This allows a proper FK to `agents.id` (which is TEXT per migration 012). Test #13/#14 verify the FK and CASCADE behavior.

2. **`created_by` is TEXT, not UUID** -- Test #7 verifies `text` type. Consistent with `user_site_roles.user_id` and `user_site_roles.created_by_id` patterns.

3. **Partial index on `token_hash`** -- Test #15 verifies the index exists and includes `WHERE revoked_at IS NULL`. Revoked keys are excluded from lookups for performance.

4. **No `scopes` column** -- Unlike `site_api_tokens` (which has `scopes TEXT[]`), agent keys have no scopes because authorization is handled via `agent_site_roles`. The test plan intentionally omits any scope-related assertions.
