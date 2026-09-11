/**
 * Dual-Source Authorization Tests (MAS Integration)
 *
 * Tests for authorization with MAS client integration.
 * Covers dual-source role resolution, cache staleness, and graceful degradation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import type { MASClient } from '../../src/services/mas-client';
import {
  isPantheonUser,
  getEffectiveRole,
  hasPermission,
  assertPermission,
  AuthorizationError,
} from '../../src/auth/authorization';
import { userSiteRoles } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { query } from '../../src/db';

// The agent site-role resolver still reads through the legacy query path, which
// the Drizzle stub does not see.
vi.mock('../../src/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/db')>(),
  query: vi.fn(),
}));


describe('Dual-Source Authorization (MAS Integration)', () => {
  let database: DatabaseStub;

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

  beforeEach(() => {
    database = stubDatabase();
    vi.mocked(query).mockResolvedValue({ rows: [] });
  });

  describe('isPantheonUser', () => {
    it('should return true for auth0 users', () => {
      const principal = createPrincipal({ authProvider: 'auth0' });
      expect(isPantheonUser(principal)).toBe(true);
    });

    it('should return false for google users', () => {
      const principal = createPrincipal({ authProvider: 'google' });
      expect(isPantheonUser(principal)).toBe(false);
    });

    it('should return false for agents', () => {
      const principal = createPrincipal({ type: 'agent', authProvider: 'auth0' });
      expect(isPantheonUser(principal)).toBe(false);
    });

    it('should return false when authProvider is undefined', () => {
      const principal = createPrincipal({ authProvider: undefined });
      expect(isPantheonUser(principal)).toBe(false);
    });
  });

  describe('getEffectiveRole with MAS client', () => {
    it('should use dual-source resolution for Pantheon users when masClient is provided', async () => {
      const principal = createPrincipal({ authProvider: 'auth0' });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('admin'),
      });

      // No cached role rows, so the MAS role is fetched and cached.
      const result = await getEffectiveRole(
        principal, 'site-1', 'branch-1', masClient,
      );

      expect(masClient.getUserSiteRole).toHaveBeenCalledWith('user-123', 'site-1');
      expect(result.roleName).toBe('ADMIN');
    });

    it('should use max of local and MAS roles', async () => {
      const principal = createPrincipal({ authProvider: 'auth0' });
      const now = new Date();

      const masClient = createMockMASClient();

      database.on(userSiteRoles).select.returns([
        { role: 'developer', source: 'local', updatedAt: now },
        { role: 'admin', source: 'mas', updatedAt: now },
      ]);

      const result = await getEffectiveRole(
        principal, 'site-1', 'branch-1', masClient,
      );

      // max(EDITOR from developer, ADMIN from admin) = ADMIN
      expect(result.roleName).toBe('ADMIN');
      // MAS data is fresh, so no API call

      expect(masClient.getUserSiteRole).not.toHaveBeenCalled();
    });

    it('should refresh stale MAS cache', async () => {
      const principal = createPrincipal({ authProvider: 'auth0' });

      // Stale timestamp (10 minutes ago, TTL is 5 minutes)
      const staleTime = new Date(Date.now() - 600_000);

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('admin'),
        cacheTtlSeconds: 300,
      });

      database.on(userSiteRoles).select.returns([
        { role: 'developer', source: 'mas', updatedAt: staleTime },
      ]);

      const result = await getEffectiveRole(
        principal, 'site-1', 'branch-1', masClient,
      );

      // Should have called MAS API to refresh

      expect(masClient.getUserSiteRole).toHaveBeenCalledWith('user-123', 'site-1');
      expect(result.roleName).toBe('ADMIN');
    });

    it('should use stale cache when MAS fetch fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const principal = createPrincipal({ authProvider: 'auth0' });
      const staleTime = new Date(Date.now() - 600_000);

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockRejectedValue(new Error('Network error')),
        cacheTtlSeconds: 300,
      });

      database.on(userSiteRoles).select.returns([
        { role: 'admin', source: 'mas', updatedAt: staleTime },
      ]);

      const result = await getEffectiveRole(
        principal, 'site-1', 'branch-1', masClient,
      );

      // Should fall back to stale cache
      expect(result.roleName).toBe('ADMIN');
      consoleSpy.mockRestore();
    });

    it('should fall back to JWT when both sources are NO_ACCESS and MAS returns null', async () => {
      const principal = createPrincipal({
        authProvider: 'auth0',
        pantheonSiteRoles: { 'site-1': 'admin' },
      });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue(null),
      });

      const result = await getEffectiveRole(
        principal, 'site-1', 'branch-1', masClient,
      );

      // Should fall back to JWT role
      expect(result.roleName).toBe('ADMIN');
    });

    it('should not use MAS for non-auth0 users', async () => {
      const principal = createPrincipal({
        authProvider: 'google',
        pantheonSiteRoles: { 'site-1': 'developer' },
      });

      const masClient = createMockMASClient();

      const result = await getEffectiveRole(
        principal, 'site-1', 'branch-1', masClient,
      );

      // Should NOT call MAS

      expect(masClient.getUserSiteRole).not.toHaveBeenCalled();
      // Should fall back to JWT
      expect(result.roleName).toBe('EDITOR');
    });

    it('should not use MAS for agents', async () => {
      const principal = createPrincipal({
        type: 'agent',
        authProvider: 'auth0',
      });

      const masClient = createMockMASClient();

      vi.mocked(query).mockResolvedValueOnce({ rows: [{ role: 'editor', implicit: false }] });

      const result = await getEffectiveRole(
        principal, 'site-1', 'branch-1', masClient,
      );

      expect(masClient.getUserSiteRole).not.toHaveBeenCalled();
      expect(result.roleName).toBe('EDITOR');
    });
  });

  describe('Backwards compatibility (no MAS client)', () => {
    it('should work identically without masClient', async () => {
      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'admin' },
      });

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

      expect(result.roleName).toBe('ADMIN');
    });

    it('should use database role when available without masClient', async () => {
      const principal = createPrincipal({
        pantheonSiteRoles: {},
      });

      database.on(userSiteRoles).select.returns([{ role: 'admin' }]);

      const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

      expect(result.roleName).toBe('ADMIN');
    });
  });

  describe('assertPermission with MAS client', () => {
    it('should pass MAS client through to getEffectiveRole', async () => {
      const principal = createPrincipal({
        authProvider: 'auth0',
      });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('admin'),
      });

      await expect(
        assertPermission(
          principal, 'site-1', 'branch-1', 'canManageGrants', masClient,
        ),
      ).resolves.not.toThrow();
    });

    it('should throw when MAS-resolved role lacks permission', async () => {
      const principal = createPrincipal({
        authProvider: 'auth0',
      });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('developer'),
      });

      await expect(
        assertPermission(
          principal, 'site-1', 'branch-1', 'canManageGrants', masClient,
        ),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('hasPermission with MAS client', () => {
    it('should pass MAS client through', async () => {
      const principal = createPrincipal({
        authProvider: 'auth0',
      });

      const masClient = createMockMASClient({
        getUserSiteRole: vi.fn().mockResolvedValue('admin'),
      });

      const result = await hasPermission(
        principal, 'site-1', 'branch-1', 'canManageGrants', masClient,
      );
      expect(result).toBe(true);
    });
  });
});
