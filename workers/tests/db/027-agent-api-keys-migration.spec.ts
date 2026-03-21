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

function findColumn(columns: ColumnInfo[], name: string): ColumnInfo {
  const col = columns.find((c) => c.column_name === name);
  if (!col) {
    throw new Error(`Column '${name}' not found`);
  }
  return col;
}

function findIndex(indexes: IndexInfo[], name: string): IndexInfo {
  const idx = indexes.find((i) => i.indexname === name);
  if (!idx) {
    throw new Error(`Index '${name}' not found`);
  }
  return idx;
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
    const idCol = findColumn(columns, 'id');
    expect(idCol.data_type).toBe('uuid');
    expect(idCol.is_nullable).toBe('NO');
    expect(idCol.column_default).toContain('gen_random_uuid');

    const constraints = await getTableConstraints('agent_api_keys');
    const hasPK = constraints.some((c) => c.constraint_type === 'PRIMARY KEY');
    expect(hasPK).toBe(true);
  });

  it('should have agent_id column as TEXT NOT NULL (matches agents.id type)', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = findColumn(columns, 'agent_id');
    expect(col.data_type).toBe('text');
    expect(col.is_nullable).toBe('NO');
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
    const col = findColumn(columns, 'token_hash');
    expect(col.data_type).toBe('text');
    expect(col.is_nullable).toBe('NO');

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
    const col = findColumn(columns, 'prefix');
    expect(col.data_type).toBe('character varying');
    expect(col.is_nullable).toBe('NO');
  });

  it('should have name column as TEXT NOT NULL', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = findColumn(columns, 'name');
    expect(col.data_type).toBe('text');
    expect(col.is_nullable).toBe('NO');
  });

  it('should have created_by column as TEXT NOT NULL', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = findColumn(columns, 'created_by');
    expect(col.data_type).toBe('text');
    expect(col.is_nullable).toBe('NO');
  });

  it('should have created_at column as TIMESTAMPTZ NOT NULL with default NOW()', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = findColumn(columns, 'created_at');
    expect(col.data_type).toBe('timestamp with time zone');
    expect(col.is_nullable).toBe('NO');
    expect(col.column_default).toContain('now');
  });

  it('should have last_used_at column as nullable TIMESTAMPTZ', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = findColumn(columns, 'last_used_at');
    expect(col.data_type).toBe('timestamp with time zone');
    expect(col.is_nullable).toBe('YES');
  });

  it('should have revoked_at column as nullable TIMESTAMPTZ', async () => {
    const columns = await getTableColumns('agent_api_keys');
    const col = findColumn(columns, 'revoked_at');
    expect(col.data_type).toBe('timestamp with time zone');
    expect(col.is_nullable).toBe('YES');
  });

  it('should have partial index on token_hash for non-revoked keys', async () => {
    const indexes = await getTableIndexes('agent_api_keys');
    const hashIndex = findIndex(indexes, 'idx_agent_api_keys_hash');
    expect(hashIndex.indexdef).toContain('token_hash');
    expect(hashIndex.indexdef).toContain('revoked_at IS NULL');
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
    const tempAgentId = 'b0000000-0000-0000-0000-000000000099';
    await sql`
      INSERT INTO app.agents (id, organization_id, name, capabilities, status, settings)
      VALUES (
        ${tempAgentId},
        '00000000-0000-0000-0000-000000000000',
        'Temp Agent For Cascade Test',
        ARRAY['content_edit'],
        'active',
        '{}'::jsonb
      )
    `;

    // Create a key for that agent
    await sql`
      INSERT INTO app.agent_api_keys (agent_id, token_hash, prefix, name, created_by)
      VALUES (${tempAgentId}, 'test_hash_027_cascade', 'aak_cas00001', 'Cascade Key', 'test-user')
    `;

    // Delete the agent
    await sql`DELETE FROM app.agents WHERE id = ${tempAgentId}`;

    // Verify the key was cascaded
    const remaining = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM app.agent_api_keys
      WHERE token_hash = 'test_hash_027_cascade'
    `;
    expect(parseInt(remaining[0].count, 10)).toBe(0);
  });
});
