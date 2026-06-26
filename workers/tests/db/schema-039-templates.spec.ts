/**
 * Database Schema Tests for Migration 039: Template Support
 *
 * Tests for PROPOSAL-010 template and migration infrastructure.
 * Verifies template columns on documents, migration_jobs, and migration_conflicts tables.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

// Test database connection
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
// Helper functions
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

function hasColumn(columns: ColumnInfo[], name: string): boolean {
  return columns.some((col) => col.column_name === name);
}

function getColumn(columns: ColumnInfo[], name: string): ColumnInfo | undefined {
  return columns.find((col) => col.column_name === name);
}

function hasIndex(indexes: IndexInfo[], name: string): boolean {
  return indexes.some((idx) => idx.indexname === name);
}

function hasConstraint(
  constraints: ConstraintInfo[],
  name: string,
  type?: string,
): boolean {
  return constraints.some(
    (c) => c.constraint_name === name && (!type || c.constraint_type === type),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents Table Extensions
// ─────────────────────────────────────────────────────────────────────────────

describe('Migration 039: Documents Table Extensions', () => {
  it('should have template_id column', async () => {
    const columns = await getTableColumns('documents');
    const col = getColumn(columns, 'template_id');
    expect(col).toBeDefined();
    expect(col?.data_type).toBe('uuid');
    expect(col?.is_nullable).toBe('YES');
  });

  it('should have template_version column', async () => {
    const columns = await getTableColumns('documents');
    const col = getColumn(columns, 'template_version');
    expect(col).toBeDefined();
    expect(col?.data_type).toBe('integer');
    expect(col?.is_nullable).toBe('YES');
  });

  it('should have foreign key constraint on template_id', async () => {
    const constraints = await getTableConstraints('documents');
    const hasFk = constraints.some(
      (c) =>
        c.constraint_type === 'FOREIGN KEY' &&
        c.constraint_name.includes('template_id'),
    );
    expect(hasFk).toBe(true);
  });

  it('should have idx_documents_template index', async () => {
    const indexes = await getTableIndexes('documents');
    expect(hasIndex(indexes, 'idx_documents_template')).toBe(true);
  });

  it('idx_documents_template should be partial (WHERE template_id IS NOT NULL)', async () => {
    const indexes = await getTableIndexes('documents');
    const idx = indexes.find((i) => i.indexname === 'idx_documents_template');
    expect(idx?.indexdef).toContain('WHERE');
    expect(idx?.indexdef).toContain('template_id IS NOT NULL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration Jobs Table
// ─────────────────────────────────────────────────────────────────────────────

describe('Migration 039: migration_jobs Table', () => {
  it('should exist', async () => {
    expect(await tableExists('migration_jobs')).toBe(true);
  });

  it('should have correct columns', async () => {
    const columns = await getTableColumns('migration_jobs');
    expect(hasColumn(columns, 'id')).toBe(true);
    expect(hasColumn(columns, 'site_id')).toBe(true);
    expect(hasColumn(columns, 'branch_id')).toBe(true);
    expect(hasColumn(columns, 'template_id')).toBe(true);
    expect(hasColumn(columns, 'from_version')).toBe(true);
    expect(hasColumn(columns, 'to_version')).toBe(true);
    expect(hasColumn(columns, 'checkpoint_id')).toBe(true);
    expect(hasColumn(columns, 'status')).toBe(true);
    expect(hasColumn(columns, 'total_documents')).toBe(true);
    expect(hasColumn(columns, 'processed_documents')).toBe(true);
    expect(hasColumn(columns, 'created_by_id')).toBe(true);
    expect(hasColumn(columns, 'created_by_type')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
    expect(hasColumn(columns, 'completed_at')).toBe(true);
  });

  it('should have primary key on id', async () => {
    const constraints = await getTableConstraints('migration_jobs');
    expect(hasConstraint(constraints, 'migration_jobs_pkey', 'PRIMARY KEY')).toBe(
      true,
    );
  });

  it('should have foreign key to sites', async () => {
    const constraints = await getTableConstraints('migration_jobs');
    const hasFk = constraints.some(
      (c) =>
        c.constraint_type === 'FOREIGN KEY' && c.constraint_name.includes('site_id'),
    );
    expect(hasFk).toBe(true);
  });

  it('should have foreign key to branches', async () => {
    const constraints = await getTableConstraints('migration_jobs');
    const hasFk = constraints.some(
      (c) =>
        c.constraint_type === 'FOREIGN KEY' &&
        c.constraint_name.includes('branch_id'),
    );
    expect(hasFk).toBe(true);
  });

  it('should have foreign key to documents (template_id)', async () => {
    const constraints = await getTableConstraints('migration_jobs');
    const hasFk = constraints.some(
      (c) =>
        c.constraint_type === 'FOREIGN KEY' &&
        c.constraint_name.includes('template_id'),
    );
    expect(hasFk).toBe(true);
  });

  it('should have foreign key to checkpoints (checkpoint_id)', async () => {
    const constraints = await getTableConstraints('migration_jobs');
    const hasFk = constraints.some(
      (c) =>
        c.constraint_type === 'FOREIGN KEY' &&
        c.constraint_name.includes('checkpoint_id'),
    );
    expect(hasFk).toBe(true);
  });

  it('should have CHECK constraint on status', async () => {
    const constraints = await getTableConstraints('migration_jobs');
    const hasCheck = constraints.some(
      (c) => c.constraint_type === 'CHECK' && c.constraint_name.includes('status'),
    );
    expect(hasCheck).toBe(true);
  });

  it('should have idx_migration_jobs_branch index', async () => {
    const indexes = await getTableIndexes('migration_jobs');
    expect(hasIndex(indexes, 'idx_migration_jobs_branch')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration Conflicts Table
// ─────────────────────────────────────────────────────────────────────────────

describe('Migration 039: migration_conflicts Table', () => {
  it('should exist', async () => {
    expect(await tableExists('migration_conflicts')).toBe(true);
  });

  it('should have correct columns', async () => {
    const columns = await getTableColumns('migration_conflicts');
    expect(hasColumn(columns, 'id')).toBe(true);
    expect(hasColumn(columns, 'migration_job_id')).toBe(true);
    expect(hasColumn(columns, 'document_id')).toBe(true);
    expect(hasColumn(columns, 'branch_id')).toBe(true);
    expect(hasColumn(columns, 'template_id')).toBe(true);
    expect(hasColumn(columns, 'from_version')).toBe(true);
    expect(hasColumn(columns, 'to_version')).toBe(true);
    expect(hasColumn(columns, 'template_delta')).toBe(true);
    expect(hasColumn(columns, 'document_actions')).toBe(true);
    expect(hasColumn(columns, 'resolution')).toBe(true);
    expect(hasColumn(columns, 'created_at')).toBe(true);
    expect(hasColumn(columns, 'resolved_at')).toBe(true);
  });

  it('should have primary key on id', async () => {
    const constraints = await getTableConstraints('migration_conflicts');
    expect(
      hasConstraint(constraints, 'migration_conflicts_pkey', 'PRIMARY KEY'),
    ).toBe(true);
  });

  it('should have foreign key to migration_jobs', async () => {
    const constraints = await getTableConstraints('migration_conflicts');
    const hasFk = constraints.some(
      (c) =>
        c.constraint_type === 'FOREIGN KEY' &&
        c.constraint_name.includes('migration_job_id'),
    );
    expect(hasFk).toBe(true);
  });

  it('should have foreign key to documents', async () => {
    const constraints = await getTableConstraints('migration_conflicts');
    const hasFk = constraints.some(
      (c) =>
        c.constraint_type === 'FOREIGN KEY' &&
        c.constraint_name.includes('document_id'),
    );
    expect(hasFk).toBe(true);
  });

  it('should have foreign key to branches', async () => {
    const constraints = await getTableConstraints('migration_conflicts');
    const hasFk = constraints.some(
      (c) =>
        c.constraint_type === 'FOREIGN KEY' &&
        c.constraint_name.includes('branch_id'),
    );
    expect(hasFk).toBe(true);
  });

  it('should have CHECK constraint on resolution', async () => {
    const constraints = await getTableConstraints('migration_conflicts');
    const hasCheck = constraints.some(
      (c) =>
        c.constraint_type === 'CHECK' && c.constraint_name.includes('resolution'),
    );
    expect(hasCheck).toBe(true);
  });

  it('should have idx_migration_conflicts_job index', async () => {
    const indexes = await getTableIndexes('migration_conflicts');
    expect(hasIndex(indexes, 'idx_migration_conflicts_job')).toBe(true);
  });

  it('should have idx_migration_conflicts_unresolved index', async () => {
    const indexes = await getTableIndexes('migration_conflicts');
    expect(hasIndex(indexes, 'idx_migration_conflicts_unresolved')).toBe(true);
  });

  it('idx_migration_conflicts_unresolved should be partial (WHERE resolution IS NULL)', async () => {
    const indexes = await getTableIndexes('migration_conflicts');
    const idx = indexes.find(
      (i) => i.indexname === 'idx_migration_conflicts_unresolved',
    );
    expect(idx?.indexdef).toContain('WHERE');
    expect(idx?.indexdef).toContain('resolution IS NULL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Database Constraints - Migration 039
// ─────────────────────────────────────────────────────────────────────────────

describe('Database Constraints - Migration 039', () => {
  const TEST_SITE_ID = 'f0f0f0f0-0039-4000-a000-000000000001';
  const TEST_BRANCH_ID = 'f0f0f0f0-0039-4000-a000-000000000002';
  const TEST_CHECKPOINT_ID = 'f0f0f0f0-0039-4000-a000-000000000003';
  const SYSTEM_USER_ID = 'f0f0f0f0-0039-4000-a000-000000000004';

  beforeAll(async () => {
    await sql`
      INSERT INTO app.sites (id, pantheon_site_id, name, workflow_settings)
      VALUES (${TEST_SITE_ID}, 'site-039-test', 'Test Site 039', '{}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO app.branches (id, site_id, name, status, is_main, created_by_id, created_by_type)
      VALUES (${TEST_BRANCH_ID}, ${TEST_SITE_ID}, 'main', 'active', true, ${SYSTEM_USER_ID}, 'system')
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO app.checkpoints (id, branch_id, name, checkpoint_type, created_by_id, created_by_type)
      VALUES (${TEST_CHECKPOINT_ID}, ${TEST_BRANCH_ID}, 'Test Checkpoint', 'manual', ${SYSTEM_USER_ID}, 'system')
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM app.migration_conflicts WHERE migration_job_id IN (SELECT id FROM app.migration_jobs WHERE site_id = ${TEST_SITE_ID})`;
    await sql`DELETE FROM app.migration_jobs WHERE site_id = ${TEST_SITE_ID}`;
    await sql`DELETE FROM app.documents WHERE site_id = ${TEST_SITE_ID}`;
    await sql`DELETE FROM app.checkpoints WHERE id = ${TEST_CHECKPOINT_ID}`;
    await sql`DELETE FROM app.branches WHERE id = ${TEST_BRANCH_ID}`;
    await sql`DELETE FROM app.sites WHERE id = ${TEST_SITE_ID}`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Template FK Constraints on Documents Table
  // ───────────────────────────────────────────────────────────────────────────

  describe('Documents.template_id Foreign Key Constraints', () => {
    it('should prevent template_id FK violation (non-existent document)', async () => {
      await expect(
        sql`
          INSERT INTO app.documents (site_id, path, template_id)
          VALUES (
            ${TEST_SITE_ID},
            '/test/fk-violation',
            '00000000-0000-0000-0000-000000000099'::uuid
          )
        `,
      ).rejects.toThrow(/foreign key constraint|violates foreign key/i);
    });

    it('should allow template_id pointing to regular document (FK constraint only)', async () => {
      // First create a regular document (not a template)
      const regularDocResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/pages/regular-doc')
        RETURNING id
      `;
      const regularDocId = regularDocResult[0].id;

      try {
        // This should succeed - FK only checks documents table, not path
        const result = await sql<{ id: string }[]>`
          INSERT INTO app.documents (site_id, path, template_id)
          VALUES (${TEST_SITE_ID}, '/pages/using-non-template', ${regularDocId})
          RETURNING id
        `;

        expect(result.length).toBe(1);
        expect(result[0].id).toBeDefined();

        // Note: Path enforcement (/templates/*) is application-level, not DB-level

        // Cleanup
        await sql`DELETE FROM app.documents WHERE id = ${result[0].id}`;
      } finally {
        await sql`DELETE FROM app.documents WHERE id = ${regularDocId}`;
      }
    });

    it('should allow NULL template_version with non-NULL template_id', async () => {
      // Create a template document
      const templateResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/templates/test-template')
        RETURNING id
      `;
      const templateId = templateResult[0].id;

      try {
        // This should succeed - both columns are independently nullable
        const result = await sql<{ id: string }[]>`
          INSERT INTO app.documents (site_id, path, template_id, template_version)
          VALUES (${TEST_SITE_ID}, '/pages/inconsistent', ${templateId}, NULL)
          RETURNING id
        `;

        expect(result.length).toBe(1);

        // Note: Application should enforce both-or-neither constraint

        // Cleanup
        await sql`DELETE FROM app.documents WHERE id = ${result[0].id}`;
      } finally {
        await sql`DELETE FROM app.documents WHERE id = ${templateId}`;
      }
    });

    it('should allow negative template_version (no CHECK constraint)', async () => {
      // Create a template document
      const templateResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/templates/version-template')
        RETURNING id
      `;
      const templateId = templateResult[0].id;

      try {
        // This should succeed - no CHECK constraint on template_version
        const result = await sql<{ id: string; template_version: number }[]>`
          INSERT INTO app.documents (site_id, path, template_id, template_version)
          VALUES (${TEST_SITE_ID}, '/pages/negative-version', ${templateId}, -1)
          RETURNING id, template_version
        `;

        expect(result.length).toBe(1);
        expect(result[0].template_version).toBe(-1);

        // Note: Application should validate positive versions

        // Cleanup
        await sql`DELETE FROM app.documents WHERE id = ${result[0].id}`;
      } finally {
        await sql`DELETE FROM app.documents WHERE id = ${templateId}`;
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Migration Jobs FK Constraints
  // ───────────────────────────────────────────────────────────────────────────

  describe('migration_jobs Foreign Key Constraints', () => {
    it('should prevent template_id FK violation (non-existent template)', async () => {
      await expect(
        sql`
          INSERT INTO app.migration_jobs (
            site_id,
            branch_id,
            template_id,
            from_version,
            to_version,
            checkpoint_id,
            status,
            created_by_id,
            created_by_type
          )
          VALUES (
            ${TEST_SITE_ID},
            ${TEST_BRANCH_ID},
            '00000000-0000-0000-0000-000000000099'::uuid,
            1,
            2,
            ${TEST_CHECKPOINT_ID},
            'pending',
            ${SYSTEM_USER_ID},
            'system'
          )
        `,
      ).rejects.toThrow(/foreign key constraint|violates foreign key/i);
    });

    it('should prevent checkpoint_id FK violation (non-existent checkpoint)', async () => {
      // Create a template first
      const templateResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/templates/job-template')
        RETURNING id
      `;
      const templateId = templateResult[0].id;

      try {
        await expect(
          sql`
            INSERT INTO app.migration_jobs (
              site_id,
              branch_id,
              template_id,
              from_version,
              to_version,
              checkpoint_id,
              status,
              created_by_id,
              created_by_type
            )
            VALUES (
              ${TEST_SITE_ID},
              ${TEST_BRANCH_ID},
              ${templateId},
              1,
              2,
              '00000000-0000-0000-0000-000000000099'::uuid,
              'pending',
              ${SYSTEM_USER_ID},
              'system'
            )
          `,
        ).rejects.toThrow(/foreign key constraint|violates foreign key/i);
      } finally {
        await sql`DELETE FROM app.documents WHERE id = ${templateId}`;
      }
    });

    it('should enforce status CHECK constraint (invalid status)', async () => {
      // Create a template first
      const templateResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/templates/status-template')
        RETURNING id
      `;
      const templateId = templateResult[0].id;

      try {
        await expect(
          sql`
            INSERT INTO app.migration_jobs (
              site_id,
              branch_id,
              template_id,
              from_version,
              to_version,
              checkpoint_id,
              status,
              created_by_id,
              created_by_type
            )
            VALUES (
              ${TEST_SITE_ID},
              ${TEST_BRANCH_ID},
              ${templateId},
              1,
              2,
              ${TEST_CHECKPOINT_ID},
              'invalid_status',
              ${SYSTEM_USER_ID},
              'system'
            )
          `,
        ).rejects.toThrow(/check constraint|invalid input value/i);
      } finally {
        await sql`DELETE FROM app.documents WHERE id = ${templateId}`;
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Migration Conflicts FK Constraints and Cascades
  // ───────────────────────────────────────────────────────────────────────────

  describe('migration_conflicts Foreign Key Constraints and Cascades', () => {
    it('should prevent deleting migration_job while conflicts reference it', async () => {
      const templateResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/templates/cascade-template')
        RETURNING id
      `;
      const templateId = templateResult[0].id;

      const docResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/pages/cascade-doc')
        RETURNING id
      `;
      const docId = docResult[0].id;

      try {
        const jobResult = await sql<{ id: string }[]>`
          INSERT INTO app.migration_jobs (
            site_id,
            branch_id,
            template_id,
            from_version,
            to_version,
            checkpoint_id,
            status,
            created_by_id,
            created_by_type
          )
          VALUES (
            ${TEST_SITE_ID},
            ${TEST_BRANCH_ID},
            ${templateId},
            1,
            2,
            ${TEST_CHECKPOINT_ID},
            'pending',
            ${SYSTEM_USER_ID},
            'system'
          )
          RETURNING id
        `;
        const jobId = jobResult[0].id;

        await sql`
          INSERT INTO app.migration_conflicts (
            migration_job_id,
            document_id,
            branch_id,
            template_id,
            from_version,
            to_version,
            template_delta,
            document_actions
          )
          VALUES (
            ${jobId},
            ${docId},
            ${TEST_BRANCH_ID},
            ${templateId},
            1,
            2,
            '[]'::jsonb,
            '[]'::jsonb
          )
        `;

        await expect(
          sql`DELETE FROM app.migration_jobs WHERE id = ${jobId}`,
        ).rejects.toThrow(/foreign key constraint|violates foreign key/i);
      } finally {
        await sql`DELETE FROM app.migration_conflicts WHERE document_id = ${docId}`;
        await sql`DELETE FROM app.migration_jobs WHERE template_id = ${templateId}`;
        await sql`DELETE FROM app.documents WHERE id = ${docId}`;
        await sql`DELETE FROM app.documents WHERE id = ${templateId}`;
      }
    });

    it('should enforce resolution CHECK constraint (invalid resolution)', async () => {
      // Create template
      const templateResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/templates/resolution-template')
        RETURNING id
      `;
      const templateId = templateResult[0].id;

      // Create document
      const docResult = await sql<{ id: string }[]>`
        INSERT INTO app.documents (site_id, path)
        VALUES (${TEST_SITE_ID}, '/pages/resolution-doc')
        RETURNING id
      `;
      const docId = docResult[0].id;

      try {
        // Create migration_job
        const jobResult = await sql<{ id: string }[]>`
          INSERT INTO app.migration_jobs (
            site_id,
            branch_id,
            template_id,
            from_version,
            to_version,
            checkpoint_id,
            status,
            created_by_id,
            created_by_type
          )
          VALUES (
            ${TEST_SITE_ID},
            ${TEST_BRANCH_ID},
            ${templateId},
            1,
            2,
            ${TEST_CHECKPOINT_ID},
            'pending',
            ${SYSTEM_USER_ID},
            'system'
          )
          RETURNING id
        `;
        const jobId = jobResult[0].id;

        try {
          // Try to create conflict with invalid resolution
          await expect(
            sql`
              INSERT INTO app.migration_conflicts (
                migration_job_id,
                document_id,
                branch_id,
                template_id,
                from_version,
                to_version,
                template_delta,
                document_actions,
                resolution
              )
              VALUES (
                ${jobId},
                ${docId},
                ${TEST_BRANCH_ID},
                ${templateId},
                1,
                2,
                '[]'::jsonb,
                '[]'::jsonb,
                'invalid_resolution'
              )
            `,
          ).rejects.toThrow(/check constraint|invalid input value/i);
        } finally {
          await sql`DELETE FROM app.migration_jobs WHERE id = ${jobId}`;
        }
      } finally {
        await sql`DELETE FROM app.documents WHERE id = ${docId}`;
        await sql`DELETE FROM app.documents WHERE id = ${templateId}`;
      }
    });
  });
});
