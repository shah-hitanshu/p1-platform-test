/**
 * Dual-Source Authorization Tests (MAS Integration)
 *
 * Tests for authorization with MAS client integration.
 * Covers dual-source role resolution, cache staleness, and graceful degradation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import type { MASClient } from '../../src/services/mas-client';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock MAS client module
vi.mock('../../src/services/mas-client', () => ({
  MASClient: vi.fn(),
}));

describe('Dual-Source Authorization (MAS Integration)', () => {
  function createPrincipal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
    return {
      id: 'user-123',
      type: 'user',
      email: 'test@example.com',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      authProvider: 'auth0',
      ...overrides,
    };
  }

  function createMockMASClient(overrides: Partial<MASClient> = {}): MASClient {
    return {
      getUserSiteRole: vi.fn().mockResolvedValue(null),
      getSiteMemberships: vi.fn().mockResolvedValue(null),
      cacheTtlSeconds: 300,
      ...overrides,
    } as unknown as MASClient;
  }

  describe('isPantheonUser', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should return true for auth0 users', async () => {
      const { isPantheonUser } = await import('../../src/auth/authorization');
      const principal = createPrincipal({ authProvider: 'auth0' });
      expect(isPantheonUser(principal)).toBe(true);
    });

    it('should return false for google users', async () => {
      const { isPantheonUser } = await import('../../src/auth/authorization');
      const principal = createPrincipal({ authProvider: 'google' });
      expect(isPantheonUser(principal)).toBe(false);
    });

    it('should return false for agents', async () => {
      const { isPantheonUser } = await import('../../src/auth/authorization');
      const principal = createPrincipal({ type: 'agent', authProvider: 'auth0' });
      expect(isPantheonUser(principal)).toBe(false);
    });

    it('should return false when authProvider is undefined', async () => {
      const { isPantheonUser } = await import('../../src/auth/authorization');
      const principal = createPrincipal({ authProvider: undefined });
      expect(isPantheonUser(principal)).toBe(false);
    });
  });

  describe('getEffectiveRole with MAS client', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should use dual-source resolution for Pantheon users when masClient is provided', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({ authProvider: 'auth0' });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('admin'),
      });

      // First query: dual-source query returns no rows (no cached data)
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // user_site_roles dual-source query
        .mockResolvedValueOnce({ rows: [] }) // upsert MAS role
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1', masClient);


      expect(masClient.getUserSiteRole).toHaveBeenCalledWith('user-123', 'site-1');
      expect(result.roleName).toBe('ADMIN');
    });

    it('should use max of local and MAS roles', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({ authProvider: 'auth0' });
      const now = new Date().toISOString();

      const masClient = createMockMASClient();

      // Dual-source query returns both local (developer) and mas (admin) roles
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [
            { role: 'developer', source: 'local', updated_at: now },
            { role: 'admin', source: 'mas', updated_at: now },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1', masClient);

      // max(EDITOR from developer, ADMIN from admin) = ADMIN
      expect(result.roleName).toBe('ADMIN');
      // MAS data is fresh, so no API call

      expect(masClient.getUserSiteRole).not.toHaveBeenCalled();
    });

    it('should refresh stale MAS cache', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({ authProvider: 'auth0' });

      // Stale timestamp (10 minutes ago, TTL is 5 minutes)
      const staleTime = new Date(Date.now() - 600_000).toISOString();

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('admin'),
        cacheTtlSeconds: 300,
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [
            { role: 'developer', source: 'mas', updated_at: staleTime },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // upsert
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1', masClient);

      // Should have called MAS API to refresh

      expect(masClient.getUserSiteRole).toHaveBeenCalledWith('user-123', 'site-1');
      expect(result.roleName).toBe('ADMIN');
    });

    it('should use stale cache when MAS fetch fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({ authProvider: 'auth0' });
      const staleTime = new Date(Date.now() - 600_000).toISOString();

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockRejectedValue(new Error('Network error')),
        cacheTtlSeconds: 300,
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [
            { role: 'admin', source: 'mas', updated_at: staleTime },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1', masClient);

      // Should fall back to stale cache
      expect(result.roleName).toBe('ADMIN');
      consoleSpy.mockRestore();
    });

    it('should fall back to JWT when both sources are NO_ACCESS and MAS returns null', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        authProvider: 'auth0',
        pantheonSiteRoles: { 'site-1': 'admin' },
      });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue(null),
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // no dual-source rows
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1', masClient);

      // Should fall back to JWT role
      expect(result.roleName).toBe('ADMIN');
    });

    it('should not use MAS for non-auth0 users', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        authProvider: 'google',
        pantheonSiteRoles: { 'site-1': 'developer' },
      });

      const masClient = createMockMASClient();

      // Legacy single-source query
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // user_site_roles (single source)
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1', masClient);

      // Should NOT call MAS

      expect(masClient.getUserSiteRole).not.toHaveBeenCalled();
      // Should fall back to JWT
      expect(result.roleName).toBe('EDITOR');
    });

    it('should not use MAS for agents', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        type: 'agent',
        authProvider: 'auth0',
      });

      const masClient = createMockMASClient();

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ role: 'editor' }] }) // agent_site_roles
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1', masClient);


      expect(masClient.getUserSiteRole).not.toHaveBeenCalled();
      expect(result.roleName).toBe('EDITOR');
    });
  });

  describe('Backwards compatibility (no MAS client)', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should work identically without masClient', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'admin' },
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

      expect(result.roleName).toBe('ADMIN');
    });

    it('should use database role when available without masClient', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        pantheonSiteRoles: {},
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ role: 'admin' }] }) // user_site_roles
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

      expect(result.roleName).toBe('ADMIN');
    });
  });

  describe('assertPermission with MAS client', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should pass MAS client through to getEffectiveRole', async () => {
      const { assertPermission } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        authProvider: 'auth0',
      });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('admin'),
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // dual-source
        .mockResolvedValueOnce({ rows: [] }) // upsert
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      await expect(
        assertPermission(principal, 'site-1', 'branch-1', 'canManageGrants', masClient),
      ).resolves.not.toThrow();
    });

    it('should throw when MAS-resolved role lacks permission', async () => {
      const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        authProvider: 'auth0',
      });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('developer'),
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // dual-source
        .mockResolvedValueOnce({ rows: [] }) // upsert
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      await expect(
        assertPermission(principal, 'site-1', 'branch-1', 'canManageGrants', masClient),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('hasPermission with MAS client', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should pass MAS client through', async () => {
      const { hasPermission } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        authProvider: 'auth0',
      });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('admin'),
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // dual-source
        .mockResolvedValueOnce({ rows: [] }) // upsert
        .mockResolvedValueOnce({ rows: [] }); // branch_grants

      const result = await hasPermission(
        principal, 'site-1', 'branch-1', 'canManageGrants', masClient,
      );
      expect(result).toBe(true);
    });
  });
});
