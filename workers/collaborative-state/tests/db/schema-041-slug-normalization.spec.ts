/**
 * Database Schema Tests for Migration 041: Case-Insensitive Slugs and Paths
 *
 * Verifies that the migration correctly normalized all slugs and paths:
 * - Lowercased all values
 * - Replaced invalid characters with hyphens
 * - No duplicate slugs after normalization
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

describe('Migration 041: Slug and Path Normalization', () => {
  describe('branch_structure_state', () => {
    it('should have no uppercase slugs', async () => {
      const rows = await sql`
        SELECT branch_id, slug
        FROM app.branch_structure_state
        WHERE slug != LOWER(slug)
      `;
      expect(rows).toHaveLength(0);
    });

    it('should have no slugs with invalid characters', async () => {
      const rows = await sql`
        SELECT branch_id, slug
        FROM app.branch_structure_state
        WHERE slug !~ '^[a-z0-9._-]+$'
      `;
      expect(rows).toHaveLength(0);
    });

    it('should have no duplicate slugs per branch after normalization', async () => {
      const rows = await sql`
        SELECT branch_id, slug, COUNT(*) as cnt
        FROM app.branch_structure_state
        GROUP BY branch_id, slug
        HAVING COUNT(*) > 1
      `;
      expect(rows).toHaveLength(0);
    });
  });

  describe('structure_nodes', () => {
    it('should have no uppercase slugs', async () => {
      const rows = await sql`
        SELECT structure_id, slug
        FROM app.structure_nodes
        WHERE slug != LOWER(slug)
      `;
      expect(rows).toHaveLength(0);
    });

    it('should have no slugs with invalid characters', async () => {
      const rows = await sql`
        SELECT structure_id, slug
        FROM app.structure_nodes
        WHERE slug !~ '^[a-z0-9._-]+$'
      `;
      expect(rows).toHaveLength(0);
    });

    it('should have no duplicate slugs per structure and parent after normalization', async () => {
      const rows = await sql`
        SELECT structure_id, parent_node_id, slug, COUNT(*) as cnt
        FROM app.structure_nodes
        GROUP BY structure_id, parent_node_id, slug
        HAVING COUNT(*) > 1
      `;
      expect(rows).toHaveLength(0);
    });
  });

  describe('documents', () => {
    it('should have no uppercase paths', async () => {
      const rows = await sql`
        SELECT site_id, path
        FROM app.documents
        WHERE path != LOWER(path)
      `;
      expect(rows).toHaveLength(0);
    });
  });
});
