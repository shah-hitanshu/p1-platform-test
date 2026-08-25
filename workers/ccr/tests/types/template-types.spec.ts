/**
 * Type Tests for Migration 039: Template Support
 *
 * Tests for template-related TypeScript types added for PROPOSAL-010.
 */

import { describe, it, expect } from 'vitest';
import type {
  Document,
  CheckpointType,
  MigrationJob,
  MigrationConflict,
  MigrationJobStatus,
  MigrationResolution,
} from '../../src/types';

describe('Template Type Extensions', () => {
  describe('Document type', () => {
    it('should allow templateId and templateVersion fields', () => {
      const doc: Document = {
        id: '123',
        siteId: '456',
        path: '/page',
        createdAt: '2026-01-01T00:00:00Z',
        templateId: 'template-123',
        templateVersion: 5,
      };

      expect(doc.templateId).toBe('template-123');
      expect(doc.templateVersion).toBe(5);
    });

    it('should allow Document without template fields', () => {
      const doc: Document = {
        id: '123',
        siteId: '456',
        path: '/page',
        createdAt: '2026-01-01T00:00:00Z',
      };

      expect(doc.templateId).toBeUndefined();
      expect(doc.templateVersion).toBeUndefined();
    });
  });

  describe('CheckpointType', () => {
    it('should include pre_migration', () => {
      const type: CheckpointType = 'pre_migration';
      expect(type).toBe('pre_migration');
    });

    it('should accept all checkpoint types', () => {
      const types: CheckpointType[] = [
        'manual',
        'auto',
        'pre_merge',
        'post_merge',
        'publish',
        'session_pre_edit',
        'session_post_edit',
        'agent_pre_edit',
        'agent_post_edit',
        'pre_migration',
      ];

      expect(types).toHaveLength(10);
      expect(types).toContain('pre_migration');
    });
  });

  describe('MigrationJobStatus', () => {
    it('should include pending', () => {
      const status: MigrationJobStatus = 'pending';
      expect(status).toBe('pending');
    });

    it('should include in_progress', () => {
      const status: MigrationJobStatus = 'in_progress';
      expect(status).toBe('in_progress');
    });

    it('should include completed', () => {
      const status: MigrationJobStatus = 'completed';
      expect(status).toBe('completed');
    });

    it('should include failed', () => {
      const status: MigrationJobStatus = 'failed';
      expect(status).toBe('failed');
    });
  });

  describe('MigrationResolution', () => {
    it('should include apply', () => {
      const resolution: MigrationResolution = 'apply';
      expect(resolution).toBe('apply');
    });

    it('should include skip', () => {
      const resolution: MigrationResolution = 'skip';
      expect(resolution).toBe('skip');
    });

    it('should include manual', () => {
      const resolution: MigrationResolution = 'manual';
      expect(resolution).toBe('manual');
    });
  });

  describe('MigrationJob interface', () => {
    it('should construct a valid migration job', () => {
      const job: MigrationJob = {
        id: 'job-123',
        siteId: 'site-456',
        branchId: 'branch-789',
        templateId: 'template-abc',
        fromVersion: 1,
        toVersion: 2,
        checkpointId: 'checkpoint-xyz',
        status: 'pending',
        totalDocuments: 10,
        processedDocuments: 0,
        createdById: 'user-123',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
      };

      expect(job.status).toBe('pending');
      expect(job.fromVersion).toBe(1);
      expect(job.toVersion).toBe(2);
      expect(job.checkpointId).toBe('checkpoint-xyz');
    });

    it('should allow migration job without checkpoint', () => {
      const job: MigrationJob = {
        id: 'job-123',
        siteId: 'site-456',
        branchId: 'branch-789',
        templateId: 'template-abc',
        fromVersion: 1,
        toVersion: 2,
        status: 'pending',
        totalDocuments: 10,
        processedDocuments: 0,
        createdById: 'user-123',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
      };

      expect(job.checkpointId).toBeUndefined();
    });

    it('should allow completedAt for completed jobs', () => {
      const job: MigrationJob = {
        id: 'job-123',
        siteId: 'site-456',
        branchId: 'branch-789',
        templateId: 'template-abc',
        fromVersion: 1,
        toVersion: 2,
        status: 'completed',
        totalDocuments: 10,
        processedDocuments: 10,
        createdById: 'user-123',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:10:00Z',
      };

      expect(job.completedAt).toBe('2026-01-01T00:10:00Z');
    });
  });

  describe('MigrationConflict interface', () => {
    it('should construct a valid migration conflict', () => {
      const conflict: MigrationConflict = {
        id: 'conflict-123',
        migrationJobId: 'job-456',
        documentId: 'doc-789',
        branchId: 'branch-abc',
        templateId: 'template-def',
        fromVersion: 1,
        toVersion: 2,
        templateDelta: { added: [], removed: ['CtaBlock-cccc'], moved: [], templateIds: ['CtaBlock-cccc'] },
        documentDelta: { added: [], removed: [], moved: [], templateIds: [] },
        createdAt: '2026-01-01T00:00:00Z',
      };

      expect(conflict.migrationJobId).toBe('job-456');
      expect(conflict.documentId).toBe('doc-789');
      expect(conflict.templateDelta).toEqual({ added: [], removed: ['CtaBlock-cccc'], moved: [], templateIds: ['CtaBlock-cccc'] });
      expect(conflict.documentDelta).toEqual({ added: [], removed: [], moved: [], templateIds: [] });
    });

    it('should allow resolution and resolvedAt for resolved conflicts', () => {
      const conflict: MigrationConflict = {
        id: 'conflict-123',
        migrationJobId: 'job-456',
        documentId: 'doc-789',
        branchId: 'branch-abc',
        templateId: 'template-def',
        fromVersion: 1,
        toVersion: 2,
        templateDelta: { added: [], removed: ['CtaBlock-cccc'], moved: [], templateIds: ['CtaBlock-cccc'] },
        documentDelta: { added: [], removed: [], moved: [], templateIds: [] },
        resolution: 'apply',
        createdAt: '2026-01-01T00:00:00Z',
        resolvedAt: '2026-01-01T00:05:00Z',
      };

      expect(conflict.resolution).toBe('apply');
      expect(conflict.resolvedAt).toBe('2026-01-01T00:05:00Z');
    });
  });
});
