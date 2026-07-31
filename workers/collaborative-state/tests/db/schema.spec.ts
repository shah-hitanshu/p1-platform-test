/**
 * Database Schema Validation Tests
 *
 * Phase 1.2: These tests verify that the PostgreSQL schema is correctly
 * implemented according to the architecture specification.
 *
 * Test approach:
 * - Query information_schema to verify table structure
 * - Verify all required columns, types, and constraints
 * - Verify indexes exist for performance-critical queries
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

// Test database connection - uses same config as docker-compose
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

  // Verify connection
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions for schema introspection
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

async function tableExists(tableName: string, schema = 'app'): Promise<boolean> {
  const result = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = ${schema}
      AND table_name = ${tableName}
    ) as exists
  `;
  return result[0].exists;
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

function hasColumn(
  columns: ColumnInfo[],
  name: string,
  expectedType?: string,
): boolean {
  const col = columns.find((c) => c.column_name === name);
  if (col === undefined) return false;
  if (expectedType !== undefined && col.data_type !== expectedType) return false;
  return true;
}

function hasIndex(indexes: IndexInfo[], indexName: string): boolean {
  return indexes.some((i) => i.indexname === indexName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration Infrastructure Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Migration Infrastructure', () => {
  it('should have schema_migrations table to track applied migrations', async () => {
    const exists = await tableExists('schema_migrations');
    expect(exists).toBe(true);
  });

  it('schema_migrations should have required columns', async () => {
    const columns = await getTableColumns('schema_migrations');

    expect(hasColumn(columns, 'id', 'integer')).toBe(true);
    expect(hasColumn(columns, 'name', 'text')).toBe(true);
    expect(hasColumn(columns, 'applied_at')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core Schema Tests - Sites
// ─────────────────────────────────────────────────────────────────────────────

describe('Sites Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('sites');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('sites');

    // Primary key
    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);

    // Required fields
    expect(hasColumn(columns, 'pantheon_site_id', 'text')).toBe(true);
    expect(hasColumn(columns, 'name', 'text')).toBe(true);

    // Workflow settings (JSONB)
    expect(hasColumn(columns, 'workflow_settings', 'jsonb')).toBe(true);

    // Timestamps
    expect(hasColumn(columns, 'created_at')).toBe(true);
    expect(hasColumn(columns, 'updated_at')).toBe(true);
  });

  it('should have unique constraint on pantheon_site_id', async () => {
    const constraints = await getTableConstraints('sites');
    const hasUnique = constraints.some(
      (c) =>
        c.constraint_type === 'UNIQUE' &&
        c.constraint_name.includes('pantheon_site_id'),
    );
    expect(hasUnique).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core Schema Tests - Documents
// ─────────────────────────────────────────────────────────────────────────────

describe('Documents Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('documents');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('documents');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'site_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'path', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
  });

  it('should have index on site_id', async () => {
    const indexes = await getTableIndexes('documents');
    expect(hasIndex(indexes, 'idx_documents_site')).toBe(true);
  });

  it('should have unique partial index on (site_id, path) for non-deleted documents', async () => {
    // The schema uses a partial unique index instead of a regular constraint
    // to allow recreating documents on the same path after soft-delete
    const indexes = await getTableIndexes('documents');
    // Look for either the exact index name or a unique index containing site_id and path
    const hasUniqueIndex = indexes.some(
      (i) =>
        i.indexdef.includes('UNIQUE') &&
        i.indexdef.includes('site_id') &&
        i.indexdef.includes('path'),
    );
    expect(hasUniqueIndex).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core Schema Tests - Branches
// ─────────────────────────────────────────────────────────────────────────────

describe('Branches Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('branches');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('branches');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'site_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'name', 'text')).toBe(true);
    expect(hasColumn(columns, 'description', 'text')).toBe(true);
    expect(hasColumn(columns, 'status', 'text')).toBe(true);
    expect(hasColumn(columns, 'is_main', 'boolean')).toBe(true);
    expect(hasColumn(columns, 'source_branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'source_checkpoint_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'created_by_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'created_by_type', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
    expect(hasColumn(columns, 'updated_at')).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('branches');

    expect(hasIndex(indexes, 'idx_branches_site')).toBe(true);
    expect(hasIndex(indexes, 'idx_branches_status')).toBe(true);
    expect(hasIndex(indexes, 'idx_branches_main')).toBe(true);
  });

  it('should have unique constraint on (site_id, name)', async () => {
    const constraints = await getTableConstraints('branches');
    const hasUnique = constraints.some((c) => c.constraint_type === 'UNIQUE');
    expect(hasUnique).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core Schema Tests - Document Versions
// ─────────────────────────────────────────────────────────────────────────────

describe('Document Versions Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('document_versions');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('document_versions');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'document_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'version_number', 'integer')).toBe(true);
    expect(hasColumn(columns, 'snapshot', 'jsonb')).toBe(true);
    expect(hasColumn(columns, 'source', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_by_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'created_by_type', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('document_versions');

    expect(hasIndex(indexes, 'idx_versions_doc_branch')).toBe(true);
    expect(hasIndex(indexes, 'idx_versions_branch')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core Schema Tests - Checkpoints
// ─────────────────────────────────────────────────────────────────────────────

describe('Checkpoints Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('checkpoints');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('checkpoints');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'name', 'text')).toBe(true);
    expect(hasColumn(columns, 'message', 'text')).toBe(true);
    expect(hasColumn(columns, 'checkpoint_type', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_by_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'created_by_type', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
  });

  it('should have index on branch_id', async () => {
    const indexes = await getTableIndexes('checkpoints');
    expect(hasIndex(indexes, 'idx_checkpoints_branch')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core Schema Tests - Checkpoint Documents
// ─────────────────────────────────────────────────────────────────────────────

describe('Checkpoint Documents Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('checkpoint_documents');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('checkpoint_documents');

    expect(hasColumn(columns, 'checkpoint_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'document_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'document_version_id', 'uuid')).toBe(true);
  });

  it('should have composite primary key', async () => {
    const constraints = await getTableConstraints('checkpoint_documents');
    const hasPK = constraints.some((c) => c.constraint_type === 'PRIMARY KEY');
    expect(hasPK).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core Schema Tests - Merge Requests
// ─────────────────────────────────────────────────────────────────────────────

describe('Merge Requests Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('merge_requests');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('merge_requests');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'site_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'source_branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'target_branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'base_checkpoint_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'title', 'text')).toBe(true);
    expect(hasColumn(columns, 'description', 'text')).toBe(true);
    expect(hasColumn(columns, 'status', 'text')).toBe(true);
    expect(hasColumn(columns, 'has_conflicts', 'boolean')).toBe(true);
    expect(hasColumn(columns, 'conflict_details', 'jsonb')).toBe(true);
    expect(hasColumn(columns, 'created_by_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'created_by_type', 'text')).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('merge_requests');

    expect(hasIndex(indexes, 'idx_merge_requests_site')).toBe(true);
    expect(hasIndex(indexes, 'idx_merge_requests_source')).toBe(true);
    expect(hasIndex(indexes, 'idx_merge_requests_target')).toBe(true);
    expect(hasIndex(indexes, 'idx_merge_requests_status')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authorization Schema Tests - Branch Grants
// ─────────────────────────────────────────────────────────────────────────────

describe('Branch Grants Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('branch_grants');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('branch_grants');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'actor_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'actor_type', 'text')).toBe(true);
    expect(hasColumn(columns, 'role', 'text')).toBe(true);
    expect(hasColumn(columns, 'granted_by_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'granted_by_type', 'text')).toBe(true);
    expect(hasColumn(columns, 'granted_at')).toBe(true);
    expect(hasColumn(columns, 'reason', 'text')).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('branch_grants');

    expect(hasIndex(indexes, 'idx_branch_grants_branch')).toBe(true);
    expect(hasIndex(indexes, 'idx_branch_grants_actor')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authorization Schema Tests - Guest Links
// ─────────────────────────────────────────────────────────────────────────────

describe('Guest Links Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('guest_links');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('guest_links');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'email', 'text')).toBe(true);
    expect(hasColumn(columns, 'name', 'text')).toBe(true);
    expect(hasColumn(columns, 'token_hash', 'text')).toBe(true);
    expect(hasColumn(columns, 'status', 'text')).toBe(true);
    expect(hasColumn(columns, 'expires_at')).toBe(true);
    expect(hasColumn(columns, 'created_by_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'created_by_type', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
    expect(hasColumn(columns, 'message', 'text')).toBe(true);
    expect(hasColumn(columns, 'access_count', 'integer')).toBe(true);
    expect(hasColumn(columns, 'last_access_at')).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('guest_links');

    expect(hasIndex(indexes, 'idx_guest_links_token')).toBe(true);
    expect(hasIndex(indexes, 'idx_guest_links_branch')).toBe(true);
    expect(hasIndex(indexes, 'idx_guest_links_status')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authorization Schema Tests - Approval Requests
// ─────────────────────────────────────────────────────────────────────────────

describe('Approval Requests Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('approval_requests');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('approval_requests');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'merge_request_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'approver_email', 'text')).toBe(true);
    expect(hasColumn(columns, 'approver_name', 'text')).toBe(true);
    expect(hasColumn(columns, 'token_hash', 'text')).toBe(true);
    expect(hasColumn(columns, 'status', 'text')).toBe(true);
    expect(hasColumn(columns, 'expires_at')).toBe(true);
    expect(hasColumn(columns, 'responded_at')).toBe(true);
    expect(hasColumn(columns, 'comment', 'text')).toBe(true);
    expect(hasColumn(columns, 'ip_address', 'text')).toBe(true);
    expect(hasColumn(columns, 'user_agent', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('approval_requests');

    expect(hasIndex(indexes, 'idx_approval_requests_mr')).toBe(true);
    expect(hasIndex(indexes, 'idx_approval_requests_token')).toBe(true);
    expect(hasIndex(indexes, 'idx_approval_requests_status')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Site Structure Schema Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Site Structures Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('site_structures');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('site_structures');

    // Primary key
    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);

    // Required fields
    expect(hasColumn(columns, 'site_id', 'uuid')).toBe(true);

    // Timestamps
    expect(hasColumn(columns, 'created_at')).toBe(true);

    // Note: The schema was simplified. structure_type, name, slug, description
    // columns were removed as structure metadata is managed by the
    // structure_tree JSONB in branch_structure_state table.
  });

  it('should have foreign key to sites table', async () => {
    const constraints = await getTableConstraints('site_structures');
    const hasFK = constraints.some((c) => c.constraint_type === 'FOREIGN KEY');
    expect(hasFK).toBe(true);
  });
});

describe('Structure Nodes Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('structure_nodes');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('structure_nodes');

    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'structure_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'parent_node_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'position', 'integer')).toBe(true);
    expect(hasColumn(columns, 'name', 'text')).toBe(true);
    expect(hasColumn(columns, 'slug', 'text')).toBe(true);
    expect(hasColumn(columns, 'node_type', 'text')).toBe(true);
    expect(hasColumn(columns, 'document_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'external_url', 'text')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('structure_nodes');

    expect(hasIndex(indexes, 'idx_structure_nodes_parent')).toBe(true);
    expect(hasIndex(indexes, 'idx_structure_nodes_structure')).toBe(true);
    expect(hasIndex(indexes, 'idx_structure_nodes_document')).toBe(true);
  });
});

describe('Branch Structure State Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('branch_structure_state');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('branch_structure_state');

    expect(hasColumn(columns, 'branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'structure_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'structure_tree', 'jsonb')).toBe(true);
    expect(hasColumn(columns, 'metadata_schema', 'jsonb')).toBe(true);
    expect(hasColumn(columns, 'schema_enforcement', 'text')).toBe(true);
    expect(hasColumn(columns, 'has_changes_since_checkpoint', 'boolean')).toBe(
      true,
    );
    expect(hasColumn(columns, 'last_modified_at')).toBe(true);
    expect(hasColumn(columns, 'last_modified_by', 'uuid')).toBe(true);
  });

  it('should have composite primary key', async () => {
    const constraints = await getTableConstraints('branch_structure_state');
    const hasPK = constraints.some((c) => c.constraint_type === 'PRIMARY KEY');
    expect(hasPK).toBe(true);
  });
});

describe('Branch Document Metadata Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('branch_document_metadata');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('branch_document_metadata');

    expect(hasColumn(columns, 'branch_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'structure_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'document_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'metadata', 'jsonb')).toBe(true);
    expect(hasColumn(columns, 'conforms_to_schema', 'boolean')).toBe(true);
    expect(hasColumn(columns, 'validation_errors', 'jsonb')).toBe(true);
    expect(hasColumn(columns, 'last_modified_at')).toBe(true);
    expect(hasColumn(columns, 'last_modified_by', 'uuid')).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('branch_document_metadata');

    expect(hasIndex(indexes, 'idx_branch_doc_metadata_document')).toBe(true);
    expect(hasIndex(indexes, 'idx_branch_doc_metadata_conformance')).toBe(true);
  });
});

describe('Checkpoint Structures Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('checkpoint_structures');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('checkpoint_structures');

    expect(hasColumn(columns, 'checkpoint_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'structure_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'structure_tree', 'jsonb')).toBe(true);
    expect(hasColumn(columns, 'metadata_schema', 'jsonb')).toBe(true);
    expect(hasColumn(columns, 'schema_enforcement', 'text')).toBe(true);
  });

  it('should have composite primary key', async () => {
    const constraints = await getTableConstraints('checkpoint_structures');
    const hasPK = constraints.some((c) => c.constraint_type === 'PRIMARY KEY');
    expect(hasPK).toBe(true);
  });
});

describe('Checkpoint Document Metadata Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('checkpoint_document_metadata');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('checkpoint_document_metadata');

    expect(hasColumn(columns, 'checkpoint_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'structure_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'document_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'metadata', 'jsonb')).toBe(true);
  });

  it('should have composite primary key', async () => {
    const constraints = await getTableConstraints('checkpoint_document_metadata');
    const hasPK = constraints.some((c) => c.constraint_type === 'PRIMARY KEY');
    expect(hasPK).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Politeness System Schema Tests - Organizations
// ─────────────────────────────────────────────────────────────────────────────

describe('Organizations Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('organizations');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('organizations');

    // Primary key
    expect(hasColumn(columns, 'id', 'uuid')).toBe(true);

    // Required fields
    expect(hasColumn(columns, 'name', 'text')).toBe(true);

    // Settings (JSONB with agentIdleTimeoutMs)
    expect(hasColumn(columns, 'settings', 'jsonb')).toBe(true);

    // Timestamps
    expect(hasColumn(columns, 'created_at')).toBe(true);
    expect(hasColumn(columns, 'updated_at')).toBe(true);
  });

  it('should have default settings with agentIdleTimeoutMs', async () => {
    const columns = await getTableColumns('organizations');
    const settingsCol = columns.find((c) => c.column_name === 'settings');
    expect(settingsCol).toBeDefined();
    // Default should include agentIdleTimeoutMs: 5000
    expect(settingsCol?.column_default).toContain('agentIdleTimeoutMs');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Politeness System Schema Tests - Agent Registry
// ─────────────────────────────────────────────────────────────────────────────

describe('Agents Table', () => {
  it('should exist', async () => {
    const exists = await tableExists('agents');
    expect(exists).toBe(true);
  });

  it('should have required columns with correct types', async () => {
    const columns = await getTableColumns('agents');

    // Primary key - uses text but must be valid UUID format for checkpoint compatibility
    expect(hasColumn(columns, 'id', 'text')).toBe(true);

    // Foreign key to organization
    expect(hasColumn(columns, 'organization_id', 'uuid')).toBe(true);

    // Agent identity
    expect(hasColumn(columns, 'name', 'text')).toBe(true);
    expect(hasColumn(columns, 'description', 'text')).toBe(true);

    // Capabilities (array)
    expect(hasColumn(columns, 'capabilities', 'ARRAY')).toBe(true);

    // Status
    expect(hasColumn(columns, 'status', 'text')).toBe(true);

    // Settings (JSONB)
    expect(hasColumn(columns, 'settings', 'jsonb')).toBe(true);

    // Timestamps
    expect(hasColumn(columns, 'created_at')).toBe(true);
    expect(hasColumn(columns, 'updated_at')).toBe(true);
  });

  it('should have unique constraint on (organization_id, name)', async () => {
    const constraints = await getTableConstraints('agents');
    const hasUnique = constraints.some((c) => c.constraint_type === 'UNIQUE');
    expect(hasUnique).toBe(true);
  });

  it('should have indexes for common queries', async () => {
    const indexes = await getTableIndexes('agents');

    expect(hasIndex(indexes, 'idx_agents_organization')).toBe(true);
    expect(hasIndex(indexes, 'idx_agents_status')).toBe(true);
  });

  it('should have check constraint on status values', async () => {
    const constraints = await getTableConstraints('agents');
    const hasCheck = constraints.some((c) => c.constraint_type === 'CHECK');
    expect(hasCheck).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Politeness System Schema Tests - Sites Organization Link
// ─────────────────────────────────────────────────────────────────────────────

describe('Sites Table - Organization Link', () => {
  it('should have organization_id column', async () => {
    const columns = await getTableColumns('sites');
    expect(hasColumn(columns, 'organization_id', 'uuid')).toBe(true);
  });

  it('should have index on organization_id', async () => {
    const indexes = await getTableIndexes('sites');
    expect(hasIndex(indexes, 'idx_sites_organization')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Politeness System Schema Tests - Enhanced Checkpoints
// ─────────────────────────────────────────────────────────────────────────────

describe('Checkpoints Table - Agent Politeness Enhancements', () => {
  it('should have description column for detailed metadata', async () => {
    const columns = await getTableColumns('checkpoints');
    expect(hasColumn(columns, 'description', 'text')).toBe(true);
  });

  it('should have trigger column for tracking creation context', async () => {
    const columns = await getTableColumns('checkpoints');
    expect(hasColumn(columns, 'trigger', 'text')).toBe(true);
  });

  it('should have requested_by_id for human-requested agent work', async () => {
    const columns = await getTableColumns('checkpoints');
    expect(hasColumn(columns, 'requested_by_id', 'uuid')).toBe(true);
  });

  it('should have operation_type for categorizing agent operations', async () => {
    const columns = await getTableColumns('checkpoints');
    expect(hasColumn(columns, 'operation_type', 'text')).toBe(true);
  });

  it('should have affected_regions for JSON path tracking', async () => {
    const columns = await getTableColumns('checkpoints');
    expect(hasColumn(columns, 'affected_regions', 'jsonb')).toBe(true);
  });

  it('should have status for checkpoint completion tracking', async () => {
    const columns = await getTableColumns('checkpoints');
    expect(hasColumn(columns, 'status', 'text')).toBe(true);
  });

  it('should have rollback tracking columns', async () => {
    const columns = await getTableColumns('checkpoints');
    expect(hasColumn(columns, 'rolled_back_by_id', 'uuid')).toBe(true);
    expect(hasColumn(columns, 'rolled_back_at')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Seed Data Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Seed Data', () => {
  it('should have at least one test site', async () => {
    const result = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM app.sites
    `;
    expect(parseInt(result[0].count, 10)).toBeGreaterThanOrEqual(1);
  });

  it('should have at most one main branch per site', async () => {
    const result = await sql<{ site_id: string; main_count: string }[]>`
      SELECT site_id, COUNT(*) as main_count
      FROM app.branches
      WHERE is_main = true
      GROUP BY site_id
      HAVING COUNT(*) > 1
    `;
    // No site should have more than one main branch
    expect(result.length).toBe(0);
  });

  it('should have at least one main branch across all sites', async () => {
    const result = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM app.branches WHERE is_main = true
    `;
    expect(parseInt(result[0].count, 10)).toBeGreaterThanOrEqual(1);
  });

  it('should have at least one test document', async () => {
    const result = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM app.documents
    `;
    expect(parseInt(result[0].count, 10)).toBeGreaterThanOrEqual(1);
  });
});
