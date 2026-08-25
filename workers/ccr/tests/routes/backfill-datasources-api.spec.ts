/**
 * Backfill Datasources API Route Tests
 *
 * Tests for POST /api/admin/backfill-datasources endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

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
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('handleBackfillDatasources', () => {
    it('should reject non-admin users', async () => {
      const { handleBackfillDatasources } = await import('../../src/routes/backfill-datasources-api');
      const db = await import('../../src/db');

      // No users in table (bootstrap mode would allow, but we have users)
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: '5' }], command: '', rowCount: 0, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ system_role: 'member' }], command: '', rowCount: 0, oid: 0, fields: [] });

      const request = new Request('http://localhost/api/admin/backfill-datasources', {
        method: 'POST',
      });

      const response = await handleBackfillDatasources(request, nonAdminPrincipal);
      expect(response.status).toBe(403);
    });

    it('should backfill datasources and queries for templates missing them', async () => {
      const { handleBackfillDatasources } = await import('../../src/routes/backfill-datasources-api');
      const db = await import('../../src/db');
      const branchService = await import('../../src/services/branch-service');
      const branchDocService = await import('../../src/services/branch-document-service');
      const templateHooks = await import('../../src/services/template-hooks');

      // Admin check: user count > 0, user is admin
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: '1' }], command: '', rowCount: 0, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ system_role: 'admin' }], command: '', rowCount: 0, oid: 0, fields: [] })
        // List all active sites
        .mockResolvedValueOnce({
          rows: [
            { id: 'site-1', name: 'Site One' },
            { id: 'site-2', name: 'Site Two' },
          ],
          command: '', rowCount: 0, oid: 0, fields: [],
        });

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
      });
      expect(templateHooks.onTemplateCreated).toHaveBeenCalledWith({
        siteId: 'site-1',
        branchId: 'branch-1',
        templateName: 'news',
        templateId: 'doc-2',
        createdById: 'admin-1',
      });
    });

    it('should be idempotent — re-running produces zero errors', async () => {
      const { handleBackfillDatasources } = await import('../../src/routes/backfill-datasources-api');
      const db = await import('../../src/db');
      const branchService = await import('../../src/services/branch-service');
      const branchDocService = await import('../../src/services/branch-document-service');
      const templateHooks = await import('../../src/services/template-hooks');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: '1' }], command: '', rowCount: 0, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ system_role: 'admin' }], command: '', rowCount: 0, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'site-1', name: 'Site One' }], command: '', rowCount: 0, oid: 0, fields: [] });

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
      const db = await import('../../src/db');
      const branchService = await import('../../src/services/branch-service');
      const branchDocService = await import('../../src/services/branch-document-service');
      const templateHooks = await import('../../src/services/template-hooks');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: '1' }], command: '', rowCount: 0, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ system_role: 'admin' }], command: '', rowCount: 0, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'site-1', name: 'Site One' }], command: '', rowCount: 0, oid: 0, fields: [] });

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
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: '0' }], command: '', rowCount: 0, oid: 0, fields: [] });

      const request = new Request('http://localhost/api/admin/backfill-datasources', {
        method: 'GET',
      });

      const response = await handleBackfillDatasources(request, adminPrincipal);
      expect(response.status).toBe(405);
    });
  });
});
