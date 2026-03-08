import { describe, it, expect } from 'vitest';
import { isServicePrincipalAllowed } from '../../src/auth/service-principal';
import type { AuthenticatedPrincipal } from '../../src/types';

describe('Service Principal Scope Enforcement (Phase 3)', () => {
  function createServicePrincipal(
    siteId: string,
    scopes: string[] = ['read:published'],
  ): AuthenticatedPrincipal {
    return {
      id: 'token-uuid-123',
      type: 'service',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
      scopes,
      siteId,
      authProvider: 'site_token',
    };
  }

  // =========================================================================
  // read:published scope
  // =========================================================================

  describe('read:published scope', () => {
    it('should allow GET on content handler with main branch', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', true);
      expect(result.allowed).toBe(true);
    });

    it('should deny GET on content handler with non-main branch', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient scope');
    });

    it('should allow GET on content handler when branchIsMain is undefined (defaults to main)', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', undefined);
      expect(result.allowed).toBe(true);
    });

    it('should deny GET on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'documents', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient scope');
    });

    it('should deny GET on branches handler', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'branches', true);
      expect(result.allowed).toBe(false);
    });

    it('should deny POST on content handler', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'POST', 'content', true);
      expect(result.allowed).toBe(false);
    });
  });

  // =========================================================================
  // read:all scope
  // =========================================================================

  describe('read:all scope', () => {
    it('should allow GET on content handler with main branch', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', true);
      expect(result.allowed).toBe(true);
    });

    it('should allow GET on content handler with non-main branch', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', false);
      expect(result.allowed).toBe(true);
    });

    it('should deny GET on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'documents', true);
      expect(result.allowed).toBe(false);
    });

    it('should deny GET on branches handler', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'branches', true);
      expect(result.allowed).toBe(false);
    });

    it('should deny POST on content handler', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'POST', 'content', true);
      expect(result.allowed).toBe(false);
    });
  });

  // =========================================================================
  // read:draft scope
  // =========================================================================

  describe('read:draft scope', () => {
    it('should allow GET on content handler with any branch', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', false);
      expect(result.allowed).toBe(true);
    });

    it('should allow GET on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'documents', true);
      expect(result.allowed).toBe(true);
    });

    it('should allow GET on branches handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'branches', true);
      expect(result.allowed).toBe(true);
    });

    it('should deny POST on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'POST', 'documents', true);
      expect(result.allowed).toBe(false);
    });

    it('should deny DELETE on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'DELETE', 'documents', true);
      expect(result.allowed).toBe(false);
    });

    it('should deny PATCH on content handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'PATCH', 'content', true);
      expect(result.allowed).toBe(false);
    });
  });

  // =========================================================================
  // Non-service principals pass through
  // =========================================================================

  describe('non-service principals', () => {
    it('should always allow user principals regardless of handler or method', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'user-uuid',
        type: 'user',
        email: 'alice@example.com',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
        authProvider: 'google',
      };
      const result = isServicePrincipalAllowed(principal, 'any-site', 'POST', 'documents', false);
      expect(result.allowed).toBe(true);
    });

    it('should always allow agent principals', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'agent-uuid',
        type: 'agent',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
        authProvider: 'mock',
      };
      const result = isServicePrincipalAllowed(principal, 'any-site', 'DELETE', 'documents', true);
      expect(result.allowed).toBe(true);
    });
  });

  // =========================================================================
  // Multiple scopes
  // =========================================================================

  describe('multiple scopes', () => {
    it('should allow access if any scope permits the operation', () => {
      const principal = createServicePrincipal('site-123', ['read:published', 'read:all']);
      // read:published blocks non-main, but read:all allows it
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', false);
      expect(result.allowed).toBe(true);
    });

    it('should allow documents GET if read:draft is among scopes', () => {
      const principal = createServicePrincipal('site-123', ['read:published', 'read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'documents', true);
      expect(result.allowed).toBe(true);
    });
  });

  // =========================================================================
  // Site scoping (unchanged behavior)
  // =========================================================================

  describe('site scoping with new signature', () => {
    it('should deny access when siteId does not match', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-456', 'GET', 'content', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('site');
    });
  });
});
