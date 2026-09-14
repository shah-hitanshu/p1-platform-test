/**
 * Backfill Datasources API Route Tests
 *
 * Tests for POST /api/admin/backfill-datasources endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import { sites, users } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

vi.mock('../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
}));

vi.mock('../../src/services/branch-document-service', () => ({
  listDocumentsOnBranch: vi.fn(),
}));

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersion: vi.fn(),
}));

vi.mock('../../src/services/template-hooks', () => ({
  onTemplateCreated: vi.fn(),
}));

const adminPrincipal = { id: 'admin-1', type: 'user', dbUserId: 'admin-1' } as never;
const nonAdminPrincipal = { id: 'user-1', type: 'user', dbUserId: 'user-1' } as never;

describe('backfill-datasources-api', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
  });

  describe('handleBackfillDatasources', () => {
    it('should reject non-admin users', async () => {
      const { handleBackfillDatasources } = await import('../../src/routes/backfill-datasources-api');

      // No users in table (bootstrap mode would allow, but we have users). Both
      // isSystemAdmin queries land on the same users.select stub, so one row
      // carries the fields each of them reads.
      database.on(users).select.returnsRaw([{ count: 5, systemRole: 'member' }]);

      const request = new Request('http://localhost/api/admin/backfill-datasources', {
        method: 'POST',
      });

      const response = await handleBackfillDatasources(request, nonAdminPrincipal);
      expect(response.status).toBe(403);
    });

    it('should backfill datasources and queries for templates missing them', async () => {
      const { handleBackfillDatasources } = await import('../../src/routes/backfill-datasources-api');
      const branchService = await import('../../src/services/branch-service');
      const branchDocService = await import('../../src/services/branch-document-service');
      const templateHooks = await import('../../src/services/template-hooks');

      // Admin check: user count > 0, user is admin
      database.on(users).select.returnsRaw([{ count: 1, systemRole: 'superadmin' }]);
      // List all active sites
      database.on(sites).select.returns([
        { id: 'site-1', name: 'Site One' },
        { id: 'site-2', name: 'Site Two' },
      ]);

      // Site 1 has main branch, Site 2 has no main branch
      vi.mocked(branchService.getMainBranch)
        .mockResolvedValueOnce({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true } as never)
        .mockResolvedValueOnce(null);

      // Site 1 has two templates on its main branch
      vi.mocked(branchDocService.listDocumentsOnBranch)
        .mockResolvedValueOnce([
          { id: 'doc-1', path: '_registry/templates/blog', siteId: 'site-1', createdAt: '' },
          { id: 'doc-2', path: '_registry/templates/news', siteId: 'site-1', createdAt: '' },
        ] as never);

      // onTemplateCreated succeeds for both
      vi.mocked(templateHooks.onTemplateCreated).mockResolvedValue({ datasourceCreated: true, queryCreated: true, errors: [] });

      const request = new Request('http://localhost/api/admin/backfill-datasources', {
        method: 'POST',
      });

      const response = await handleBackfillDatasources(request, adminPrincipal);
      expect(response.status).toBe(200);

      const body = await readJson(response);
      expect(body.sitesProcessed).toBe(1);
      expect(body.sitesSkipped).toBe(1);
      expect(body.templatesProcessed).toBe(2);

      expect(templateHooks.onTemplateCreated).toHaveBeenCalledTimes(2);
      expect(templateHooks.onTemplateCreated).toHaveBeenCalledWith({
        siteId: 'site-1',
        branchId: 'branch-1',
        templateName: 'blog',
        templateId: 'doc-1',
        createdById: 'admin-1',
        mainBranchId: 'branch-1',
      });
      expect(templateHooks.onTemplateCreated).toHaveBeenCalledWith({
        siteId: 'site-1',
        branchId: 'branch-1',
        templateName: 'news',
        templateId: 'doc-2',
        createdById: 'admin-1',
        mainBranchId: 'branch-1',
      });
    });

    it('should be idempotent — re-running produces zero errors', async () => {
      const { handleBackfillDatasources } = await import('../../src/routes/backfill-datasources-api');
      const branchService = await import('../../src/services/branch-service');
      const branchDocService = await import('../../src/services/branch-document-service');
      const templateHooks = await import('../../src/services/template-hooks');

      database.on(users).select.returnsRaw([{ count: 1, systemRole: 'superadmin' }]);
      database.on(sites).select.returns([{ id: 'site-1', name: 'Site One' }]);

      vi.mocked(branchService.getMainBranch)
        .mockResolvedValueOnce({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true } as never);

      vi.mocked(branchDocService.listDocumentsOnBranch)
        .mockResolvedValueOnce([
          { id: 'doc-1', path: '_registry/templates/blog', siteId: 'site-1', createdAt: '' },
        ] as never);

      // onTemplateCreated is idempotent — succeeds silently even if already exists
      vi.mocked(templateHooks.onTemplateCreated).mockResolvedValue({ datasourceCreated: true, queryCreated: true, errors: [] });

      const request = new Request('http://localhost/api/admin/backfill-datasources', {
        method: 'POST',
      });

      const response = await handleBackfillDatasources(request, adminPrincipal);
      expect(response.status).toBe(200);

      const body = await readJson(response);
      expect(body.errors).toHaveLength(0);
    });

    it('should report errors per-template without aborting the batch', async () => {
      const { handleBackfillDatasources } = await import('../../src/routes/backfill-datasources-api');
      const branchService = await import('../../src/services/branch-service');
      const branchDocService = await import('../../src/services/branch-document-service');
      const templateHooks = await import('../../src/services/template-hooks');

      database.on(users).select.returnsRaw([{ count: 1, systemRole: 'superadmin' }]);
      database.on(sites).select.returns([{ id: 'site-1', name: 'Site One' }]);

      vi.mocked(branchService.getMainBranch)
        .mockResolvedValueOnce({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true } as never);

      vi.mocked(branchDocService.listDocumentsOnBranch)
        .mockResolvedValueOnce([
          { id: 'doc-1', path: '_registry/templates/blog', siteId: 'site-1', createdAt: '' },
          { id: 'doc-2', path: '_registry/templates/news', siteId: 'site-1', createdAt: '' },
        ] as never);

      // First template has errors, second succeeds
      vi.mocked(templateHooks.onTemplateCreated)
        .mockResolvedValueOnce({ datasourceCreated: false, queryCreated: false, errors: ['datasource: DB connection lost'] })
        .mockResolvedValueOnce({ datasourceCreated: true, queryCreated: true, errors: [] });

      const request = new Request('http://localhost/api/admin/backfill-datasources', {
        method: 'POST',
      });

      const response = await handleBackfillDatasources(request, adminPrincipal);
      expect(response.status).toBe(200);

      const body = await readJson(response);
      expect(body.templatesProcessed).toBe(2);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].template).toBe('blog');
      expect(body.errors[0].siteId).toBe('site-1');
    });

    it('should reject non-POST methods', async () => {
      const { handleBackfillDatasources } = await import('../../src/routes/backfill-datasources-api');

      // Bootstrap mode: no users yet, so isSystemAdmin passes without a second query
      // (the default: an unstubbed select returns no rows).

      const request = new Request('http://localhost/api/admin/backfill-datasources', {
        method: 'GET',
      });

      const response = await handleBackfillDatasources(request, adminPrincipal);
      expect(response.status).toBe(405);
    });
  });
});
