/**
 * MAS Client Tests
 *
 * Tests for the MAS REST client with mocked fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MASClient } from '../../src/services/mas-client';

// Mock global fetch
const mockFetch = vi.fn();

describe('MASClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('should create client with minimal config', () => {
      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
      });
      expect(client).toBeDefined();
      expect(client.cacheTtlSeconds).toBe(300);
    });

    it('should use custom cache TTL', () => {
      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        cacheTtlSeconds: 600,
      });
      expect(client.cacheTtlSeconds).toBe(600);
    });

    it('should handle invalid GCP key JSON gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: 'not-valid-json',
      });
      expect(client).toBeDefined();
      consoleSpy.mockRestore();
    });
  });

  describe('getUserSiteRole', () => {
    it('should return null when no GCP key is configured', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
      });

      const role = await client.getUserSiteRole('user-1', 'site-1');
      expect(role).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return the correct role for a user on a site', async () => {
      // Mock the identity token exchange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id_token: 'mock-identity-token' }),
        })
        // Mock the MAS memberships API call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [
              { user_id: 'user-1', role: 'admin' },
              { user_id: 'user-2', role: 'developer' },
            ],
            page_info: { has_next_page: false },
          }),
        });

      // Create a client with mock GCP key
      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: JSON.stringify({
          client_email: 'test@test.iam.gserviceaccount.com',
          private_key: 'mock-key',
          project_id: 'test-project',
        }),
      });

      // Mock the crypto operations
      const originalSubtle = globalThis.crypto?.subtle;
      vi.stubGlobal('crypto', {
        subtle: {
          importKey: vi.fn().mockResolvedValue('mock-crypto-key'),
          sign: vi.fn().mockResolvedValue(new ArrayBuffer(256)),
        },
      });

      const role = await client.getUserSiteRole('user-1', 'site-1');
      expect(role).toBe('admin');

      // Restore crypto
      if (originalSubtle !== undefined) {
        vi.stubGlobal('crypto', { subtle: originalSubtle });
      }
    });

    it('should return null when user is not a member', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id_token: 'mock-identity-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [
              { user_id: 'user-2', role: 'developer' },
            ],
            page_info: { has_next_page: false },
          }),
        });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: JSON.stringify({
          client_email: 'test@test.iam.gserviceaccount.com',
          private_key: 'mock-key',
          project_id: 'test-project',
        }),
      });

      vi.stubGlobal('crypto', {
        subtle: {
          importKey: vi.fn().mockResolvedValue('mock-crypto-key'),
          sign: vi.fn().mockResolvedValue(new ArrayBuffer(256)),
        },
      });

      const role = await client.getUserSiteRole('user-1', 'site-1');
      expect(role).toBeNull();
    });

    it('should return null on HTTP error from MAS', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id_token: 'mock-identity-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: JSON.stringify({
          client_email: 'test@test.iam.gserviceaccount.com',
          private_key: 'mock-key',
          project_id: 'test-project',
        }),
      });

      vi.stubGlobal('crypto', {
        subtle: {
          importKey: vi.fn().mockResolvedValue('mock-crypto-key'),
          sign: vi.fn().mockResolvedValue(new ArrayBuffer(256)),
        },
      });

      const role = await client.getUserSiteRole('user-1', 'site-1');
      expect(role).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('getSiteMemberships', () => {
    it('should return null when no GCP key is configured', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
      });

      const result = await client.getSiteMemberships('site-1');
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return mapped memberships', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id_token: 'mock-identity-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [
              { user_id: 'user-1', role: 'admin' },
              { user_id: 'user-2', role: 'team_member' },
              { user_id: 'user-3', role: 'developer' },
            ],
            page_info: { has_next_page: false },
          }),
        });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: JSON.stringify({
          client_email: 'test@test.iam.gserviceaccount.com',
          private_key: 'mock-key',
          project_id: 'test-project',
        }),
      });

      vi.stubGlobal('crypto', {
        subtle: {
          importKey: vi.fn().mockResolvedValue('mock-crypto-key'),
          sign: vi.fn().mockResolvedValue(new ArrayBuffer(256)),
        },
      });

      const result = await client.getSiteMemberships('site-1');
      expect(result).toEqual([
        { userId: 'user-1', role: 'admin' },
        { userId: 'user-2', role: 'team_member' },
        { userId: 'user-3', role: 'developer' },
      ]);
    });

    it('should handle pagination', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id_token: 'mock-identity-token' }),
        })
        // Page 1
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [{ user_id: 'user-1', role: 'admin' }],
            page_info: { has_next_page: true, next_page_token: 'page2' },
          }),
        })
        // Page 2
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [{ user_id: 'user-2', role: 'developer' }],
            page_info: { has_next_page: false },
          }),
        });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: JSON.stringify({
          client_email: 'test@test.iam.gserviceaccount.com',
          private_key: 'mock-key',
          project_id: 'test-project',
        }),
      });

      vi.stubGlobal('crypto', {
        subtle: {
          importKey: vi.fn().mockResolvedValue('mock-crypto-key'),
          sign: vi.fn().mockResolvedValue(new ArrayBuffer(256)),
        },
      });

      const result = await client.getSiteMemberships('site-1');
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { userId: 'user-1', role: 'admin' },
        { userId: 'user-2', role: 'developer' },
      ]);
    });
  });

  describe('identity token caching', () => {
    it('should cache the identity token and reuse it', async () => {
      mockFetch
        // First call: token exchange
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id_token: 'cached-token' }),
        })
        // First call: MAS API
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [{ user_id: 'user-1', role: 'admin' }],
            page_info: { has_next_page: false },
          }),
        })
        // Second call: MAS API (should reuse token, no second token exchange)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [{ user_id: 'user-2', role: 'developer' }],
            page_info: { has_next_page: false },
          }),
        });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: JSON.stringify({
          client_email: 'test@test.iam.gserviceaccount.com',
          private_key: 'mock-key',
          project_id: 'test-project',
        }),
      });

      vi.stubGlobal('crypto', {
        subtle: {
          importKey: vi.fn().mockResolvedValue('mock-crypto-key'),
          sign: vi.fn().mockResolvedValue(new ArrayBuffer(256)),
        },
      });

      await client.getUserSiteRole('user-1', 'site-1');
      await client.getUserSiteRole('user-2', 'site-2');

      // Token exchange should only be called once (first mockFetch call)
      // Total calls: 1 (token) + 1 (MAS site-1) + 1 (MAS site-2) = 3
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
