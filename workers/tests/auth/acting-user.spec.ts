/**
 * Acting-User Extraction Tests
 */

import { describe, it, expect } from 'vitest';

describe('Acting-User Extraction', () => {
  describe('extractActingUser', () => {
    // Test 48: Extract headers for agent principal
    it('should extract acting-user headers when principal is agent type', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user');
      const headers = new Headers({
        'X-Acting-User-Id': 'user-uuid-123',
        'X-Acting-User-Email': 'user@example.com',
      });
      const principal = { type: 'agent' as const, id: 'agent-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toEqual({
        actingUserId: 'user-uuid-123',
        actingUserEmail: 'user@example.com',
      });
    });

    // Test 49: Ignore for user principals
    it('should return null when principal is user type', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user');
      const headers = new Headers({
        'X-Acting-User-Id': 'spoofed-user-id',
        'X-Acting-User-Email': 'spoofed@example.com',
      });
      const principal = { type: 'user' as const, id: 'user-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });

    // Test 50: Ignore for service principals
    it('should return null when principal is service type', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user');
      const headers = new Headers({
        'X-Acting-User-Id': 'spoofed-user-id',
        'X-Acting-User-Email': 'spoofed@example.com',
      });
      const principal = { type: 'service' as const, id: 'service-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });

    // Test 51: Null when agent has no headers
    it('should return null when agent has no acting-user headers', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user');
      const headers = new Headers();
      const principal = { type: 'agent' as const, id: 'agent-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });

    // Test 52: Null when only one header present
    it('should return null when only one of two required headers is present', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user');
      const headers = new Headers({
        'X-Acting-User-Id': 'user-uuid-123',
      });
      const principal = { type: 'agent' as const, id: 'agent-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });

    // Test 53a: Ignore for guest principals
    it('should return null when principal is guest type', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user');
      const headers = new Headers({
        'X-Acting-User-Id': 'spoofed-guest-id',
        'X-Acting-User-Email': 'guest@example.com',
      });
      const principal = { type: 'guest' as const, id: 'guest-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });

    // Test 53: Header spoofing rejected
    it('should silently reject header spoofing by user principal', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user');
      const headers = new Headers({
        'X-Acting-User-Id': 'attacker-id',
        'X-Acting-User-Email': 'attacker@evil.com',
      });
      const principal = { type: 'user' as const, id: 'real-user' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });
  });
});
