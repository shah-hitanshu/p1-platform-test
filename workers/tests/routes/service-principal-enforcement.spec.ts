/**
 * Service Principal Scope Enforcement Tests (TDD)
 *
 * Tests that service principals (from site API tokens) are:
 * - Restricted to their bound siteId
 * - Allowed only scoped operations
 * - Exempt from the user allowlist check
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect } from 'vitest';

import { isServicePrincipalAllowed } from '../../src/auth/service-principal';
import type { AuthenticatedPrincipal } from '../../src/types';

describe('Service Principal Scope Enforcement', () => {
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

  function createUserPrincipal(): AuthenticatedPrincipal {
    return {
      id: 'user-uuid-456',
      type: 'user',
      email: 'alice@example.com',
      pantheonSiteRoles: { 'site-123': 'admin' },
      tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
      authProvider: 'google',
    };
  }

  // ===========================================================================
  // Site scoping
  // ===========================================================================

  describe('site scoping', () => {
    it('should allow access when request siteId matches principal siteId', () => {
      const principal = createServicePrincipal('site-123');
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET');
      expect(result.allowed).toBe(true);
    });

    it('should deny access when request siteId does not match principal siteId', () => {
      const principal = createServicePrincipal('site-123');
      const result = isServicePrincipalAllowed(principal, 'site-456', 'GET');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('site');
    });

    it('should deny access when principal has no siteId', () => {
      const principal = createServicePrincipal('site-123');
      delete (principal as Record<string, unknown>).siteId;
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET');
      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Method restrictions for read:published scope
  // ===========================================================================

  describe('method restrictions (read:published)', () => {
    it('should allow GET requests', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET');
      expect(result.allowed).toBe(true);
    });

    it('should deny POST requests', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'POST');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient scope');
    });

    it('should deny PATCH requests', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'PATCH');
      expect(result.allowed).toBe(false);
    });

    it('should deny DELETE requests', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'DELETE');
      expect(result.allowed).toBe(false);
    });

    it('should deny PUT requests', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'PUT');
      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Non-service principals pass through
  // ===========================================================================

  describe('non-service principals', () => {
    it('should always allow user principals (not enforced here)', () => {
      const principal = createUserPrincipal();
      const result = isServicePrincipalAllowed(principal, 'any-site', 'POST');
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
      const result = isServicePrincipalAllowed(principal, 'any-site', 'DELETE');
      expect(result.allowed).toBe(true);
    });
  });
});
