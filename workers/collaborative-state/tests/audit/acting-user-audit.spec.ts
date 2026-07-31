/**
 * Acting-User Audit Tests
 */

import { describe, it, expect } from 'vitest';
import { createAuditEvent } from '../../src/audit/emitter';

describe('Acting-User Audit', () => {
  // Test 64: Audit context includes acting-user fields
  it('should include actingUserId and actingUserEmail in audit context when provided', () => {
    const event = createAuditEvent({
      action: 'document.update',
      actor: { id: 'agent-1', type: 'agent' },
      resource: { type: 'document', id: 'doc-1', siteId: 'site-1' },
      context: {
        actingUserId: 'user-uuid-123',
        actingUserEmail: 'user@example.com',
        editSessionId: 'session-abc',
      },
      success: true,
    });

    expect(event.context.actingUserId).toBe('user-uuid-123');
    expect(event.context.actingUserEmail).toBe('user@example.com');
  });

  // Test 65: Backwards compatible without acting-user
  it('should work without acting-user fields (backwards compatible)', () => {
    const event = createAuditEvent({
      action: 'document.update',
      actor: { id: 'agent-1', type: 'agent' },
      resource: { type: 'document', id: 'doc-1', siteId: 'site-1' },
      context: { editSessionId: 'session-abc' },
      success: true,
    });

    expect(event.context.actingUserId).toBeUndefined();
    expect(event.context.actingUserEmail).toBeUndefined();
  });

  // Test 66: Preserves all existing context fields
  it('should preserve all existing context fields alongside acting-user', () => {
    const event = createAuditEvent({
      action: 'document.update',
      actor: { id: 'agent-1', type: 'agent' },
      resource: { type: 'document', id: 'doc-1', siteId: 'site-1' },
      context: {
        actingUserId: 'u1',
        actingUserEmail: 'u@ex.com',
        editSessionId: 'sess-1',
        branchName: 'feature',
      },
      success: true,
    });

    expect(event.context.actingUserId).toBe('u1');
    expect(event.context.actingUserEmail).toBe('u@ex.com');
    expect(event.context.editSessionId).toBe('sess-1');
    expect(event.context.branchName).toBe('feature');
  });
});
