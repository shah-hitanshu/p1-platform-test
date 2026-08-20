/**
 * Template API — 202/waitUntil migration path
 *
 * When ExecutionContext and Env are provided, handleMigrateTemplate returns
 * 202 immediately and processes the migration in the background via
 * ctx.waitUntil. If the background migration fails, the catch branch marks
 * the job as failed.
 *
 * These tests exercise that async code path which is unreachable in
 * environments without ExecutionContext (standard unit tests, local dev).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../src/db', () => ({
  query: vi.fn(),
  runWithConnection: vi.fn(),
}));

vi.mock('../../src/services', () => ({
  getLatestDocumentVersion: vi.fn(),
  listDocumentsOnBranch: vi.fn(),
  createDocumentOnBranch: vi.fn(),
  createDocumentVersion: vi.fn(),
  getDocument: vi.fn(),
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
  deleteDocumentOnBranch: vi.fn(),
  documentExistsOnBranch: vi.fn(),
  DuplicateDocumentPathError: class extends Error {},
}));

vi.mock('../../src/auth/authorization', async () => {
  // Imported inside the factory because vi.mock is hoisted above the imports.
  const { ROLES } = await vi.importActual<typeof import('../../src/auth/roles')>(
    '../../src/auth/roles',
  );
  return {
    assertPermission: vi.fn().mockResolvedValue(undefined),
    getEffectiveRole: vi.fn().mockResolvedValue({ role: ROLES.ADMIN, roleName: 'ADMIN' }),
    AuthorizationError: class extends Error {},
  };
});

vi.mock('../../src/services/migration-service', () => ({
  triggerMigration: vi.fn(),
  processMigration: vi.fn(),
  rollbackMigration: vi.fn(),
  getMigrationStatus: vi.fn(),
  previewMigration: vi.fn(),
  TemplateNotFoundError: class extends Error {},
  InvalidVersionRangeError: class extends Error {},
  MigrationJobNotFoundError: class extends Error {},
}));

import { handleTemplateRequest } from '../../src/routes/template-api';
import type { TemplateRouteContext } from '../../src/routes/template-api';
import { runWithConnection, query } from '../../src/db';
import { getBranch } from '../../src/services';
import { assertPermission, getEffectiveRole } from '../../src/auth/authorization';
import { ROLES } from '../../src/auth/roles';
import { triggerMigration, processMigration } from '../../src/services/migration-service';
import { readJson } from '../helpers/http';
import { makeBranch } from '../helpers/branch';

describe('handleMigrateTemplate — 202/waitUntil path', () => {
  const siteId = 'site-uuid-001';
  const branchId = 'b0000000-0000-0000-0000-000000000001';
  const templateId = 'tmpl-uuid-001';

  function makeRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost/api/sites/' + siteId + '/branches/' + branchId + '/templates/' + templateId + '/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function makeContext(overrides: Partial<TemplateRouteContext> = {}): TemplateRouteContext {
    return {
      siteId,
      branchId,
      templateId,
      action: 'migrate',
      principal: {
        id: 'user-001',
        type: 'user',
        siteId,
        email: 'test@example.com',
      } as TemplateRouteContext['principal'],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();

    // Re-set authorization mocks after resetAllMocks clears them
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(getEffectiveRole).mockResolvedValue({ role: ROLES.ADMIN, roleName: 'ADMIN' });

    // runWithConnection defaults to executing the callback
    vi.mocked(runWithConnection).mockImplementation(async (_cs, _opts, fn) => {
      return await (fn)();
    });
    vi.mocked(processMigration).mockResolvedValue({
      processedDocuments: 5,
      conflictedDocuments: 0,
    });

    // getBranch resolves to a valid branch matching the siteId
    vi.mocked(getBranch).mockResolvedValue(makeBranch({
      id: branchId,
      siteId,
      name: 'main',
      isMain: true,
      createdById: 'user-001',
      createdAt: '2026-06-20T00:00:00Z',
    }));

    // triggerMigration returns a pending job
    vi.mocked(triggerMigration).mockResolvedValue({
      id: 'job-001',
      siteId,
      branchId,
      templateId,
      fromVersion: 1,
      toVersion: 2,
      checkpointId: 'chk-001',
      status: 'pending',
      totalDocuments: 5,
      processedDocuments: 0,
      createdById: 'user-001',
      createdByType: 'user',
      createdAt: '2026-06-20T00:00:00Z',
      completedAt: null,
    });
  });

  it('returns 202 with job when ctx and env are provided', async () => {
    const waitUntilFn = vi.fn();
    const ctx: ExecutionContext = {
      waitUntil: waitUntilFn,
      passThroughOnException: vi.fn(),
      abort: vi.fn(),
      props: {},
    };
    const env = {
      POSTGRES_CONNECTION_STRING: 'postgres://localhost/test',
      DOCUMENT_STATE: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    };

    const context = makeContext({ ctx, env: env as unknown as TemplateRouteContext['env'] });
    const request = makeRequest({ fromVersion: 1, toVersion: 2 });

    const response = await handleTemplateRequest(request, context);

    expect(response.status).toBe(202);
    const body = await readJson(response);
    expect(body.status).toBe('processing');
    expect(body.job.id).toBe('job-001');
    expect(waitUntilFn).toHaveBeenCalledOnce();
  });

  it('calls processMigration inside ctx.waitUntil via runWithConnection', async () => {
    let capturedPromise: Promise<unknown> | undefined;
    const waitUntilFn = vi.fn((p: Promise<unknown>) => { capturedPromise = p; });
    const ctx: ExecutionContext = {
      waitUntil: waitUntilFn,
      passThroughOnException: vi.fn(),
      abort: vi.fn(),
      props: {},
    };
    const env = {
      POSTGRES_CONNECTION_STRING: 'postgres://localhost/test',
      DOCUMENT_STATE: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    };

    const context = makeContext({ ctx, env: env as unknown as TemplateRouteContext['env'] });
    const request = makeRequest({ fromVersion: 1, toVersion: 2 });

    await handleTemplateRequest(request, context);

    // The promise passed to waitUntil should resolve successfully
    expect(capturedPromise).toBeDefined();
    await expect(capturedPromise).resolves.not.toThrow();
    // TODO: this suite asserts internal call shapes (exact args, query sequences)
    // rather than observable behaviour, so it breaks on unrelated refactors. Rework
    // it to drive the route and assert on responses/persisted state.
    expect(vi.mocked(processMigration).mock.calls[0]?.[0]).toBe('job-001');
  });

  it('marks job as failed when background migration throws', async () => {
    let capturedPromise: Promise<unknown> | undefined;
    const waitUntilFn = vi.fn((p: Promise<unknown>) => { capturedPromise = p; });
    const ctx: ExecutionContext = {
      waitUntil: waitUntilFn,
      passThroughOnException: vi.fn(),
      abort: vi.fn(),
      props: {},
    };
    const env = {
      POSTGRES_CONNECTION_STRING: 'postgres://localhost/test',
      DOCUMENT_STATE: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    };

    let callCount = 0;
    vi.mocked(runWithConnection).mockImplementation(async (_cs, _opts, fn) => {
      callCount++;
      if (callCount === 1) {
        // First call: processMigration — simulate failure
        throw new Error('Migration exploded');
      }
      // Second call: update job status to 'failed'
      return await (fn)();
    });
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 });

    const context = makeContext({ ctx, env: env as unknown as TemplateRouteContext['env'] });
    const request = makeRequest({ fromVersion: 1, toVersion: 2 });

    await handleTemplateRequest(request, context);

    // The catch branch should handle the error gracefully (no throw)
    expect(capturedPromise).toBeDefined();
    await expect(capturedPromise).resolves.not.toThrow();

    // The second runWithConnection call should have marked the job as failed
    expect(runWithConnection).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      ['job-001'],
    );
  });

  it('falls back to synchronous processMigration without ctx/env', async () => {
    vi.mocked(processMigration).mockResolvedValue({
      processedDocuments: 3,
      conflictedDocuments: 1,
    });

    const context = makeContext(); // No ctx or env
    const request = makeRequest({ fromVersion: 1, toVersion: 2 });

    const response = await handleTemplateRequest(request, context);

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.processedDocuments).toBe(3);
    expect(vi.mocked(processMigration).mock.calls[0]?.[0]).toBe('job-001');
  });
});
