/**
 * Document Version Service: Provenance Field Mapping Tests (TDD - Red State)
 *
 * Tests for mapping provenance columns (source_branch_id, source_version_id,
 * published_to_version_id, source_branch_name) from database rows to
 * DocumentVersion domain objects.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Document Version provenance field mapping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  interface BaseRow {
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown>;
    source: string;
    created_by_id: string;
    created_by_type: string;
    created_at: string;
    is_published: boolean;
    is_tombstone: boolean;
    source_branch_id?: string | null;
    source_version_id?: string | null;
    published_to_version_id?: string | null;
    source_branch_name?: string | null;
  }

  function createBaseRow(overrides: Partial<BaseRow> = {}): BaseRow {
    return {
      id: 'ver-1',
      document_id: 'doc-1',
      branch_id: 'branch-1',
      version_number: 3,
      snapshot: { title: 'Hello' },
      source: 'edit',
      created_by_id: 'user-1',
      created_by_type: 'user',
      created_at: '2026-01-01T00:00:00.000Z',
      is_published: false,
      is_tombstone: false,
      ...overrides,
    };
  }

  describe('mapRowToDocumentVersion via getDocumentVersion', () => {
    it('should map source_branch_id to sourceBranchId', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createBaseRow({
            source_branch_id: 'branch-origin-uuid',
          }),
        ],
      });

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.sourceBranchId).toBe('branch-origin-uuid');
    });

    it('should map source_version_id to sourceVersionId', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createBaseRow({
            source_version_id: 'version-origin-uuid',
          }),
        ],
      });

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.sourceVersionId).toBe('version-origin-uuid');
    });

    it('should map published_to_version_id to publishedToVersionId', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createBaseRow({
            published_to_version_id: 'main-version-uuid',
          }),
        ],
      });

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.publishedToVersionId).toBe('main-version-uuid');
    });

    it('should map source_branch_name to sourceBranchName', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createBaseRow({
            source_branch_id: 'branch-origin-uuid',
            source_branch_name: 'feature/redesign',
          }),
        ],
      });

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.sourceBranchName).toBe('feature/redesign');
    });

    it('should return undefined for provenance fields when null', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createBaseRow({
            source_branch_id: null,
            source_version_id: null,
            published_to_version_id: null,
            source_branch_name: null,
          }),
        ],
      });

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.sourceBranchId).toBeUndefined();
      expect(result.sourceVersionId).toBeUndefined();
      expect(result.publishedToVersionId).toBeUndefined();
      expect(result.sourceBranchName).toBeUndefined();
    });
  });
});
