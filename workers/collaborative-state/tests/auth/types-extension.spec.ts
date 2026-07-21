/**
 * AuthenticatedPrincipal Type Extension Tests
 */

import { describe, it, expect } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

describe('AuthenticatedPrincipal Type Extension', () => {
  // Test 96: Accepts actingUserId
  it('should accept actingUserId on AuthenticatedPrincipal', () => {
    const principal: AuthenticatedPrincipal = {
      id: 'agent-1',
      type: 'agent',
      pantheonSiteRoles: {},
      tokenExpiry: '2026-12-31T00:00:00Z',
      actingUserId: 'test-user-id',
    };
    expect(principal.actingUserId).toBe('test-user-id');
  });

  // Test 97: Accepts actingUserEmail
  it('should accept actingUserEmail on AuthenticatedPrincipal', () => {
    const principal: AuthenticatedPrincipal = {
      id: 'agent-1',
      type: 'agent',
      pantheonSiteRoles: {},
      tokenExpiry: '2026-12-31T00:00:00Z',
      actingUserEmail: 'test@example.com',
    };
    expect(principal.actingUserEmail).toBe('test@example.com');
  });

  // Test 98: Both fields optional
  it('should work without acting-user fields', () => {
    const principal: AuthenticatedPrincipal = {
      id: 'agent-1',
      type: 'agent',
      pantheonSiteRoles: {},
      tokenExpiry: '2026-12-31T00:00:00Z',
    };
    expect(principal.actingUserId).toBeUndefined();
    expect(principal.actingUserEmail).toBeUndefined();
  });
});
