/**
 * MergeEndpoint Tests
 *
 * Tests for the MergeEndpoint class - HTTP request construction,
 * response parsing, and error handling for all merge API methods.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';
import { P1ApiError, ValidationError } from '../src/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MergeEndpoint', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';
  const siteId = 'site-1';
  const sourceBranchId = 'branch-source';
  const targetBranchId = 'branch-target';

  let client: P1Client;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new P1Client({ baseUrl, apiKey });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkMergeability', () => {
    it('sends POST to /api/sites/{siteId}/merge/check with branch IDs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          canMerge: true,
          conflicts: [],
          mergeBase: { checkpointId: 'cp-1', branchId: targetBranchId },
          changes: {
            documentsModifiedInSource: ['doc-1'],
            documentsModifiedInTarget: [],
          },
        }),
      });

      await client.merge.checkMergeability(siteId, sourceBranchId, targetBranchId);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge/check`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sourceBranchId, targetBranchId }),
        })
      );
    });

    it('returns typed MergeabilityResult', async () => {
      const mockResult = {
        canMerge: true,
        conflicts: [],
        mergeBase: { checkpointId: 'cp-1', branchId: targetBranchId },
        changes: {
          documentsModifiedInSource: ['doc-1'],
          documentsModifiedInTarget: ['doc-2'],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      const result = await client.merge.checkMergeability(siteId, sourceBranchId, targetBranchId);

      expect(result).toEqual(mockResult);
      expect(result.canMerge).toBe(true);
      expect(result.conflicts).toEqual([]);
      expect(result.mergeBase).toEqual({ checkpointId: 'cp-1', branchId: targetBranchId });
      expect(result.changes).toEqual({
        documentsModifiedInSource: ['doc-1'],
        documentsModifiedInTarget: ['doc-2'],
      });
    });
  });

  describe('preview', () => {
    it('sends POST to /api/sites/{siteId}/merge/preview', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          canMerge: true,
          hasConflicts: false,
          conflicts: { documentConflicts: [], structureConflicts: [] },
          sourceChanges: [],
          targetChanges: [],
          mergeBase: null,
        }),
      });

      await client.merge.preview(siteId, sourceBranchId, targetBranchId, { includeContent: true });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge/preview`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sourceBranchId, targetBranchId, includeContent: true }),
        })
      );
    });

    it('sends excludePathPrefixes when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          canMerge: true,
          hasConflicts: false,
          conflicts: { documentConflicts: [], structureConflicts: [] },
          sourceChanges: [],
          targetChanges: [],
          mergeBase: null,
        }),
      });

      await client.merge.preview(siteId, sourceBranchId, targetBranchId, {
        includeContent: true,
        excludePathPrefixes: ['_registry/'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge/preview`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            sourceBranchId,
            targetBranchId,
            includeContent: true,
            excludePathPrefixes: ['_registry/'],
          }),
        })
      );
    });

    it('returns typed MergePreview with documentDiffs', async () => {
      const mockPreview = {
        canMerge: true,
        hasConflicts: true,
        conflicts: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: '/home',
              conflictType: 'both-modified',
            },
          ],
          structureConflicts: [],
        },
        sourceChanges: [{ documentId: 'doc-1', documentPath: '/home' }],
        targetChanges: [{ documentId: 'doc-1', documentPath: '/home' }],
        mergeBase: { checkpointId: 'cp-1', branchId: targetBranchId },
        documentDiffs: [
          {
            documentId: 'doc-1',
            documentPath: '/home',
            sourceSnapshot: { content: [], root: {} },
            targetSnapshot: { content: [], root: {} },
            diffOperations: [],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPreview,
      });

      const result = await client.merge.preview(siteId, sourceBranchId, targetBranchId);

      expect(result.canMerge).toBe(true);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.documentConflicts).toHaveLength(1);
      expect(result.sourceChanges).toHaveLength(1);
      expect(result.targetChanges).toHaveLength(1);
      expect(result.documentDiffs).toHaveLength(1);
    });
  });

  describe('execute', () => {
    it('sends POST to /api/sites/{siteId}/merge/execute with conflict resolutions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, checkpointId: 'cp-2', documentsUpdated: 3 }),
      });

      const params = {
        sourceBranchId,
        targetBranchId,
        message: 'Merge feature into main',
        conflictResolutions: [
          { documentId: 'doc-1', strategy: 'take-source' as const },
          { documentId: 'doc-2', strategy: 'manual' as const, resolvedSnapshot: { content: [], root: {} } },
        ],
      };

      await client.merge.execute(siteId, params);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge/execute`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(params),
        })
      );
    });

    it('returns MergeExecuteResult', async () => {
      const mockResult = { success: true, checkpointId: 'cp-2', documentsUpdated: 3 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      const result = await client.merge.execute(siteId, {
        sourceBranchId,
        targetBranchId,
      });

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBe('cp-2');
      expect(result.documentsUpdated).toBe(3);
    });
  });

  describe('createRequest', () => {
    it('sends POST to /api/sites/{siteId}/merge-requests', async () => {
      const mockRequest = {
        id: 'mr-1',
        siteId,
        sourceBranchId,
        targetBranchId,
        title: 'Merge feature',
        description: 'Feature branch merge',
        status: 'open',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockRequest,
      });

      const result = await client.merge.createRequest(siteId, {
        sourceBranchId,
        targetBranchId,
        title: 'Merge feature',
        description: 'Feature branch merge',
      });

      expect(result).toEqual(mockRequest);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge-requests`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            sourceBranchId,
            targetBranchId,
            title: 'Merge feature',
            description: 'Feature branch merge',
          }),
        })
      );
    });
  });

  describe('getRequest', () => {
    it('sends GET to /api/sites/{siteId}/merge-requests/{requestId}', async () => {
      const mockRequest = {
        id: 'mr-1',
        siteId,
        sourceBranchId,
        targetBranchId,
        title: 'Merge feature',
        status: 'open',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRequest,
      });

      const result = await client.merge.getRequest(siteId, 'mr-1');

      expect(result).toEqual(mockRequest);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge-requests/mr-1`,
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('listRequests', () => {
    it('sends GET to /api/sites/{siteId}/merge-requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ mergeRequests: [] }),
      });

      await client.merge.listRequests(siteId);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge-requests`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('supports optional status filter query param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ mergeRequests: [] }),
      });

      await client.merge.listRequests(siteId, { status: 'open' });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge-requests?status=open`,
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('updateRequest', () => {
    it('sends PATCH to /api/sites/{siteId}/merge-requests/{requestId}', async () => {
      const mockRequest = {
        id: 'mr-1',
        siteId,
        sourceBranchId,
        targetBranchId,
        title: 'Updated title',
        status: 'approved',
        hasConflicts: false,
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRequest,
      });

      const result = await client.merge.updateRequest(siteId, 'mr-1', {
        title: 'Updated title',
        status: 'approved',
      });

      expect(result).toEqual(mockRequest);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge-requests/mr-1`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Updated title', status: 'approved' }),
        })
      );
    });
  });

  describe('deleteRequest', () => {
    it('sends DELETE to /api/sites/{siteId}/merge-requests/{requestId}', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => undefined,
      });

      await client.merge.deleteRequest(siteId, 'mr-1');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge-requests/mr-1`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('executeRequest', () => {
    it('sends POST to /api/sites/{siteId}/merge-requests/{requestId}/execute', async () => {
      const mockResult = { success: true, checkpointId: 'cp-3', documentsUpdated: 2 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      const resolutions = [
        { documentId: 'doc-1', strategy: 'take-source' as const },
      ];

      const result = await client.merge.executeRequest(siteId, 'mr-1', { resolutions });

      expect(result).toEqual(mockResult);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/merge-requests/mr-1/execute`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ resolutions }),
        })
      );
    });
  });

  describe('error handling', () => {
    it('throws P1ApiError on 4xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid branch IDs' }),
      });

      await expect(
        client.merge.checkMergeability(siteId, '', '')
      ).rejects.toThrow(ValidationError);
    });

    it('throws P1ApiError on 5xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      await expect(
        client.merge.preview(siteId, sourceBranchId, targetBranchId)
      ).rejects.toThrow(P1ApiError);
    });
  });
});
