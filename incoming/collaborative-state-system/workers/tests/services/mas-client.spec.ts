/**
 * MAS Client Tests
 *
 * Tests for the MAS REST client with mocked fetch and GCP auth.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MASClient } from '../../src/services/mas-client';

vi.mock('../../src/services/gcp-auth.js', () => ({
  getGcpIdentityToken: vi.fn(),
}));

const mockFetch = vi.fn();

describe('MASClient', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();

    const { getGcpIdentityToken } = await import('../../src/services/gcp-auth.js');
    vi.mocked(getGcpIdentityToken).mockReset();
    vi.mocked(getGcpIdentityToken).mockResolvedValue('mock-identity-token');
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            { user_id: 'user-1', role: 'admin' },
            { user_id: 'user-2', role: 'developer' },
          ],
          page_info: { has_next_page: false },
        }),
      });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: '{"client_email":"test@test.iam.gserviceaccount.com","private_key":"mock","project_id":"test"}',
      });

      const role = await client.getUserSiteRole('user-1', 'site-1');
      expect(role).toBe('admin');
    });

    it('should return null when user is not a member', async () => {
      mockFetch.mockResolvedValueOnce({
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
        gcpServiceAccountKey: '{"client_email":"test@test.iam.gserviceaccount.com","private_key":"mock","project_id":"test"}',
      });

      const role = await client.getUserSiteRole('user-1', 'site-1');
      expect(role).toBeNull();
    });

    it('should return null on HTTP error from MAS', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: '{"client_email":"test@test.iam.gserviceaccount.com","private_key":"mock","project_id":"test"}',
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
      mockFetch.mockResolvedValueOnce({
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
        gcpServiceAccountKey: '{"client_email":"test@test.iam.gserviceaccount.com","private_key":"mock","project_id":"test"}',
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
          json: () => Promise.resolve({
            data: [{ user_id: 'user-1', role: 'admin' }],
            page_info: { has_next_page: true, next_page_token: 'page2' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [{ user_id: 'user-2', role: 'developer' }],
            page_info: { has_next_page: false },
          }),
        });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: '{"client_email":"test@test.iam.gserviceaccount.com","private_key":"mock","project_id":"test"}',
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
    it('should use shared GCP auth for identity tokens', async () => {
      const { getGcpIdentityToken } = await import('../../src/services/gcp-auth.js');

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [{ user_id: 'user-1', role: 'admin' }],
            page_info: { has_next_page: false },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [{ user_id: 'user-2', role: 'developer' }],
            page_info: { has_next_page: false },
          }),
        });

      const client = new MASClient({
        baseUrl: 'https://memberships.svc.pantheon.io',
        gcpServiceAccountKey: '{"client_email":"test@test.iam.gserviceaccount.com","private_key":"mock","project_id":"test"}',
      });

      await client.getUserSiteRole('user-1', 'site-1');
      await client.getUserSiteRole('user-2', 'site-2');

      expect(getGcpIdentityToken).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
