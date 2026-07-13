/**
 * Migration Conflicts Endpoint Tests
 *
 * Tests for the MigrationConflictsEndpoint class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MigrationConflictsEndpoint } from '../../src/endpoints/migration-conflicts.js';
import type { BaseEndpoint } from '../../src/endpoints/base.js';
import type { MigrationConflict } from '../../src/types.js';

function makeConflict(overrides: Partial<MigrationConflict> = {}): MigrationConflict {
  return {
    id: 'conflict-1',
    migrationJobId: 'job-1',
    documentId: 'doc-1',
    branchId: 'branch-456',
    templateId: 'tmpl-1',
    fromVersion: 1,
    toVersion: 2,
    templateDelta: [],
    documentActions: [],
    resolution: null,
    createdAt: '2026-01-01T00:00:00Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('MigrationConflictsEndpoint', () => {
  let baseEndpoint: BaseEndpoint;
  let endpoint: MigrationConflictsEndpoint;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
    baseEndpoint = { request: mockRequest } as unknown as BaseEndpoint;
    endpoint = new MigrationConflictsEndpoint(baseEndpoint);
  });

  describe('list', () => {
    it('makes GET request and returns the conflicts array', async () => {
      const conflicts = [makeConflict()];

      mockRequest.mockResolvedValue({ conflicts });

      const result = await endpoint.list('site-123', 'branch-456', 'job-1');

      expect(mockRequest).toHaveBeenCalledWith(
        '/api/sites/site-123/branches/branch-456/migrations/job-1/conflicts',
        { method: 'GET' },
      );
      expect(result).toEqual(conflicts);
    });
  });

  describe('resolve', () => {
    it('makes POST request with the resolution in the body', async () => {
      const resolved = makeConflict({ resolution: 'apply', resolvedAt: '2026-01-01T00:05:00Z' });

      mockRequest.mockResolvedValue(resolved);

      const result = await endpoint.resolve('site-123', 'branch-456', 'job-1', 'conflict-1', 'apply');

      expect(mockRequest).toHaveBeenCalledWith(
        '/api/sites/site-123/branches/branch-456/migrations/job-1/conflicts/conflict-1/resolve',
        {
          method: 'POST',
          body: JSON.stringify({ resolution: 'apply' }),
        },
      );
      expect(result).toEqual(resolved);
    });
  });
});
