/**
 * Migration conflict resolution routes.
 *
 * Resolving a conflict whose stored delta predates the id-keyed engine is a
 * client-visible condition: the route answers 409 with the guidance to re-run
 * the migration, not an opaque 500.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/migration-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/migration-service')>();
  return {
    ...actual,
    getMigrationJob: vi.fn(),
    listMigrationConflicts: vi.fn(),
    resolveMigrationConflict: vi.fn(),
  };
});

vi.mock('../../src/auth/authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/auth/authorization')>();
  return {
    ...actual,
    getEffectiveRole: vi.fn(),
    assertPermission: vi.fn(),
  };
});

vi.mock('../../src/services', () => ({
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
  getMainBranch: vi.fn(),
}));

import { handleMigrationRoutes } from '../../src/routes/migration-api';
import {
  getMigrationJob,
  resolveMigrationConflict,
  LegacyConflictDeltaError,
} from '../../src/services/migration-service';
import { getEffectiveRole } from '../../src/auth/authorization';
import { getBranch } from '../../src/services';
import type { AuthenticatedPrincipal } from '../../src/types';
import { readJson } from '../helpers/http';

const SITE_ID = 'site-1';
const BRANCH_ID = '11111111-2222-3333-4444-555555555555';
const JOB_ID = 'job-1';
const CONFLICT_ID = 'conflict-1';

const PRINCIPAL = {
  id: 'user-1',
  type: 'user',
  dbUserId: 'user-1',
} as unknown as AuthenticatedPrincipal;

function resolveRequest(): Request {
  return new Request('http://internal/resolve', {
    method: 'POST',
    body: JSON.stringify({ resolution: 'apply' }),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('handleMigrationRoutes: conflict resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getBranch).mockResolvedValue({ id: BRANCH_ID, siteId: SITE_ID } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({ roleName: 'ADMIN' } as never);
    vi.mocked(getMigrationJob).mockResolvedValue({
      id: JOB_ID,
      siteId: SITE_ID,
      branchId: BRANCH_ID,
    } as never);
  });

  it('answers 409 with re-run guidance when the stored delta predates the id-keyed engine', async () => {
    vi.mocked(resolveMigrationConflict).mockRejectedValue(
      new LegacyConflictDeltaError(CONFLICT_ID),
    );

    const response = await handleMigrationRoutes(resolveRequest(), {
      siteId: SITE_ID,
      branchId: BRANCH_ID,
      jobId: JOB_ID,
      conflictId: CONFLICT_ID,
      action: 'resolve',
      principal: PRINCIPAL,
    });

    expect(response.status).toBe(409);
    const body = await readJson(response);
    expect(body.error).toMatch(/legacy/i);
    expect(body.error).toMatch(/re-run/i);
  });

  it('keeps unexpected errors as 500', async () => {
    vi.mocked(resolveMigrationConflict).mockRejectedValue(new Error('boom'));

    const response = await handleMigrationRoutes(resolveRequest(), {
      siteId: SITE_ID,
      branchId: BRANCH_ID,
      jobId: JOB_ID,
      conflictId: CONFLICT_ID,
      action: 'resolve',
      principal: PRINCIPAL,
    });

    expect(response.status).toBe(500);
  });
});
