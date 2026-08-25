/**
 * Phase 7.2: Audit Emitter Tests (TDD)
 *
 * Tests for audit event emission functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Phase 7.2: Audit Emitter', () => {
  let originalConsoleLog: typeof console.log;
  let consoleLogMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalConsoleLog = console.log;
    consoleLogMock = vi.fn();
    console.log = consoleLogMock;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    vi.clearAllMocks();
  });

  // ===========================================================================
  // LocalAuditEmitter
  // ===========================================================================

  describe('LocalAuditEmitter', () => {
    it('should emit audit event to console', async () => {
      const { LocalAuditEmitter } = await import('../../src/audit/emitter');

      const emitter = new LocalAuditEmitter();

      await emitter.emit({
        service: 'collaborative-state',
        action: 'branch.create',
        actor: { id: 'user-1', type: 'user' },
        resource: { type: 'branch', id: 'branch-1', siteId: 'site-1' },
        context: { branchName: 'feature' },
        timestamp: new Date('2026-01-24T10:00:00.000Z'),
        success: true,
      });

      expect(consoleLogMock).toHaveBeenCalledWith(
        '[AUDIT]',
        expect.stringContaining('branch.create'),
      );
    });

    it('should include error message for failed events', async () => {
      const { LocalAuditEmitter } = await import('../../src/audit/emitter');

      const emitter = new LocalAuditEmitter();

      await emitter.emit({
        service: 'collaborative-state',
        action: 'branch.create',
        actor: { id: 'user-1', type: 'user' },
        resource: { type: 'branch', id: 'branch-1', siteId: 'site-1' },
        context: {},
        timestamp: new Date('2026-01-24T10:00:00.000Z'),
        success: false,
        errorMessage: 'Duplicate branch name',
      });

      expect(consoleLogMock).toHaveBeenCalledWith(
        '[AUDIT]',
        expect.stringContaining('Duplicate branch name'),
      );
    });
  });

  // ===========================================================================
  // AuditEvent Type
  // ===========================================================================

  describe('AuditEvent Type', () => {
    it('should create valid audit events for branch operations', async () => {
      const { createAuditEvent } = await import('../../src/audit/emitter');

      const event = createAuditEvent({
        action: 'branch.create',
        actor: { id: 'user-1', type: 'user' },
        resource: { type: 'branch', id: 'branch-1', siteId: 'site-1' },
        context: { branchName: 'feature' },
        success: true,
      });

      expect(event.service).toBe('collaborative-state');
      expect(event.action).toBe('branch.create');
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should create valid audit events for checkpoint operations', async () => {
      const { createAuditEvent } = await import('../../src/audit/emitter');

      const event = createAuditEvent({
        action: 'checkpoint.create',
        actor: { id: 'user-1', type: 'user' },
        resource: { type: 'checkpoint', id: 'checkpoint-1', siteId: 'site-1' },
        context: { checkpointName: 'Feature complete' },
        success: true,
      });

      expect(event.action).toBe('checkpoint.create');
      expect(event.resource.type).toBe('checkpoint');
    });

    it('should create valid audit events for merge operations', async () => {
      const { createAuditEvent } = await import('../../src/audit/emitter');

      const event = createAuditEvent({
        action: 'merge.execute',
        actor: { id: 'user-1', type: 'user' },
        resource: { type: 'branch', id: 'target-branch', siteId: 'site-1' },
        context: { sourceBranchId: 'source-branch' },
        success: true,
      });

      expect(event.action).toBe('merge.execute');
    });

    it('should create valid audit events for grant operations', async () => {
      const { createAuditEvent } = await import('../../src/audit/emitter');

      const event = createAuditEvent({
        action: 'grant.create',
        actor: { id: 'admin-1', type: 'user' },
        resource: { type: 'grant', id: 'grant-1', siteId: 'site-1' },
        context: { granteeId: 'user-2', role: 'EDITOR' },
        success: true,
      });

      expect(event.action).toBe('grant.create');
      expect(event.resource.type).toBe('grant');
    });
  });

  // ===========================================================================
  // PantheonAuditEmitter (Stub for Production)
  // ===========================================================================

  describe('PantheonAuditEmitter', () => {
    it('should be available as a stub for production', async () => {
      const { PantheonAuditEmitter } = await import('../../src/audit/emitter');

      const emitter = new PantheonAuditEmitter();

      // Stub should not throw and just log a warning
      await expect(
        emitter.emit({
          service: 'collaborative-state',
          action: 'branch.create',
          actor: { id: 'user-1', type: 'user' },
          resource: { type: 'branch', id: 'branch-1', siteId: 'site-1' },
          context: {},
          timestamp: new Date(),
          success: true,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // getAuditEmitter Factory
  // ===========================================================================

  describe('getAuditEmitter', () => {
    it('should return LocalAuditEmitter in development', async () => {
      const { getAuditEmitter, LocalAuditEmitter } = await import(
        '../../src/audit/emitter'
      );

      const emitter = getAuditEmitter('development');

      expect(emitter).toBeInstanceOf(LocalAuditEmitter);
    });

    it('should return PantheonAuditEmitter in production', async () => {
      const { getAuditEmitter, PantheonAuditEmitter } = await import(
        '../../src/audit/emitter'
      );

      const emitter = getAuditEmitter('production');

      expect(emitter).toBeInstanceOf(PantheonAuditEmitter);
    });
  });
});
