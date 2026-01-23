/**
 * Phase 2.2: Authorization System - Permission Middleware Tests
 *
 * Tests for the requirePermission middleware and related utilities.
 * Based on collaborative-state-system-architecture-v2.2.md Section "Permission Middleware"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal, RolePermissions } from '../../src/types';

// Mock the authorization module
vi.mock('../../src/auth/authorization', () => ({
  getEffectiveRole: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    constructor(
      message: string,
      public requiredPermission: string,
      public roleName: string
    ) {
      super(message);
      this.name = 'AuthorizationError';
    }
  },
}));

describe('Phase 2.2: Permission Middleware', () => {
  // Helper to create a test principal
  function createPrincipal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
    return {
      id: 'user-123',
      type: 'user',
      email: 'test@example.com',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      ...overrides,
    };
  }

  // Mock request/response objects
  interface MockRequest {
    principal?: AuthenticatedPrincipal;
    params: Record<string, string>;
    effectiveRole?: RolePermissions;
    effectiveRoleName?: string;
  }

  interface MockResponse {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  }

  function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
    return {
      params: { siteId: 'site-1', branchId: 'branch-1' },
      ...overrides,
    };
  }

  function createMockResponse(): MockResponse {
    const res: MockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res;
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('requirePermission middleware factory', () => {
    it('should return a middleware function', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');

      const middleware = requirePermission('canView');

      expect(typeof middleware).toBe('function');
    });

    it('should accept any valid permission key', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');

      // These should all return valid middleware functions
      expect(() => requirePermission('canView')).not.toThrow();
      expect(() => requirePermission('canEdit')).not.toThrow();
      expect(() => requirePermission('canCreateBranch')).not.toThrow();
      expect(() => requirePermission('canEditDocuments')).not.toThrow();
      expect(() => requirePermission('canCreateCheckpoint')).not.toThrow();
      expect(() => requirePermission('canProposeMerge')).not.toThrow();
      expect(() => requirePermission('canMerge')).not.toThrow();
      expect(() => requirePermission('canMergeToMain')).not.toThrow();
      expect(() => requirePermission('canManageGrants')).not.toThrow();
    });
  });

  describe('Middleware execution', () => {
    it('should call next() when permission is granted', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'owner' },
      });

      vi.mocked(authorization.getEffectiveRole).mockResolvedValue({
        roleName: 'ADMIN',
        role: {
          canView: true,
          canEdit: true,
          canCreateBranch: true,
          canEditDocuments: true,
          canCreateCheckpoint: true,
          canProposeMerge: true,
          canMerge: true,
          canMergeToMain: true,
          canManageGrants: true,
        },
      });

      const req = createMockRequest({ principal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should respond with 403 when permission is denied', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'developer' },
      });

      vi.mocked(authorization.getEffectiveRole).mockResolvedValue({
        roleName: 'EDITOR',
        role: {
          canView: true,
          canEdit: true,
          canCreateBranch: true,
          canEditDocuments: true,
          canCreateCheckpoint: true,
          canProposeMerge: true,
          canMerge: true,
          canMergeToMain: false,
          canManageGrants: false,
        },
      });

      const req = createMockRequest({ principal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canMergeToMain');
      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('canMergeToMain'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should include role information in 403 response', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'developer' },
      });

      vi.mocked(authorization.getEffectiveRole).mockResolvedValue({
        roleName: 'EDITOR',
        role: {
          canView: true,
          canEdit: true,
          canCreateBranch: true,
          canEditDocuments: true,
          canCreateCheckpoint: true,
          canProposeMerge: true,
          canMerge: true,
          canMergeToMain: false,
          canManageGrants: false,
        },
      });

      const req = createMockRequest({ principal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canManageGrants');
      await middleware(req as any, res as any, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          required: 'canManageGrants',
          yourRole: 'EDITOR',
        })
      );
    });

    it('should attach effectiveRole and effectiveRoleName to request', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'owner' },
      });

      const mockRole = {
        canView: true,
        canEdit: true,
        canCreateBranch: true,
        canEditDocuments: true,
        canCreateCheckpoint: true,
        canProposeMerge: true,
        canMerge: true,
        canMergeToMain: true,
        canManageGrants: true,
      };

      vi.mocked(authorization.getEffectiveRole).mockResolvedValue({
        roleName: 'ADMIN',
        role: mockRole,
      });

      const req = createMockRequest({ principal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(req.effectiveRole).toEqual(mockRole);
      expect(req.effectiveRoleName).toBe('ADMIN');
    });

    it('should get siteId and branchId from request params', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal();

      vi.mocked(authorization.getEffectiveRole).mockResolvedValue({
        roleName: 'ADMIN',
        role: {
          canView: true,
          canEdit: true,
          canCreateBranch: true,
          canEditDocuments: true,
          canCreateCheckpoint: true,
          canProposeMerge: true,
          canMerge: true,
          canMergeToMain: true,
          canManageGrants: true,
        },
      });

      const req = createMockRequest({
        principal,
        params: { siteId: 'my-site', branchId: 'my-branch' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(authorization.getEffectiveRole).toHaveBeenCalledWith(
        principal,
        'my-site',
        'my-branch'
      );
    });
  });

  describe('Guest principal handling', () => {
    it('should allow guests to view (canView permission)', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');

      const guestPrincipal = createPrincipal({
        id: 'guest-123',
        type: 'guest' as any, // Guest type
        pantheonSiteRoles: {},
      });

      const req = createMockRequest({ principal: guestPrincipal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should deny guests any permission other than canView', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');

      const guestPrincipal = createPrincipal({
        id: 'guest-123',
        type: 'guest' as any,
        pantheonSiteRoles: {},
      });

      const req = createMockRequest({ principal: guestPrincipal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canEdit');
      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Guests can only view'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should not call getEffectiveRole for guest principals', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const guestPrincipal = createPrincipal({
        id: 'guest-123',
        type: 'guest' as any,
        pantheonSiteRoles: {},
      });

      const req = createMockRequest({ principal: guestPrincipal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(authorization.getEffectiveRole).not.toHaveBeenCalled();
    });
  });

  describe('Missing principal', () => {
    it('should respond with 401 when principal is missing', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');

      const req = createMockRequest({ principal: undefined });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Authentication required'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Missing route parameters', () => {
    it('should respond with 400 when siteId is missing', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');

      const principal = createPrincipal();
      const req = createMockRequest({
        principal,
        params: { branchId: 'branch-1' }, // Missing siteId
      });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('siteId'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should respond with 400 when branchId is missing', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');

      const principal = createPrincipal();
      const req = createMockRequest({
        principal,
        params: { siteId: 'site-1' }, // Missing branchId
      });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('branchId'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should pass errors to next() for error handling middleware', async () => {
      const { requirePermission } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal();
      const dbError = new Error('Database connection failed');

      vi.mocked(authorization.getEffectiveRole).mockRejectedValue(dbError);

      const req = createMockRequest({ principal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requirePermission('canView');
      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  describe('requireRole middleware factory', () => {
    it('should return a middleware function', async () => {
      const { requireRole } = await import('../../src/auth/middleware');

      const middleware = requireRole('EDITOR');

      expect(typeof middleware).toBe('function');
    });

    it('should allow access when user has the required role', async () => {
      const { requireRole } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'developer' },
      });

      vi.mocked(authorization.getEffectiveRole).mockResolvedValue({
        roleName: 'EDITOR',
        role: {
          canView: true,
          canEdit: true,
          canCreateBranch: true,
          canEditDocuments: true,
          canCreateCheckpoint: true,
          canProposeMerge: true,
          canMerge: true,
          canMergeToMain: false,
          canManageGrants: false,
        },
      });

      const req = createMockRequest({ principal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireRole('EDITOR');
      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow access when user has a higher role', async () => {
      const { requireRole } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'owner' },
      });

      vi.mocked(authorization.getEffectiveRole).mockResolvedValue({
        roleName: 'ADMIN',
        role: {
          canView: true,
          canEdit: true,
          canCreateBranch: true,
          canEditDocuments: true,
          canCreateCheckpoint: true,
          canProposeMerge: true,
          canMerge: true,
          canMergeToMain: true,
          canManageGrants: true,
        },
      });

      const req = createMockRequest({ principal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireRole('EDITOR');
      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should deny access when user has a lower role', async () => {
      const { requireRole } = await import('../../src/auth/middleware');
      const authorization = await import('../../src/auth/authorization');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'developer' },
      });

      vi.mocked(authorization.getEffectiveRole).mockResolvedValue({
        roleName: 'EDITOR',
        role: {
          canView: true,
          canEdit: true,
          canCreateBranch: true,
          canEditDocuments: true,
          canCreateCheckpoint: true,
          canProposeMerge: true,
          canMerge: true,
          canMergeToMain: false,
          canManageGrants: false,
        },
      });

      const req = createMockRequest({ principal });
      const res = createMockResponse();
      const next = vi.fn();

      const middleware = requireRole('ADMIN');
      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
