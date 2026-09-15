/**
 * Phase 3.1: Site Service Tests (TDD)
 *
 * Tests for Site CRUD operations.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowSettings } from '../../src/types';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { agents, agentSiteRoles, branches, sites, userSiteRoles } from '../../src/db/schema';

// Mock the screenshot producer so we can assert when the trigger fires.
vi.mock('../../src/queues/screenshot-producer', () => ({
  requestSiteScreenshot: vi.fn().mockResolvedValue(undefined),
}));

// Mock the branch-document-service and checkpoint-publish so root-page seeding
// inside createSite does not add unexpected statements.
vi.mock('../../src/services/branch-document-service', () => ({
  createDocumentOnBranch: vi.fn().mockResolvedValue({ document: { id: 'seeded-doc' }, version: { id: 'v1' } }),
}));
vi.mock('../../src/services/checkpoint-publish', () => ({
  publishDocument: vi.fn().mockResolvedValue({ checkpoint: { id: 'cp1' } }),
}));

describe('Phase 3.1: Site Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.clearAllMocks();
    database = stubDatabase();
  });

  // Default workflow settings as defined in schema
  const defaultWorkflowSettings: WorkflowSettings = {
    mergeApprovalMode: 'optional',
    minApprovers: 1,
    allowSelfApproval: true,
    approverMode: 'both',
    approverMinRole: 'EDITOR',
  };

  /** A site row in the schema's property names. */
  function siteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'site-uuid-123',
      pantheonSiteId: 'pantheon-site-abc',
      organizationId: null,
      name: 'Test Site',
      url: null,
      workflowSettings: defaultWorkflowSettings,
      settings: {},
      allowedOrigins: [],
      createdAt: '2026-01-23T10:00:00.000Z',
      updatedAt: '2026-01-23T10:00:00.000Z',
      archivedAt: null,
      ...overrides,
    };
  }

  function mainBranchRow(siteId: string, createdById = 'creator-user-id'): Record<string, unknown> {
    return {
      id: 'branch-1',
      siteId,
      name: 'main',
      description: 'Main branch',
      status: 'active',
      isMain: true,
      sourceBranchId: null,
      sourceCheckpointId: null,
      createdById,
      createdByType: 'user',
      createdAt: '2026-01-23T10:00:00.000Z',
      updatedAt: '2026-01-23T10:00:00.000Z',
      archivedAt: null,
    };
  }

  /** What an UPDATE assigns, without the RETURNING list that follows it. */
  function setClause(sql: string): string {
    return sql.slice(sql.indexOf(' set '), sql.indexOf(' where '));
  }

  /** A driver error carrying a SQLSTATE, as the stub will wrap it. */
  function driverError(code: string): Error {
    const error = new Error('constraint violation') as NodeJS.ErrnoException;
    error.code = code;
    return error;
  }

  /** The site insert and main-branch insert every creation makes. */
  function stubSiteCreation(row: Record<string, unknown>): void {
    database.on(sites).insert.returns([row]);
    database.on(branches).insert.returns([mainBranchRow(row.id as string)]);
  }

  describe('createSite', () => {
    it('should create a site with all fields', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow());

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
        workflowSettings: {
          mergeApprovalMode: 'required',
          minApprovers: 2,
        },
      });

      expect(result).toBeDefined();
      expect(result.pantheonSiteId).toBe('pantheon-site-abc');
      expect(result.name).toBe('Test Site');
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a site with default workflow settings when not provided', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow());

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-xyz',
        name: 'Another Site',
      });

      expect(result.workflowSettings).toEqual(defaultWorkflowSettings);
    });

    it('should merge partial workflow settings with defaults', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const customSettings: WorkflowSettings = {
        ...defaultWorkflowSettings,
        mergeApprovalMode: 'required',
        minApprovers: 3,
      };
      stubSiteCreation(siteRow({ workflowSettings: customSettings }));

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-xyz',
        name: 'Site with Custom Settings',
        workflowSettings: {
          mergeApprovalMode: 'required',
          minApprovers: 3,
        },
      });

      expect(result.workflowSettings.mergeApprovalMode).toBe('required');
      expect(result.workflowSettings.minApprovers).toBe(3);
      // Defaults should be preserved for unspecified fields
      expect(result.workflowSettings.allowSelfApproval).toBe(true);
    });

    it('should throw DuplicatePantheonSiteIdError for duplicate pantheonSiteId', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const { DuplicatePantheonSiteIdError } = await import('../../src/services/errors');
      database.on(sites).insert.rejects(driverError('23505'));

      await expect(
        createSite({
          pantheonSiteId: 'existing-site-id',
          name: 'Duplicate Site',
        }),
      ).rejects.toThrow(DuplicatePantheonSiteIdError);
    });

    it('should create a site without a pantheonSiteId, storing null', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow({ pantheonSiteId: null }));

      const result = await createSite({ name: 'Unlinked Site' });

      expect(result.pantheonSiteId).toBeUndefined();
      const [insert] = database.calls(sites).insert;
      expect(insert?.params[0]).toBeNull();
    });

    it('should store null when pantheonSiteId is blank', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow({ pantheonSiteId: null }));

      await createSite({ pantheonSiteId: '   ', name: 'Site' });

      const [insert] = database.calls(sites).insert;
      expect(insert?.params[0]).toBeNull();
    });

    it('should validate required name field', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const { InvalidSiteParamsError } = await import('../../src/services/errors');

      await expect(
        createSite({
          pantheonSiteId: 'valid-id',
          name: '',
        }),
      ).rejects.toThrow(InvalidSiteParamsError);
    });

    it('should include INSERT query with correct columns', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow());

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
      });

      const [insert] = database.calls(sites).insert;
      expect(insert?.params).toEqual(
        expect.arrayContaining(['pantheon-site-abc', 'Test Site']),
      );
    });

    it('should insert owner role in user_site_roles when creatorId is provided', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow({ id: 'site-new-123' }));

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
        creatorId: 'creator-user-id',
      });

      // The site, the role grant and the main branch, and nothing else.
      expect(database.statements).toHaveLength(3);
      const [grant] = database.calls(userSiteRoles).insert;
      expect(grant?.params).toEqual(
        expect.arrayContaining(['creator-user-id', 'site-new-123', 'owner', 'local']),
      );
    });

    it('should not insert any role when creatorId is omitted', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow());

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
      });

      // The site and the main branch — no role grant.
      expect(database.statements).toHaveLength(2);
      expect(database.calls(userSiteRoles).insert).toHaveLength(0);
      expect(database.calls(agentSiteRoles).insert).toHaveLength(0);
    });

    it('should insert admin role in agent_site_roles when createdByType is agent', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow({ id: 'site-agent-123' }));
      database.on(agentSiteRoles).insert.returns([
        {
          id: 'role-1',
          agentId: 'agent-1',
          siteId: 'site-agent-123',
          role: 'admin',
          createdById: 'agent-1',
          createdAt: new Date('2026-01-23T10:00:00.000Z'),
          revokedAt: null,
        },
      ]);

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Agent Site',
        creatorId: 'agent-1',
        createdByType: 'agent',
      });

      expect(database.statements).toHaveLength(3);
      const [grant] = database.calls(agentSiteRoles).insert;
      expect(grant?.params).toEqual(
        expect.arrayContaining(['agent-1', 'site-agent-123', 'admin']),
      );
    });

    it('should not insert into user_site_roles when createdByType is agent', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow({ id: 'site-agent-456' }));
      database.on(agentSiteRoles).insert.returns([
        {
          id: 'role-1',
          agentId: 'agent-1',
          siteId: 'site-agent-456',
          role: 'admin',
          createdById: 'agent-1',
          createdAt: new Date('2026-01-23T10:00:00.000Z'),
          revokedAt: null,
        },
      ]);

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Agent Site',
        creatorId: 'agent-1',
        createdByType: 'agent',
      });

      expect(database.calls(userSiteRoles).insert).toHaveLength(0);
    });
  });

  describe('getSite', () => {
    it('should return site when found', async () => {
      const { getSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123' })]);

      const result = await getSite('site-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('site-123');
      expect(result?.pantheonSiteId).toBe('pantheon-site-abc');
      expect(result?.name).toBe('Test Site');
    });

    it('should return null when site not found', async () => {
      const { getSite } = await import('../../src/services/site-service');

      const result = await getSite('non-existent-id');

      expect(result).toBeNull();
    });

    it('should include workflow settings in response', async () => {
      const { getSite } = await import('../../src/services/site-service');
      const customSettings: WorkflowSettings = {
        mergeApprovalMode: 'required',
        minApprovers: 2,
        allowSelfApproval: false,
        approverMode: 'explicit',
        approverMinRole: 'ADMIN',
      };
      database.on(sites).select.returns([siteRow({ workflowSettings: customSettings })]);

      const result = await getSite('site-123');

      expect(result?.workflowSettings).toEqual(customSettings);
    });

    it('should query by site ID', async () => {
      const { getSite } = await import('../../src/services/site-service');

      await getSite('site-uuid-456');

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"id"');
      expect(call?.params).toEqual(expect.arrayContaining(['site-uuid-456']));
    });
  });

  describe('getSiteByPantheonId', () => {
    it('should return site when found by Pantheon ID', async () => {
      const { getSiteByPantheonId } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ pantheonSiteId: 'my-pantheon-site' })]);

      const result = await getSiteByPantheonId('my-pantheon-site');

      expect(result).not.toBeNull();
      expect(result?.pantheonSiteId).toBe('my-pantheon-site');
    });

    it('should return null when Pantheon ID not found', async () => {
      const { getSiteByPantheonId } = await import('../../src/services/site-service');

      const result = await getSiteByPantheonId('non-existent-pantheon-id');

      expect(result).toBeNull();
    });

    it('should query by pantheon_site_id column', async () => {
      const { getSiteByPantheonId } = await import('../../src/services/site-service');

      await getSiteByPantheonId('pantheon-abc');

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"pantheon_site_id"');
      expect(call?.params).toEqual(expect.arrayContaining(['pantheon-abc']));
    });
  });

  describe('updateSite', () => {
    it('should update site name', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).update.returns([
        siteRow({ id: 'site-123', name: 'Updated Name', updatedAt: '2026-01-23T12:00:00.000Z' }),
      ]);

      const result = await updateSite('site-123', { name: 'Updated Name' });

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Updated Name');
    });

    it('should update workflow settings partially', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123' })]);
      database.on(sites).update.returns([
        siteRow({ id: 'site-123', workflowSettings: { ...defaultWorkflowSettings, minApprovers: 5 } }),
      ]);

      const result = await updateSite('site-123', {
        workflowSettings: { minApprovers: 5 },
      });

      expect(result?.workflowSettings.minApprovers).toBe(5);
    });

    it('should merge workflow settings without overwriting entire object', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123' })]);
      database.on(sites).update.returns([
        siteRow({
          id: 'site-123',
          workflowSettings: { ...defaultWorkflowSettings, mergeApprovalMode: 'required' },
        }),
      ]);

      const result = await updateSite('site-123', {
        workflowSettings: { mergeApprovalMode: 'required' },
      });

      // Should preserve existing settings not being updated
      expect(result?.workflowSettings.allowSelfApproval).toBe(true);
      expect(result?.workflowSettings.mergeApprovalMode).toBe('required');
      // The merge happens here, not in the statement: the whole object is
      // written, serialized as jsonb.
      const [update] = database.calls(sites).update;
      expect(update?.params).toContain(
        JSON.stringify({ ...defaultWorkflowSettings, mergeApprovalMode: 'required' }),
      );
    });

    it('should update pantheonSiteId', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).update.returns([
        siteRow({ id: 'site-123', pantheonSiteId: 'new-pantheon-id' }),
      ]);

      const result = await updateSite('site-123', { pantheonSiteId: 'new-pantheon-id' });

      expect(result?.pantheonSiteId).toBe('new-pantheon-id');
      const [update] = database.calls(sites).update;
      expect(update?.sql).toContain('"pantheon_site_id"');
      expect(update?.params).toContain('new-pantheon-id');
    });

    it('should clear pantheonSiteId when null is passed', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).update.returns([siteRow({ id: 'site-123', pantheonSiteId: null })]);

      const result = await updateSite('site-123', { pantheonSiteId: null });

      expect(result?.pantheonSiteId).toBeUndefined();
      const [update] = database.calls(sites).update;
      expect(update?.sql).toContain('"pantheon_site_id"');
      expect(update?.params).toContain(null);
    });

    it('should leave pantheonSiteId untouched when omitted', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).update.returns([siteRow({ id: 'site-123' })]);

      await updateSite('site-123', { name: 'New Name' });

      // A column the caller did not name is not assigned at all. RETURNING
      // still lists it, so only the SET clause answers this.
      const [update] = database.calls(sites).update;
      expect(setClause(update?.sql ?? '')).not.toContain('"pantheon_site_id"');
    });

    it('should update pantheonSiteId alongside workflowSettings', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123' })]);
      database.on(sites).update.returns([
        siteRow({ id: 'site-123', pantheonSiteId: 'new-pantheon-id' }),
      ]);

      const result = await updateSite('site-123', {
        workflowSettings: { mergeApprovalMode: 'required' },
        pantheonSiteId: 'new-pantheon-id',
      });

      expect(result?.pantheonSiteId).toBe('new-pantheon-id');
      const [update] = database.calls(sites).update;
      expect(update?.sql).toContain('"pantheon_site_id"');
      expect(update?.sql).toContain('"workflow_settings"');
      expect(update?.params).toEqual(
        expect.arrayContaining(['new-pantheon-id', 'site-123']),
      );
    });

    it('should throw DuplicatePantheonSiteIdError when the new id is taken', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const { DuplicatePantheonSiteIdError } = await import('../../src/services/errors');
      database.on(sites).update.rejects(driverError('23505'));

      await expect(
        updateSite('site-123', { pantheonSiteId: 'taken-id' }),
      ).rejects.toThrow(DuplicatePantheonSiteIdError);
    });

    it('should update updatedAt timestamp', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const originalTime = '2026-01-23T10:00:00.000Z';
      const updatedTime = '2026-01-23T14:00:00.000Z';
      database.on(sites).update.returns([
        siteRow({ id: 'site-123', createdAt: originalTime, updatedAt: updatedTime }),
      ]);

      const result = await updateSite('site-123', { name: 'New Name' });

      expect(result?.updatedAt).toBe(updatedTime);
      expect(result?.createdAt).toBe(originalTime);
    });

    it('should return null when site not found', async () => {
      const { updateSite } = await import('../../src/services/site-service');

      const result = await updateSite('non-existent', { name: 'New Name' });

      expect(result).toBeNull();
    });

    it('should update both name and workflow settings in single call', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123' })]);
      database.on(sites).update.returns([
        siteRow({
          id: 'site-123',
          name: 'New Site Name',
          workflowSettings: { ...defaultWorkflowSettings, minApprovers: 3 },
        }),
      ]);

      const result = await updateSite('site-123', {
        name: 'New Site Name',
        workflowSettings: { minApprovers: 3 },
      });

      expect(result?.name).toBe('New Site Name');
      expect(result?.workflowSettings.minApprovers).toBe(3);
    });

    it('should clear allowedOrigins when passed an empty array', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).update.returns([siteRow({ id: 'site-123', allowedOrigins: [] })]);

      const result = await updateSite('site-123', { allowedOrigins: [] });

      expect(result).not.toBeNull();
      expect(result?.allowedOrigins).toEqual([]);
      // An empty array is a value, not an omission: it overwrites.
      const [update] = database.calls(sites).update;
      expect(update?.sql).toContain('"allowed_origins"');
    });
  });

  describe('deleteSite', () => {
    it('should delete site and related data when found', async () => {
      const { deleteSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123' })]);
      database.on(branches).select.returns([{ id: 'branch-1' }]);
      database.on(sites).delete.returns([{ id: 'site-123' }]);

      const result = await deleteSite('site-123');

      expect(result).toBe(true);
    });

    it('should return false when site not found', async () => {
      const { deleteSite } = await import('../../src/services/site-service');

      const result = await deleteSite('non-existent');

      expect(result).toBe(false);
    });

    it('should cascade delete branches and related data', async () => {
      const { deleteSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-to-delete' })]);
      database.on(branches).select.returns([{ id: 'branch-1' }, { id: 'branch-2' }]);
      database.on(sites).delete.returns([{ id: 'site-to-delete' }]);

      await deleteSite('site-to-delete');

      // Everything that references the site goes first, the site itself last.
      const deleted = database.statements
        .filter((statement) => statement.sql.startsWith('delete from'))
        .map((statement) => statement.sql);
      expect(deleted[deleted.length - 1]).toContain('"app"."sites"');
      expect(deleted).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"app"."merge_requests"'),
          expect.stringContaining('"app"."branch_document_paths"'),
          expect.stringContaining('"app"."checkpoints"'),
          expect.stringContaining('"app"."document_versions"'),
          expect.stringContaining('"app"."branches"'),
          expect.stringContaining('"app"."documents"'),
        ]),
      );
      const [siteDelete] = database.calls(sites).delete;
      expect(siteDelete?.params).toContain('site-to-delete');
    });
  });

  describe('listSites', () => {
    it('should return sites for the given user', async () => {
      const { listSites } = await import('../../src/services/site-service');
      database.on(sites).select.returns([
        siteRow({ id: 'site-1', name: 'Site 1' }),
        siteRow({ id: 'site-2', name: 'Site 2' }),
        siteRow({ id: 'site-3', name: 'Site 3' }),
      ]);

      const result = await listSites({ principalId: 'user-1' });

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('site-1');
      expect(result[1].id).toBe('site-2');
      expect(result[2].id).toBe('site-3');
    });

    it('should support limit option', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'user-1', limit: 2 });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toMatch(/limit/i);
      expect(call?.params).toEqual(expect.arrayContaining([2]));
    });

    it('should support offset option', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'user-1', offset: 10 });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toMatch(/offset/i);
      expect(call?.params).toEqual(expect.arrayContaining([10]));
    });

    it('should support both limit and offset options', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'user-1', limit: 25, offset: 50 });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toMatch(/limit.*offset|offset.*limit/i);
      expect(call?.params).toEqual(expect.arrayContaining([25, 50]));
    });

    it('should return empty array when user has no sites', async () => {
      const { listSites } = await import('../../src/services/site-service');

      const result = await listSites({ principalId: 'user-1' });

      expect(result).toEqual([]);
    });

    it('should map all rows to Site objects', async () => {
      const { listSites } = await import('../../src/services/site-service');
      database.on(sites).select.returns([
        siteRow({ id: 'site-1', pantheonSiteId: 'pantheon-1', name: 'First Site' }),
      ]);

      const result = await listSites({ principalId: 'user-1' });

      expect(result[0]).toMatchObject({
        id: 'site-1',
        pantheonSiteId: 'pantheon-1',
        name: 'First Site',
      });
    });

    it('should filter by principalId when provided', async () => {
      const { listSites } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-1', name: 'My Site' })]);

      const result = await listSites({ principalId: 'user-abc' });

      expect(result).toHaveLength(1);
      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"app"."user_site_roles"');
      expect(call?.params).toEqual(expect.arrayContaining(['user-abc']));
    });

    it('should support pagination with principalId filtering', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'user-abc', limit: 10, offset: 20 });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"app"."user_site_roles"');
      expect(call?.sql).toMatch(/limit/i);
      expect(call?.sql).toMatch(/offset/i);
    });

    it('should return empty array when user has no site roles', async () => {
      const { listSites } = await import('../../src/services/site-service');

      const result = await listSites({ principalId: 'user-no-sites' });

      expect(result).toEqual([]);
    });

    // PCC-3874 / PCC-3872 regression. A superadmin holds no site role in an
    // account they administer, so joining user_site_roles returned an empty
    // list for every organization the switcher offered them.
    describe('includeAllOrgSites', () => {
      it('should list every site in the organization without joining site roles', async () => {
        const { listSites } = await import('../../src/services/site-service');
        database.on(sites).select.returns([siteRow({ id: 'site-1', name: 'Someone Elses Site' })]);

        const result = await listSites({
          principalId: 'superadmin-with-no-role-here',
          organizationId: 'org-1',
          includeAllOrgSites: true,
        });

        expect(result).toHaveLength(1);
        const [call] = database.calls(sites).select;
        expect(call?.sql).not.toContain('user_site_roles');
        expect(call?.sql).toContain('"organization_id"');
        // The principal is not a bind parameter on this path.
        expect(call?.params).toEqual(['org-1']);
      });

      it('should still filter by archived status and paginate', async () => {
        const { listSites } = await import('../../src/services/site-service');

        await listSites({
          principalId: 'admin-1',
          organizationId: 'org-1',
          includeAllOrgSites: true,
          archived: true,
          limit: 10,
          offset: 20,
        });

        const [call] = database.calls(sites).select;
        expect(call?.sql).toContain('"archived_at" is not null');
        expect(call?.params).toEqual(['org-1', 10, 20]);
      });

      it('should keep the site-role join when the flag is not set', async () => {
        const { listSites } = await import('../../src/services/site-service');

        await listSites({ principalId: 'user-abc', organizationId: 'org-1' });

        const [call] = database.calls(sites).select;
        expect(call?.sql).toContain('"app"."user_site_roles"');
        expect(call?.params).toEqual(['user-abc', 'org-1']);
      });

      it('should ignore the flag without an organizationId', async () => {
        const { listSites } = await import('../../src/services/site-service');

        await listSites({ principalId: 'admin-1', includeAllOrgSites: true });

        const [call] = database.calls(sites).select;
        expect(call?.sql).toContain('"app"."user_site_roles"');
        expect(call?.params).toEqual(['admin-1']);
      });
    });

    it('should use DISTINCT to deduplicate multi-source roles', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'user-abc' });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toMatch(/select distinct/i);
    });

    it('should query agent_site_roles when principalType is agent', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'agent-abc', principalType: 'agent' });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"app"."agent_site_roles"');
      expect(call?.sql).toContain('"revoked_at" is null');
      expect(call?.params).toEqual(expect.arrayContaining(['agent-abc']));
    });

    it('should support pagination with agent principalType', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'agent-abc', principalType: 'agent', limit: 10, offset: 20 });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"app"."agent_site_roles"');
      expect(call?.sql).toMatch(/limit/i);
      expect(call?.sql).toMatch(/offset/i);
    });

    // A global agent's implicit access is delegated from the acting user, so its
    // listing is that user's sites rather than its own grants.
    it('lists by the acting user, not the agent grant, for a global agent', async () => {
      const { listSites } = await import('../../src/services/site-service');
      database.on(agents).select.returns([{ isGlobal: true }]);

      await listSites({
        principalId: 'agent-abc',
        principalType: 'agent',
        actingUserId: 'db-user-xyz',
      });

      const [call] = database.calls(sites).select;
      expect(call?.sql).not.toContain('agent_site_roles');
      expect(call?.sql).toContain('"app"."user_site_roles"');
      expect(call?.params).toContain('db-user-xyz');
      expect(call?.params).not.toContain('agent-abc');
    });

    // Without an acting user there is nothing to bound the widening, so it must
    // not happen at all — one key would otherwise enumerate every site.
    it('does not widen for a global agent with no acting user', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'agent-abc', principalType: 'agent' });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"app"."agent_site_roles"');
      expect(call?.params).toContain('agent-abc');
    });

    it('binds the organization and the acting user as separate parameters', async () => {
      const { listSites } = await import('../../src/services/site-service');
      database.on(agents).select.returns([{ isGlobal: true }]);

      await listSites({
        principalId: 'agent-abc',
        principalType: 'agent',
        actingUserId: 'db-user-xyz',
        organizationId: 'org-1',
      });

      const [call] = database.calls(sites).select;
      expect(call?.params).toEqual(['db-user-xyz', 'org-1']);
    });

    // ---------------------------------------------------------------------
    // PCC-3190: when an agent acts on behalf of a user, the result must be
    // intersected with the acting user's user_site_roles so the agent
    // cannot leak sites the user has no access to.
    // ---------------------------------------------------------------------
    describe('PCC-3190: agent + actingUserId intersection', () => {
      it('should join user_site_roles when actingUserId is provided with agent principal', async () => {
        const { listSites } = await import('../../src/services/site-service');

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
          actingUserId: 'db-user-xyz',
        });

        const [call] = database.calls(sites).select;
        // Both joins must be present so the result intersects agent + user roles.
        expect(call?.sql).toContain('"app"."agent_site_roles"');
        expect(call?.sql).toContain('"app"."user_site_roles"');
        // Both ids must be in the parameter list.
        expect(call?.params).toContain('agent-abc');
        expect(call?.params).toContain('db-user-xyz');
      });

      it('should NOT join user_site_roles when actingUserId is absent (legacy agent path)', async () => {
        const { listSites } = await import('../../src/services/site-service');

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
        });

        const [call] = database.calls(sites).select;
        // Legacy agent calls (no acting user) keep the original shape so direct
        // agent traffic continues to work as before.
        expect(call?.sql).toContain('"app"."agent_site_roles"');
        expect(call?.sql).not.toContain('"app"."user_site_roles"');
      });

      it('should ignore actingUserId for user principals (not used in user-scoped flow)', async () => {
        const { listSites } = await import('../../src/services/site-service');

        await listSites({
          principalId: 'user-1',
          principalType: 'user',
          actingUserId: 'should-be-ignored',
        });

        const [call] = database.calls(sites).select;
        // User principals already filter by the user's own role table; the
        // actingUserId concept does not apply to them.
        expect(call?.sql).toContain('"app"."user_site_roles"');
        expect(call?.sql).not.toContain('agent_site_roles');
        expect(call?.params).not.toContain('should-be-ignored');
      });

      it('should support pagination with agent + actingUserId intersection', async () => {
        const { listSites } = await import('../../src/services/site-service');

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
          actingUserId: 'db-user-xyz',
          limit: 10,
          offset: 20,
        });

        const [call] = database.calls(sites).select;
        expect(call?.sql).toContain('"app"."agent_site_roles"');
        expect(call?.sql).toContain('"app"."user_site_roles"');
        expect(call?.sql).toMatch(/limit/i);
        expect(call?.sql).toMatch(/offset/i);
      });

      it('should still respect agent_site_roles.revoked_at IS NULL when intersecting', async () => {
        const { listSites } = await import('../../src/services/site-service');

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
          actingUserId: 'db-user-xyz',
        });

        const [call] = database.calls(sites).select;
        // The revoked_at filter must remain even with the user join, otherwise
        // revoked agent grants could come back through the intersection.
        expect(call?.sql).toContain('"revoked_at" is null');
      });
    });
  });

  describe('getSiteAllowedOrigins', () => {
    it('should return string[] for a known site with origins configured', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      database.on(sites).select.returns([
        { allowedOrigins: ['https://mysite.com', '*-mysite.pantheonsite.io'] },
      ]);

      const result = await getSiteAllowedOrigins('site-123');

      expect(result).toEqual(['https://mysite.com', '*-mysite.pantheonsite.io']);
    });

    it('should return null for an unknown siteId (site not found)', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');

      const result = await getSiteAllowedOrigins('non-existent-site');

      expect(result).toBeNull();
    });

    // app.sites.allowed_origins is NOT NULL DEFAULT '{}', so a site that
    // configured none reads as an empty array rather than a missing one.
    it('should return empty array for a site with an empty allowed_origins array in DB', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      database.on(sites).select.returns([{ allowedOrigins: [] }]);

      const result = await getSiteAllowedOrigins('site-no-origins');

      expect(result).toEqual([]);
    });

    it('should propagate DB errors', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      database.on(sites).select.rejects(new Error('DB connection error'));

      await expect(getSiteAllowedOrigins('site-123')).rejects.toThrow();
    });

    it('should query by site ID with correct column', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');

      await getSiteAllowedOrigins('site-uuid-456');

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"allowed_origins"');
      expect(call?.params).toEqual(expect.arrayContaining(['site-uuid-456']));
    });
  });

  describe('Error Classes', () => {
    it('DuplicatePantheonSiteIdError should be an instance of Error', async () => {
      const { DuplicatePantheonSiteIdError } = await import('../../src/services/errors');

      const error = new DuplicatePantheonSiteIdError('pantheon-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('DuplicatePantheonSiteIdError');
      expect(error.pantheonSiteId).toBe('pantheon-123');
    });

    it('InvalidSiteParamsError should be an instance of Error', async () => {
      const { InvalidSiteParamsError } = await import('../../src/services/errors');

      const error = new InvalidSiteParamsError('name is required');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidSiteParamsError');
      expect(error.message).toContain('name is required');
    });
  });

  describe('Site url field', () => {
    it('should persist url on createSite', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow({ url: 'https://example.com' }));

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
        url: 'https://example.com',
      });

      expect(result.url).toBe('https://example.com');
      const [insert] = database.calls(sites).insert;
      expect(insert?.params).toEqual(expect.arrayContaining(['https://example.com']));
    });

    it('should accept createSite without a url', async () => {
      const { createSite } = await import('../../src/services/site-service');
      stubSiteCreation(siteRow());

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
      });

      expect(result.url).toBeUndefined();
    });

    it('should reject createSite when url is malformed', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const { InvalidSiteParamsError } = await import('../../src/services/errors');

      await expect(
        createSite({
          pantheonSiteId: 'pantheon-site-abc',
          name: 'Test Site',
          url: 'not a url',
        }),
      ).rejects.toThrow(InvalidSiteParamsError);
    });

    it('should persist url on updateSite', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      database.on(sites).update.returns([
        siteRow({ id: 'site-123', url: 'https://new.example.com' }),
      ]);

      const result = await updateSite('site-123', { url: 'https://new.example.com' });

      expect(result?.url).toBe('https://new.example.com');
      const [update] = database.calls(sites).update;
      expect(update?.params).toEqual(expect.arrayContaining(['https://new.example.com']));
    });

    it('should reject updateSite when url is malformed', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const { InvalidSiteParamsError } = await import('../../src/services/errors');

      await expect(
        updateSite('site-123', { url: 'also not a url' }),
      ).rejects.toThrow(InvalidSiteParamsError);
    });

    it('should include url in getSite result when present in row', async () => {
      const { getSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([
        siteRow({ id: 'site-123', url: 'https://example.com' }),
      ]);

      const result = await getSite('site-123');

      expect(result?.url).toBe('https://example.com');
    });
  });

  describe('Screenshot trigger on url change', () => {
    const fakeEnv = { SCREENSHOT_QUEUE: { send: vi.fn() } };

    it('createSite with env and a url enqueues a screenshot request', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
      stubSiteCreation(siteRow({ id: 'site-99', url: 'https://example.com' }));

      await createSite(
        { pantheonSiteId: 'p1', name: 'S', url: 'https://example.com' },
        fakeEnv as unknown as Parameters<typeof createSite>[1],
      );

      expect(requestSiteScreenshot).toHaveBeenCalledWith(
        fakeEnv,
        expect.objectContaining({ id: 'site-99', url: 'https://example.com' }),
        'url_changed',
      );
    });

    it('createSite without env never triggers a screenshot', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
      stubSiteCreation(siteRow({ id: 'site-99', url: 'https://example.com' }));

      await createSite({ pantheonSiteId: 'p1', name: 'S', url: 'https://example.com' });

      expect(requestSiteScreenshot).not.toHaveBeenCalled();
    });

    it('createSite with env but no url does not trigger', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
      stubSiteCreation(siteRow());

      await createSite(
        { pantheonSiteId: 'p1', name: 'S' },
        fakeEnv as unknown as Parameters<typeof createSite>[1],
      );

      expect(requestSiteScreenshot).not.toHaveBeenCalled();
    });

    it('updateSite triggers when url is set to a new value', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
      database.on(sites).select.returns([siteRow({ id: 'site-77', url: 'https://old.example.com' })]);
      database.on(sites).update.returns([siteRow({ id: 'site-77', url: 'https://new.example.com' })]);

      await updateSite(
        'site-77',
        { url: 'https://new.example.com' },
        fakeEnv as unknown as Parameters<typeof updateSite>[2],
      );

      expect(requestSiteScreenshot).toHaveBeenCalledWith(
        fakeEnv,
        expect.objectContaining({ id: 'site-77', url: 'https://new.example.com' }),
        'url_changed',
      );
    });

    it('updateSite does not trigger when url is unchanged', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
      const sameUrl = 'https://example.com';
      database.on(sites).select.returns([siteRow({ id: 'site-77', url: sameUrl })]);
      database.on(sites).update.returns([siteRow({ id: 'site-77', url: sameUrl })]);

      await updateSite(
        'site-77',
        { url: sameUrl },
        fakeEnv as unknown as Parameters<typeof updateSite>[2],
      );

      expect(requestSiteScreenshot).not.toHaveBeenCalled();
    });

    it('updateSite without env never triggers', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
      database.on(sites).update.returns([siteRow({ id: 'site-77', url: 'https://new.example.com' })]);

      await updateSite('site-77', { url: 'https://new.example.com' });

      expect(requestSiteScreenshot).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // PCC-3211: Soft delete — archiveSite / restoreSite / listSites(archived)
  // ===========================================================================

  describe('archiveSite', () => {
    const archiveTs = new Date('2026-05-17T10:00:00.000Z');
    // Drizzle binds a timestamp column as the text Postgres parses.
    const boundTs = archiveTs.toISOString();

    it('should set archived_at on the site and cascade to branches and documents', async () => {
      const { archiveSite } = await import('../../src/services/site-service');
      database.on(sites).update.returns([{ archivedAt: archiveTs }]);

      const result = await archiveSite('site-123');

      expect(result).toBe(true);
    });

    it('should return false when site does not exist', async () => {
      const { archiveSite } = await import('../../src/services/site-service');

      const result = await archiveSite('non-existent');

      expect(result).toBe(false);
    });

    it('should return already_archived when site exists but is already archived', async () => {
      const { archiveSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([{ id: 'site-123' }]);

      const result = await archiveSite('site-123');

      expect(result).toBe('already_archived');
    });

    it('should cascade archived_at to branches and documents using the same timestamp', async () => {
      const { archiveSite } = await import('../../src/services/site-service');
      database.on(sites).update.returns([{ archivedAt: archiveTs }]);

      await archiveSite('site-123');

      const [branchUpdate] = database.calls(branches).update;
      const [documentUpdate] = database.calls('documents').update;
      expect(branchUpdate?.params).toContain(boundTs);
      expect(documentUpdate?.params).toContain(boundTs);
    });
  });

  describe('restoreSite', () => {
    const archiveTs = new Date('2026-05-17T10:00:00.000Z');
    const boundTs = archiveTs.toISOString();

    it('should clear archived_at on site and restore cascade-archived branches and documents', async () => {
      const { restoreSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123', archivedAt: archiveTs })]);
      database.on(sites).update.returns([siteRow({ id: 'site-123', archivedAt: null })]);

      const result = await restoreSite('site-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('site-123');
    });

    it('should return null when site not found', async () => {
      const { restoreSite } = await import('../../src/services/site-service');

      const result = await restoreSite('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when site is not archived', async () => {
      const { restoreSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123', archivedAt: null })]);

      const result = await restoreSite('site-123');

      expect(result).toBeNull();
    });

    it('should only restore branches/docs archived at the same timestamp (not independently-archived ones)', async () => {
      const { restoreSite } = await import('../../src/services/site-service');
      database.on(sites).select.returns([siteRow({ id: 'site-123', archivedAt: archiveTs })]);
      database.on(sites).update.returns([siteRow({ id: 'site-123', archivedAt: null })]);

      await restoreSite('site-123');

      const [branchRestore] = database.calls(branches).update;
      expect(branchRestore?.sql).toContain('"archived_at"');
      expect(branchRestore?.params).toContain(boundTs);
    });
  });

  describe('getCachedSiteAllowedOrigins (PCC-3334)', () => {
    it('should return origins from DB on first call', async () => {
      const { getCachedSiteAllowedOrigins } = await import('../../src/services/site-service');
      database.on(sites).select.returns([{ allowedOrigins: ['https://custom.example.com'] }]);

      const result = await getCachedSiteAllowedOrigins('site-123');

      expect(result).toEqual(['https://custom.example.com']);
      expect(database.calls(sites).select).toHaveLength(1);
    });

    it('should return cached result on second call without querying DB again', async () => {
      const { getCachedSiteAllowedOrigins } = await import('../../src/services/site-service');
      database.on(sites).select.returns([{ allowedOrigins: ['https://cached.example.com'] }]);

      // First call — hits DB
      await getCachedSiteAllowedOrigins('site-cache-test');
      // Second call — should use cache, not DB
      const result = await getCachedSiteAllowedOrigins('site-cache-test');

      expect(result).toEqual(['https://cached.example.com']);
      expect(database.calls(sites).select).toHaveLength(1);
    });

    it('should return null for unknown site and not cache it', async () => {
      const { getCachedSiteAllowedOrigins } = await import('../../src/services/site-service');

      const result = await getCachedSiteAllowedOrigins('nonexistent-site');
      expect(result).toBeNull();

      // Second call should also hit DB since null is not cached
      await getCachedSiteAllowedOrigins('nonexistent-site');
      expect(database.calls(sites).select).toHaveLength(2);
    });
  });

  describe('listSites — archived filter (PCC-3211)', () => {
    it('should exclude archived sites by default', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'user-1' });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"archived_at" is null');
    });

    it('should return only archived sites when archived=true', async () => {
      const { listSites } = await import('../../src/services/site-service');

      await listSites({ principalId: 'user-1', archived: true });

      const [call] = database.calls(sites).select;
      expect(call?.sql).toContain('"archived_at" is not null');
    });
  });

  describe('getSiteOwner', () => {
    it('returns the owner display name and avatar', async () => {
      const { getSiteOwner } = await import('../../src/services/site-service');
      database.on(userSiteRoles).select.returnsRaw([
        { ownerName: 'Alice Smith', avatarUrl: 'https://example.com/a.png' },
      ]);

      await expect(getSiteOwner('site-1')).resolves.toEqual({
        name: 'Alice Smith',
        avatarUrl: 'https://example.com/a.png',
      });
    });

    it('returns a null avatar when the user has no picture', async () => {
      const { getSiteOwner } = await import('../../src/services/site-service');
      database.on(userSiteRoles).select.returnsRaw([
        { ownerName: 'Alice Smith', avatarUrl: null },
      ]);

      await expect(getSiteOwner('site-1')).resolves.toEqual({
        name: 'Alice Smith',
        avatarUrl: null,
      });
    });

    it('falls back to the email when the user has no name set', async () => {
      const { getSiteOwner } = await import('../../src/services/site-service');
      database.on(userSiteRoles).select.returnsRaw([
        { ownerName: 'alice@example.com', avatarUrl: null },
      ]);

      await expect(getSiteOwner('site-1')).resolves.toMatchObject({
        name: 'alice@example.com',
      });
    });

    it('casts users.id to text — the join column is TEXT, not UUID', async () => {
      const { getSiteOwner } = await import('../../src/services/site-service');

      await getSiteOwner('site-1');

      const [call] = database.calls(userSiteRoles).select;
      expect(call?.sql).toContain('::text');
    });

    it('returns null for a site with no owner row', async () => {
      const { getSiteOwner } = await import('../../src/services/site-service');

      await expect(getSiteOwner('site-1')).resolves.toBeNull();
    });

    it('returns null when the owner grant has no matching user row', async () => {
      const { getSiteOwner } = await import('../../src/services/site-service');
      database.on(userSiteRoles).select.returnsRaw([{ ownerName: null, avatarUrl: null }]);

      await expect(getSiteOwner('site-1')).resolves.toBeNull();
    });
  });
});
