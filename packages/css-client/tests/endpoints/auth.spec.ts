import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthEndpoint } from '../../src/endpoints/auth.js';
import type { BaseEndpoint } from '../../src/endpoints/base.js';
import { MissingParameterError } from '../../src/errors.js';
import type { ViewerRole } from '../../src/auth.js';

describe('AuthEndpoint.getRole', () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  let endpoint: AuthEndpoint;

  const mockRole: ViewerRole = {
    roleName: 'EDITOR',
    permissions: {
      canView: true, canEdit: true, canCreateBranch: true, canEditDocuments: true,
      canCreateCheckpoint: true, canProposeMerge: true, canMerge: true,
      canMergeToMain: false, canManageGrants: false, canManageTemplates: false,
    },
  };

  beforeEach(() => {
    mockRequest = vi.fn().mockResolvedValue(mockRole);
    endpoint = new AuthEndpoint({ request: mockRequest } as unknown as BaseEndpoint);
  });

  it('requests the correct path', async () => {
    await endpoint.getRole('site-1', 'branch-1');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/sites/site-1/branches/branch-1/auth/role',
      { method: 'GET' },
    );
  });

  it('percent-encodes path params', async () => {
    await endpoint.getRole('site/a', 'branch b');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/sites/site%2Fa/branches/branch%20b/auth/role',
      { method: 'GET' },
    );
  });

  it('throws MissingParameterError for empty branchId', async () => {
    await expect(endpoint.getRole('site-1', '')).rejects.toThrow(MissingParameterError);
  });
});
