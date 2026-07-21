/**
 * Acting-User Integration Tests
 *
 * Tests that acting-user fields are correctly attached to principals.
 */

import { describe, it, expect } from 'vitest';
import { extractActingUser } from '../../src/auth/acting-user';

describe('Acting-User Integration', () => {
  // Test 94: Fields attached to principal after extraction
  it('should attach acting-user fields to principal', () => {
    const headers = new Headers({
      'X-Acting-User-Id': 'user-uuid-123',
      'X-Acting-User-Email': 'user@example.com',
    });
    const principal: Record<string, string> & { type: string } = {
      type: 'agent',
      id: 'agent-1',
    };

    const actingUser = extractActingUser(headers, principal as { type: string });
    if (actingUser) {
      principal.actingUserId = actingUser.actingUserId;
      principal.actingUserEmail = actingUser.actingUserEmail;
    }

    expect(principal.actingUserId).toBe('user-uuid-123');
    expect(principal.actingUserEmail).toBe('user@example.com');
  });

  // Test 95: Non-agent principals not mutated
  it('should not mutate non-agent principals', () => {
    const headers = new Headers({
      'X-Acting-User-Id': 'spoofed-id',
      'X-Acting-User-Email': 'spoofed@example.com',
    });
    const principal: Record<string, string> & { type: string } = {
      type: 'user',
      id: 'user-1',
    };

    const actingUser = extractActingUser(headers, principal as { type: string });
    if (actingUser) {
      principal.actingUserId = actingUser.actingUserId;
      principal.actingUserEmail = actingUser.actingUserEmail;
    }

    expect(principal.actingUserId).toBeUndefined();
    expect(principal.actingUserEmail).toBeUndefined();
  });
});
