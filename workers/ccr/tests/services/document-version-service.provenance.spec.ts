/**
 * Document Version Service: Provenance Field Mapping Tests (TDD - Red State)
 *
 * Tests for mapping provenance columns (source_branch_id, source_version_id,
 * published_to_version_id, source_branch_name) from database rows to
 * DocumentVersion domain objects.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentVersions } from '../../src/db/schema';

describe('Document Version provenance field mapping', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  type BaseRow = {
    id: string;
    documentId: string;
    branchId: string;
    versionNumber: number;
    snapshot: Record<string, unknown>;
    source: string;
    createdById: string;
    createdByType: string;
    createdAt: Date;
    isPublished: boolean;
    isTombstone: boolean;
    sourceBranchId?: string | null;
    sourceVersionId?: string | null;
    publishedToVersionId?: string | null;
    sourceBranchName?: string | null;
  };

  function createBaseRow(overrides: Partial<BaseRow> = {}): BaseRow {
    return {
      id: 'ver-1',
      documentId: 'doc-1',
      branchId: 'branch-1',
      versionNumber: 3,
      snapshot: { title: 'Hello' },
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      isPublished: false,
      isTombstone: false,
      sourceBranchId: null,
      sourceVersionId: null,
      publishedToVersionId: null,
      sourceBranchName: null,
      ...overrides,
    };
  }

  describe('mapRowToDocumentVersion via getDocumentVersion', () => {
    it('should map source_branch_id to sourceBranchId', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );

      database.on(documentVersions).select.returnsRaw([
        createBaseRow({ sourceBranchId: 'branch-origin-uuid' }),
      ]);

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.sourceBranchId).toBe('branch-origin-uuid');
    });

    it('should map source_version_id to sourceVersionId', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );

      database.on(documentVersions).select.returnsRaw([
        createBaseRow({ sourceVersionId: 'version-origin-uuid' }),
      ]);

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.sourceVersionId).toBe('version-origin-uuid');
    });

    it('should map published_to_version_id to publishedToVersionId', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );

      database.on(documentVersions).select.returnsRaw([
        createBaseRow({ publishedToVersionId: 'main-version-uuid' }),
      ]);

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.publishedToVersionId).toBe('main-version-uuid');
    });

    it('should map source_branch_name to sourceBranchName', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );

      database.on(documentVersions).select.returnsRaw([
        createBaseRow({
          sourceBranchId: 'branch-origin-uuid',
          sourceBranchName: 'feature/redesign',
        }),
      ]);

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      if (result === null) throw new Error('Expected non-null result');
      expect(result.sourceBranchName).toBe('feature/redesign');
    });

    it('should return undefined for provenance fields when null', async () => {
      const { getDocumentVersion } = await import(
        '../../src/services/document-version-service'
      );

      database.on(documentVersions).select.returnsRaw([createBaseRow()]);

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
