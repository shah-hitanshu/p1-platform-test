/**
 * Phase 6.2: Metadata Service Tests (TDD)
 *
 * Tests for branch structure state and document metadata management
 * with JSON Schema validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  branchDocumentMetadata,
  branchStructureState,
} from '../../src/db/schema';
import {
  BranchStructureStateNotFoundError,
  DocumentMetadataNotFoundError,
  SchemaValidationError,
} from '../../src/services/errors';
import {
  deleteBranchStructureState,
  deleteDocumentMetadata,
  getBranchStructureState,
  getDocumentMetadata,
  getSchemaValidationSummary,
  listDocumentMetadata,
  setDocumentMetadata,
  updateBranchStructureState,
  validateAllDocuments,
  validateMetadata,
} from '../../src/services/metadata-service';

describe('Phase 6.2: Metadata Service', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  // ===========================================================================
  // Branch Structure State CRUD
  // ===========================================================================

  describe('getBranchStructureState', () => {
    it('should return structure state for a branch', async () => {
      stub.on(branchStructureState).select.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          structureTree: [],
          metadataSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          schemaEnforcement: 'warn',
          hasChangesSinceCheckpoint: false,
          lastModifiedAt: new Date('2026-01-24T10:00:00.000Z'),
          lastModifiedBy: 'user-1',
        },
      ]);

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
      const state = await getBranchStructureState('branch-1', 'nonexistent');

      expect(state).toBeNull();
    });
  });

  describe('updateBranchStructureState', () => {
    it('should update metadata schema', async () => {
      const newSchema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string', enum: ['blog', 'news', 'tutorial'] },
        },
        required: ['title', 'category'],
      };

      stub.on(branchStructureState).update.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          structureTree: [],
          metadataSchema: newSchema,
          schemaEnforcement: 'warn',
          hasChangesSinceCheckpoint: true,
          lastModifiedAt: new Date('2026-01-24T11:00:00.000Z'),
          lastModifiedBy: 'user-1',
        },
      ]);

      const state = await updateBranchStructureState('branch-1', 'struct-1', {
        metadataSchema: newSchema,
        modifiedById: 'user-1',
      });

      expect(state.metadataSchema).toEqual(newSchema);
      expect(state.hasChangesSinceCheckpoint).toBe(true);
    });

    it('should update schema enforcement mode', async () => {
      stub.on(branchStructureState).update.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          structureTree: [],
          metadataSchema: { type: 'object' },
          schemaEnforcement: 'strict',
          hasChangesSinceCheckpoint: true,
          lastModifiedAt: new Date('2026-01-24T11:00:00.000Z'),
          lastModifiedBy: 'user-1',
        },
      ]);

      const state = await updateBranchStructureState('branch-1', 'struct-1', {
        schemaEnforcement: 'strict',
        modifiedById: 'user-1',
      });

      expect(state.schemaEnforcement).toBe('strict');
    });

    it('should throw error when structure state does not exist', async () => {
      await expect(
        updateBranchStructureState('branch-1', 'nonexistent', {
          schemaEnforcement: 'strict',
        }),
      ).rejects.toThrow(BranchStructureStateNotFoundError);
    });
  });

  describe('deleteBranchStructureState', () => {
    it('should delete structure state', async () => {
      stub.on(branchStructureState).delete.returns([
        { branchId: 'branch-1', structureId: 'struct-1' },
      ]);

      await deleteBranchStructureState('branch-1', 'struct-1');

      expect(stub.calls(branchStructureState).delete).toHaveLength(1);
      expect(stub.calls(branchStructureState).delete[0]?.params).toEqual([
        'branch-1',
        'struct-1',
      ]);
    });

    it('should throw error when structure state does not exist', async () => {
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
      stub.on(branchDocumentMetadata).select.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-1',
          metadata: { title: 'My Document', author: 'John Doe' },
          conformsToSchema: true,
          validationErrors: [],
          lastModifiedAt: new Date('2026-01-24T10:00:00.000Z'),
          lastModifiedBy: 'user-1',
        },
      ]);

      const metadata = await getDocumentMetadata('branch-1', 'struct-1', 'doc-1');

      expect(metadata).not.toBeNull();
      expect(metadata?.documentId).toBe('doc-1');
      expect(metadata?.metadata).toEqual({
        title: 'My Document',
        author: 'John Doe',
      });
      expect(metadata?.conformsToSchema).toBe(true);
    });

    it('should return null when document metadata does not exist', async () => {
      const metadata = await getDocumentMetadata('branch-1',
        'struct-1',
        'nonexistent',
      );

      expect(metadata).toBeNull();
    });
  });

  describe('setDocumentMetadata', () => {
    it('should create document metadata with validation', async () => {
      stub.on(branchStructureState).select.returns([
        {
          metadataSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          schemaEnforcement: 'warn',
        },
      ]);
      stub.on(branchDocumentMetadata).insert.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-1',
          metadata: { title: 'New Document' },
          conformsToSchema: true,
          validationErrors: [],
          lastModifiedAt: new Date('2026-01-24T10:00:00.000Z'),
          lastModifiedBy: 'user-1',
        },
      ]);

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
      stub.on(branchStructureState).select.returns([
        {
          metadataSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          schemaEnforcement: 'warn',
        },
      ]);
      stub.on(branchDocumentMetadata).insert.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-1',
          metadata: {},
          conformsToSchema: false,
          validationErrors: [
            { field: 'title', message: "must have required property 'title'" },
          ],
          lastModifiedAt: new Date('2026-01-24T10:00:00.000Z'),
          lastModifiedBy: 'user-1',
        },
      ]);

      const result = await setDocumentMetadata({
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'doc-1',
        metadata: {},
        modifiedById: 'user-1',
      });

      expect(result.conformsToSchema).toBe(false);
      expect(result.validationErrors.length).toBeGreaterThan(0);
      // The conformance verdict is what gets written, not what the caller sent.
      expect(stub.calls(branchDocumentMetadata).insert[0]?.params).toContain(false);
    });

    it('should throw error for non-conforming metadata in strict mode', async () => {
      stub.on(branchStructureState).select.returns([
        {
          metadataSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          schemaEnforcement: 'strict',
        },
      ]);

      await expect(
        setDocumentMetadata({
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-1',
          metadata: {}, // Missing required 'title'
          modifiedById: 'user-1',
        }),
      ).rejects.toThrow(SchemaValidationError);
      expect(stub.calls(branchDocumentMetadata).insert).toHaveLength(0);
    });

    it('should skip validation in none mode', async () => {
      stub.on(branchStructureState).select.returns([
        {
          metadataSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          schemaEnforcement: 'none',
        },
      ]);
      stub.on(branchDocumentMetadata).insert.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-1',
          metadata: {},
          conformsToSchema: true,
          validationErrors: [],
          lastModifiedAt: new Date('2026-01-24T10:00:00.000Z'),
          lastModifiedBy: 'user-1',
        },
      ]);

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
      stub.on(branchDocumentMetadata).delete.returns([
        { branchId: 'branch-1', structureId: 'struct-1', documentId: 'doc-1' },
      ]);

      await deleteDocumentMetadata('branch-1', 'struct-1', 'doc-1');

      expect(stub.calls(branchDocumentMetadata).delete).toHaveLength(1);
      expect(stub.calls(branchDocumentMetadata).delete[0]?.params).toEqual([
        'branch-1',
        'struct-1',
        'doc-1',
      ]);
    });

    it('should throw error when document metadata does not exist', async () => {
      await expect(
        deleteDocumentMetadata('branch-1', 'struct-1', 'nonexistent'),
      ).rejects.toThrow(DocumentMetadataNotFoundError);
    });
  });

  describe('listDocumentMetadata', () => {
    it('should list all document metadata in a structure', async () => {
      stub.on(branchDocumentMetadata).select.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-1',
          metadata: { title: 'Doc 1' },
          conformsToSchema: true,
          validationErrors: [],
          lastModifiedAt: new Date('2026-01-24T10:00:00.000Z'),
          lastModifiedBy: 'user-1',
        },
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-2',
          metadata: { title: 'Doc 2' },
          conformsToSchema: false,
          validationErrors: [{ field: 'author', message: 'required' }],
          lastModifiedAt: new Date('2026-01-24T11:00:00.000Z'),
          lastModifiedBy: 'user-2',
        },
      ]);

      const metadataList = await listDocumentMetadata({
        branchId: 'branch-1',
        structureId: 'struct-1',
      });

      expect(metadataList).toHaveLength(2);
      expect(metadataList[0].documentId).toBe('doc-1');
      expect(metadataList[1].documentId).toBe('doc-2');
      expect(stub.calls(branchDocumentMetadata).select[0]?.params).toEqual([
        'branch-1',
        'struct-1',
        100,
      ]);
    });

    it('should filter by conformance status', async () => {
      stub.on(branchDocumentMetadata).select.returns([
        {
          branchId: 'branch-1',
          structureId: 'struct-1',
          documentId: 'doc-2',
          metadata: { title: 'Doc 2' },
          conformsToSchema: false,
          validationErrors: [{ field: 'author', message: 'required' }],
          lastModifiedAt: new Date('2026-01-24T11:00:00.000Z'),
          lastModifiedBy: 'user-2',
        },
      ]);

      const metadataList = await listDocumentMetadata({
        branchId: 'branch-1',
        structureId: 'struct-1',
        conformsToSchema: false,
      });

      expect(metadataList).toHaveLength(1);
      expect(metadataList[0].conformsToSchema).toBe(false);
      const { sql, params } = stub.calls(branchDocumentMetadata).select[0] ?? {};
      expect(sql).toContain('"conforms_to_schema"');
      expect(params).toEqual(['branch-1', 'struct-1', false, 100]);
    });
  });

  // ===========================================================================
  // Schema Validation
  // ===========================================================================

  describe('validateMetadata', () => {
    it('should validate conforming metadata', () => {
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

    it('should return errors for non-conforming metadata', () => {
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

    it('should validate type constraints', () => {
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
      expect(
        result.errors.some((e) => e.message.includes('more than 10 characters')),
      ).toBe(true);
    });

    it('should validate enum constraints', () => {
      const schema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['draft', 'published', 'archived'] },
        },
        required: ['status'],
      };

      const result = validateMetadata({ status: 'invalid' }, schema);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('allowed values')),
      ).toBe(true);
    });
  });

  describe('validateAllDocuments', () => {
    it('should validate all documents against schema', async () => {
      stub.on(branchStructureState).select.returns([
        {
          metadataSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      ]);
      stub.on(branchDocumentMetadata).select.returnsRaw([
        { documentId: 'doc-1', documentPath: 'pages/home', metadata: { title: 'Home' } },
        { documentId: 'doc-2', documentPath: 'pages/about', metadata: {} },
        {
          documentId: 'doc-3',
          documentPath: 'pages/contact',
          metadata: { title: 'Contact' },
        },
      ]);

      const result = await validateAllDocuments('branch-1', 'struct-1');

      expect(result.structureId).toBe('struct-1');
      expect(result.totalDocuments).toBe(3);
      expect(result.conformingDocuments).toBe(2);
      expect(result.nonConformingDocuments).toHaveLength(1);
      expect(result.nonConformingDocuments[0].documentId).toBe('doc-2');
      // Every document's verdict is written back.
      expect(
        stub
          .calls(branchDocumentMetadata)
          .update.map((call) => call.params[call.params.length - 1]),
      ).toEqual(['doc-1', 'doc-2', 'doc-3']);
    });

    it('should throw error when structure state does not exist', async () => {
      await expect(
        validateAllDocuments('branch-1', 'nonexistent'),
      ).rejects.toThrow(BranchStructureStateNotFoundError);
    });
  });

  describe('getSchemaValidationSummary', () => {
    it('should return validation summary for a structure', async () => {
      stub
        .on(branchDocumentMetadata)
        .select.returnsRaw([{ totalDocuments: 10, conformingDocuments: 7 }]);

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
    it('should have BranchStructureStateNotFoundError', () => {
      const error = new BranchStructureStateNotFoundError('branch-1', 'struct-1');
      expect(error.name).toBe('BranchStructureStateNotFoundError');
      expect(error.branchId).toBe('branch-1');
      expect(error.structureId).toBe('struct-1');
    });

    it('should have DocumentMetadataNotFoundError', () => {
      const error = new DocumentMetadataNotFoundError(
        'branch-1',
        'struct-1',
        'doc-1',
      );
      expect(error.name).toBe('DocumentMetadataNotFoundError');
      expect(error.documentId).toBe('doc-1');
    });

    it('should have SchemaValidationError', () => {
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
