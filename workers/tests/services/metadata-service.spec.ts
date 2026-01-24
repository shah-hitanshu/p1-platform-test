/**
 * Phase 6.2: Metadata Service Tests (TDD)
 *
 * Tests for branch structure state and document metadata management
 * with JSON Schema validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 6.2: Metadata Service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Branch Structure State CRUD
  // ===========================================================================

  describe('getBranchStructureState', () => {
    it('should return structure state for a branch', async () => {
      const { getBranchStructureState } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            structure_tree: JSON.stringify([]),
            metadata_schema: JSON.stringify({
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            }),
            schema_enforcement: 'warn',
            has_changes_since_checkpoint: false,
            last_modified_at: '2026-01-24T10:00:00.000Z',
            last_modified_by: 'user-1',
          },
        ],
      });

      const state = await getBranchStructureState('branch-1', 'struct-1');

      expect(state).not.toBeNull();
      expect(state?.branchId).toBe('branch-1');
      expect(state?.structureId).toBe('struct-1');
      expect(state?.schemaEnforcement).toBe('warn');
      expect(state?.metadataSchema).toEqual({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      });
    });

    it('should return null when structure state does not exist', async () => {
      const { getBranchStructureState } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const state = await getBranchStructureState('branch-1', 'nonexistent');

      expect(state).toBeNull();
    });
  });

  describe('createBranchStructureState', () => {
    it('should create structure state with default schema', async () => {
      const { createBranchStructureState } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            structure_tree: JSON.stringify([]),
            metadata_schema: JSON.stringify({
              type: 'object',
              properties: {
                title: { type: 'string', maxLength: 100 },
                description: { type: 'string', maxLength: 300 },
              },
              required: ['title'],
            }),
            schema_enforcement: 'warn',
            has_changes_since_checkpoint: false,
            last_modified_at: '2026-01-24T10:00:00.000Z',
            last_modified_by: null,
          },
        ],
      });

      const state = await createBranchStructureState({
        branchId: 'branch-1',
        structureId: 'struct-1',
      });

      expect(state.branchId).toBe('branch-1');
      expect(state.structureId).toBe('struct-1');
      expect(state.schemaEnforcement).toBe('warn');
    });

    it('should create structure state with custom schema', async () => {
      const { createBranchStructureState } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      const customSchema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          publishDate: { type: 'string', format: 'date' },
        },
        required: ['title', 'author'],
      };

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            structure_tree: JSON.stringify([]),
            metadata_schema: JSON.stringify(customSchema),
            schema_enforcement: 'strict',
            has_changes_since_checkpoint: false,
            last_modified_at: '2026-01-24T10:00:00.000Z',
            last_modified_by: 'user-1',
          },
        ],
      });

      const state = await createBranchStructureState({
        branchId: 'branch-1',
        structureId: 'struct-1',
        metadataSchema: customSchema,
        schemaEnforcement: 'strict',
        modifiedById: 'user-1',
      });

      expect(state.metadataSchema).toEqual(customSchema);
      expect(state.schemaEnforcement).toBe('strict');
    });
  });

  describe('updateBranchStructureState', () => {
    it('should update metadata schema', async () => {
      const { updateBranchStructureState } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      const newSchema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string', enum: ['blog', 'news', 'tutorial'] },
        },
        required: ['title', 'category'],
      };

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            structure_tree: JSON.stringify([]),
            metadata_schema: JSON.stringify(newSchema),
            schema_enforcement: 'warn',
            has_changes_since_checkpoint: true,
            last_modified_at: '2026-01-24T11:00:00.000Z',
            last_modified_by: 'user-1',
          },
        ],
      });

      const state = await updateBranchStructureState('branch-1', 'struct-1', {
        metadataSchema: newSchema,
        modifiedById: 'user-1',
      });

      expect(state.metadataSchema).toEqual(newSchema);
      expect(state.hasChangesSinceCheckpoint).toBe(true);
    });

    it('should update schema enforcement mode', async () => {
      const { updateBranchStructureState } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            structure_tree: JSON.stringify([]),
            metadata_schema: JSON.stringify({ type: 'object' }),
            schema_enforcement: 'strict',
            has_changes_since_checkpoint: true,
            last_modified_at: '2026-01-24T11:00:00.000Z',
            last_modified_by: 'user-1',
          },
        ],
      });

      const state = await updateBranchStructureState('branch-1', 'struct-1', {
        schemaEnforcement: 'strict',
        modifiedById: 'user-1',
      });

      expect(state.schemaEnforcement).toBe('strict');
    });

    it('should throw error when structure state does not exist', async () => {
      const { updateBranchStructureState, BranchStructureStateNotFoundError } =
        await import('../../src/services/metadata-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(
        updateBranchStructureState('branch-1', 'nonexistent', {
          schemaEnforcement: 'strict',
        }),
      ).rejects.toThrow(BranchStructureStateNotFoundError);
    });
  });

  describe('deleteBranchStructureState', () => {
    it('should delete structure state', async () => {
      const { deleteBranchStructureState } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ branch_id: 'branch-1', structure_id: 'struct-1' }],
      });

      await deleteBranchStructureState('branch-1', 'struct-1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.arrayContaining(['branch-1', 'struct-1']),
      );
    });

    it('should throw error when structure state does not exist', async () => {
      const { deleteBranchStructureState, BranchStructureStateNotFoundError } =
        await import('../../src/services/metadata-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(
        deleteBranchStructureState('branch-1', 'nonexistent'),
      ).rejects.toThrow(BranchStructureStateNotFoundError);
    });
  });

  // ===========================================================================
  // Document Metadata CRUD
  // ===========================================================================

  describe('getDocumentMetadata', () => {
    it('should return document metadata', async () => {
      const { getDocumentMetadata } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            document_id: 'doc-1',
            metadata: JSON.stringify({
              title: 'My Document',
              author: 'John Doe',
            }),
            conforms_to_schema: true,
            validation_errors: JSON.stringify([]),
            last_modified_at: '2026-01-24T10:00:00.000Z',
            last_modified_by: 'user-1',
          },
        ],
      });

      const metadata = await getDocumentMetadata(
        'branch-1',
        'struct-1',
        'doc-1',
      );

      expect(metadata).not.toBeNull();
      expect(metadata?.documentId).toBe('doc-1');
      expect(metadata?.metadata).toEqual({
        title: 'My Document',
        author: 'John Doe',
      });
      expect(metadata?.conformsToSchema).toBe(true);
    });

    it('should return null when document metadata does not exist', async () => {
      const { getDocumentMetadata } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const metadata = await getDocumentMetadata(
        'branch-1',
        'struct-1',
        'nonexistent',
      );

      expect(metadata).toBeNull();
    });
  });

  describe('setDocumentMetadata', () => {
    it('should create document metadata with validation', async () => {
      const { setDocumentMetadata } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      // First query: get branch structure state for schema
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            metadata_schema: JSON.stringify({
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            }),
            schema_enforcement: 'warn',
          },
        ],
      });

      // Second query: upsert metadata
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            document_id: 'doc-1',
            metadata: JSON.stringify({ title: 'New Document' }),
            conforms_to_schema: true,
            validation_errors: JSON.stringify([]),
            last_modified_at: '2026-01-24T10:00:00.000Z',
            last_modified_by: 'user-1',
          },
        ],
      });

      const result = await setDocumentMetadata({
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'doc-1',
        metadata: { title: 'New Document' },
        modifiedById: 'user-1',
      });

      expect(result.documentId).toBe('doc-1');
      expect(result.conformsToSchema).toBe(true);
      expect(result.validationErrors).toEqual([]);
    });

    it('should flag non-conforming metadata in warn mode', async () => {
      const { setDocumentMetadata } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      // First query: get branch structure state for schema
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            metadata_schema: JSON.stringify({
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            }),
            schema_enforcement: 'warn',
          },
        ],
      });

      // Second query: upsert metadata with validation errors
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            document_id: 'doc-1',
            metadata: JSON.stringify({}),
            conforms_to_schema: false,
            validation_errors: JSON.stringify([
              { field: 'title', message: "must have required property 'title'" },
            ]),
            last_modified_at: '2026-01-24T10:00:00.000Z',
            last_modified_by: 'user-1',
          },
        ],
      });

      const result = await setDocumentMetadata({
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'doc-1',
        metadata: {},
        modifiedById: 'user-1',
      });

      expect(result.conformsToSchema).toBe(false);
      expect(result.validationErrors.length).toBeGreaterThan(0);
    });

    it('should throw error for non-conforming metadata in strict mode', async () => {
      const { setDocumentMetadata, SchemaValidationError } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      // First query: get branch structure state for schema
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            metadata_schema: JSON.stringify({
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            }),
            schema_enforcement: 'strict',
          },
        ],
      });

      await expect(
        setDocumentMetadata({
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-1',
          metadata: {}, // Missing required 'title'
          modifiedById: 'user-1',
        }),
      ).rejects.toThrow(SchemaValidationError);
    });

    it('should skip validation in none mode', async () => {
      const { setDocumentMetadata } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      // First query: get branch structure state for schema
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            metadata_schema: JSON.stringify({
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            }),
            schema_enforcement: 'none',
          },
        ],
      });

      // Second query: upsert metadata (no validation)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            document_id: 'doc-1',
            metadata: JSON.stringify({}),
            conforms_to_schema: true,
            validation_errors: JSON.stringify([]),
            last_modified_at: '2026-01-24T10:00:00.000Z',
            last_modified_by: 'user-1',
          },
        ],
      });

      const result = await setDocumentMetadata({
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'doc-1',
        metadata: {}, // Missing required 'title' but skipped validation
        modifiedById: 'user-1',
      });

      expect(result.conformsToSchema).toBe(true);
    });
  });

  describe('deleteDocumentMetadata', () => {
    it('should delete document metadata', async () => {
      const { deleteDocumentMetadata } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            document_id: 'doc-1',
          },
        ],
      });

      await deleteDocumentMetadata('branch-1', 'struct-1', 'doc-1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.arrayContaining(['branch-1', 'struct-1', 'doc-1']),
      );
    });

    it('should throw error when document metadata does not exist', async () => {
      const { deleteDocumentMetadata, DocumentMetadataNotFoundError } =
        await import('../../src/services/metadata-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(
        deleteDocumentMetadata('branch-1', 'struct-1', 'nonexistent'),
      ).rejects.toThrow(DocumentMetadataNotFoundError);
    });
  });

  describe('listDocumentMetadata', () => {
    it('should list all document metadata in a structure', async () => {
      const { listDocumentMetadata } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            document_id: 'doc-1',
            metadata: JSON.stringify({ title: 'Doc 1' }),
            conforms_to_schema: true,
            validation_errors: JSON.stringify([]),
            last_modified_at: '2026-01-24T10:00:00.000Z',
            last_modified_by: 'user-1',
          },
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            document_id: 'doc-2',
            metadata: JSON.stringify({ title: 'Doc 2' }),
            conforms_to_schema: false,
            validation_errors: JSON.stringify([{ field: 'author', message: 'required' }]),
            last_modified_at: '2026-01-24T11:00:00.000Z',
            last_modified_by: 'user-2',
          },
        ],
      });

      const metadataList = await listDocumentMetadata({
        branchId: 'branch-1',
        structureId: 'struct-1',
      });

      expect(metadataList).toHaveLength(2);
      expect(metadataList[0].documentId).toBe('doc-1');
      expect(metadataList[1].documentId).toBe('doc-2');
    });

    it('should filter by conformance status', async () => {
      const { listDocumentMetadata } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            document_id: 'doc-2',
            metadata: JSON.stringify({ title: 'Doc 2' }),
            conforms_to_schema: false,
            validation_errors: JSON.stringify([{ field: 'author', message: 'required' }]),
            last_modified_at: '2026-01-24T11:00:00.000Z',
            last_modified_by: 'user-2',
          },
        ],
      });

      const metadataList = await listDocumentMetadata({
        branchId: 'branch-1',
        structureId: 'struct-1',
        conformsToSchema: false,
      });

      expect(metadataList).toHaveLength(1);
      expect(metadataList[0].conformsToSchema).toBe(false);
    });
  });

  // ===========================================================================
  // Schema Validation
  // ===========================================================================

  describe('validateMetadata', () => {
    it('should validate conforming metadata', async () => {
      const { validateMetadata } = await import(
        '../../src/services/metadata-service'
      );

      const schema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['title'],
      };

      const result = validateMetadata({ title: 'Test', count: 5 }, schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return errors for non-conforming metadata', async () => {
      const { validateMetadata } = await import(
        '../../src/services/metadata-service'
      );

      const schema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['title'],
      };

      const result = validateMetadata({ count: 'not a number' }, schema);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate type constraints', async () => {
      const { validateMetadata } = await import(
        '../../src/services/metadata-service'
      );

      const schema = {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 10 },
        },
        required: ['title'],
      };

      const result = validateMetadata(
        { title: 'This is way too long for the schema' },
        schema,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('maxLength'))).toBe(
        true,
      );
    });

    it('should validate enum constraints', async () => {
      const { validateMetadata } = await import(
        '../../src/services/metadata-service'
      );

      const schema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['draft', 'published', 'archived'] },
        },
        required: ['status'],
      };

      const result = validateMetadata({ status: 'invalid' }, schema);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('enum'))).toBe(true);
    });
  });

  describe('validateAllDocuments', () => {
    it('should validate all documents against schema', async () => {
      const { validateAllDocuments } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      // First query: get structure state with schema
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            branch_id: 'branch-1',
            structure_id: 'struct-1',
            metadata_schema: JSON.stringify({
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            }),
            schema_enforcement: 'warn',
          },
        ],
      });

      // Second query: get all document metadata with document paths
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            document_id: 'doc-1',
            document_path: 'pages/home',
            metadata: JSON.stringify({ title: 'Home' }),
          },
          {
            document_id: 'doc-2',
            document_path: 'pages/about',
            metadata: JSON.stringify({}), // Missing title
          },
          {
            document_id: 'doc-3',
            document_path: 'pages/contact',
            metadata: JSON.stringify({ title: 'Contact' }),
          },
        ],
      });

      // Third query: update validation state for each document
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await validateAllDocuments('branch-1', 'struct-1');

      expect(result.structureId).toBe('struct-1');
      expect(result.totalDocuments).toBe(3);
      expect(result.conformingDocuments).toBe(2);
      expect(result.nonConformingDocuments).toHaveLength(1);
      expect(result.nonConformingDocuments[0].documentId).toBe('doc-2');
    });

    it('should throw error when structure state does not exist', async () => {
      const { validateAllDocuments, BranchStructureStateNotFoundError } =
        await import('../../src/services/metadata-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(
        validateAllDocuments('branch-1', 'nonexistent'),
      ).rejects.toThrow(BranchStructureStateNotFoundError);
    });
  });

  describe('getSchemaValidationSummary', () => {
    it('should return validation summary for a structure', async () => {
      const { getSchemaValidationSummary } = await import(
        '../../src/services/metadata-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            total_documents: '10',
            conforming_documents: '7',
          },
        ],
      });

      const summary = await getSchemaValidationSummary('branch-1', 'struct-1');

      expect(summary.totalDocuments).toBe(10);
      expect(summary.conformingDocuments).toBe(7);
      expect(summary.nonConformingCount).toBe(3);
    });
  });

  // ===========================================================================
  // Error Classes
  // ===========================================================================

  describe('Error Classes', () => {
    it('should have BranchStructureStateNotFoundError', async () => {
      const { BranchStructureStateNotFoundError } = await import(
        '../../src/services/metadata-service'
      );

      const error = new BranchStructureStateNotFoundError('branch-1', 'struct-1');
      expect(error.name).toBe('BranchStructureStateNotFoundError');
      expect(error.branchId).toBe('branch-1');
      expect(error.structureId).toBe('struct-1');
    });

    it('should have DocumentMetadataNotFoundError', async () => {
      const { DocumentMetadataNotFoundError } = await import(
        '../../src/services/metadata-service'
      );

      const error = new DocumentMetadataNotFoundError(
        'branch-1',
        'struct-1',
        'doc-1',
      );
      expect(error.name).toBe('DocumentMetadataNotFoundError');
      expect(error.documentId).toBe('doc-1');
    });

    it('should have SchemaValidationError', async () => {
      const { SchemaValidationError } = await import(
        '../../src/services/metadata-service'
      );

      const errors = [
        { field: 'title', message: 'required' },
        { field: 'author', message: 'must be string' },
      ];
      const error = new SchemaValidationError('doc-1', errors);
      expect(error.name).toBe('SchemaValidationError');
      expect(error.documentId).toBe('doc-1');
      expect(error.validationErrors).toEqual(errors);
    });
  });
});
