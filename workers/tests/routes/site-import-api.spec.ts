/**
 * Site Import API Handler Tests (PCC-3249)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { AuthenticatedPrincipal } from '../../src/types';

vi.mock('../../src/services/site-service', () => ({ getSite: vi.fn(), updateSite: vi.fn() }));
vi.mock('../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
  createBranch: vi.fn(),
  listBranches: vi.fn(),
}));
vi.mock('../../src/services/document-service', () => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
}));
vi.mock('../../src/services/document-version-service', () => ({
  createDocumentVersion: vi.fn(),
}));
vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn().mockResolvedValue({ checkpoint: { id: 'mock-checkpoint-id' } }),
}));
vi.mock('../../src/services/bundle-import-service', () => ({
  validateBundleManifest: vi.fn(),
  verifyBundleSignature: vi.fn().mockResolvedValue(true),
  buildImportKey: vi.fn().mockReturnValue('import:site-1:2026-05-27T00:00:00Z'),
  getImportProgress: vi.fn().mockResolvedValue(null),
  saveImportProgress: vi.fn().mockResolvedValue(undefined),
  hasCompletedPhase: vi.fn().mockReturnValue(false),
  resolveCreatedByRefToId: vi.fn().mockResolvedValue('00000000-0000-0000-0000-000000000000'),
}));
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthorizationError'; }
  },
}));
vi.mock('../../src/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }));

import { getSite, updateSite } from '../../src/services/site-service';
import { getMainBranch, listBranches } from '../../src/services/branch-service';
import { listDocuments } from '../../src/services/document-service';
import {
  validateBundleManifest,
  verifyBundleSignature,
  buildImportKey as mockBuildImportKey,
  getImportProgress as mockGetImportProgress,
  saveImportProgress as mockSaveImportProgress,
  hasCompletedPhase as mockHasCompletedPhase,
} from '../../src/services/bundle-import-service';

const mockVerifyBundleSignature = vi.mocked(verifyBundleSignature);
import { assertPermission, AuthorizationError } from '../../src/auth/authorization';
import { createCheckpoint } from '../../src/services/checkpoint-service';
import { query } from '../../src/db';
import { handleSiteImportRoute } from '../../src/routes/site-import-api';

const mockCreateCheckpoint = vi.mocked(createCheckpoint);
const mockQuery = vi.mocked(query);

const mockGetSite = vi.mocked(getSite);
const mockGetMainBranch = vi.mocked(getMainBranch);
const mockListBranches = vi.mocked(listBranches);
const mockListDocuments = vi.mocked(listDocuments);
const mockValidateManifest = vi.mocked(validateBundleManifest);
const mockAssertPermission = vi.mocked(assertPermission);

function createPrincipal(): AuthenticatedPrincipal {
  return {
    id: 'user-1',
    type: 'user',
    email: 'admin@example.com',
    systemRole: 'admin',
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  };
}

function createMockKV(): KVNamespace {
  return { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) } as unknown as KVNamespace;
}

function buildMinimalZip(): Uint8Array {
  const siteContent = strToU8(JSON.stringify({
    id: 'src-site-1',
    name: 'Test',
    pantheonSiteId: 'p1',
    workflowSettings: {},
    createdAt: '',
    updatedAt: '',
  }));
  const branchesContent = strToU8(JSON.stringify([{
    id: 'src-main',
    name: 'main',
    isMain: true,
    status: 'active',
    createdAt: '',
    updatedAt: '',
    archivedAt: null,
  }]));
  const bundleContent = strToU8(JSON.stringify({
    bundleVersion: '1',
    exportedAt: '2026-05-27T00:00:00Z',
    sourceEnvironment: 'sbx1',
    sourceSiteId: 'src-site-1',
    files: { 'site.json': 'sha256:placeholder', 'branches.json': 'sha256:placeholder' },
  }));
  return zipSync({
    'bundle.json': bundleContent,
    'site.json': siteContent,
    'branches.json': branchesContent,
  });
}

function makeFormRequest(zip: Uint8Array): Request {
  const form = new FormData();
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'bundle.zip');
  return new Request('https://example.com/api/admin/sites/site-1/import', {
    method: 'POST',
    body: form,
  });
}

const MOCK_SITE = {
  id: 'site-1',
  name: 'Target',
  pantheonSiteId: 'p1',
  workflowSettings: {},
  allowedOrigins: [],
  createdAt: '',
  updatedAt: '',
  archivedAt: null,
};
const MOCK_MAIN = {
  id: 'main-1',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  status: 'active',
  createdAt: '',
  updatedAt: '',
  archivedAt: null,
};

describe('handleSiteImportRoute', () => {
  function createEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { CONFIG_KV: createMockKV(), INTERNAL_SECRET: 'test-secret', ...overrides };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    // Restore defaults wiped by resetAllMocks
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockCreateCheckpoint.mockResolvedValue({ checkpoint: { id: 'mock-checkpoint-id' } } as never);
    mockVerifyBundleSignature.mockResolvedValue(true);
  });

  it('returns 400 when siteId is missing', async () => {
    const resp = await handleSiteImportRoute(
      new Request('https://example.com/', { method: 'POST' }),
      { siteId: undefined, principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(400);
  });

  it('returns 405 for GET requests', async () => {
    const resp = await handleSiteImportRoute(
      new Request('https://example.com/', { method: 'GET' }),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(405);
  });

  it('returns 404 when target site does not exist', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(null);
    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(404);
  });

  it('returns 409 when target site already has documents', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    // Empty-site check now runs AFTER manifest validation — provide valid manifest first
    mockValidateManifest.mockResolvedValueOnce({ valid: true, errors: [] });
    vi.mocked(mockGetImportProgress).mockResolvedValue(null);
    vi.mocked(mockBuildImportKey).mockReturnValue('import:site-1:2026-05-27T00:00:00Z');
    mockListDocuments.mockResolvedValueOnce([
      { id: 'doc-1', siteId: 'site-1', path: 'home', createdAt: '' },
    ] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv() as never,
    );
    expect(resp.status).toBe(409);
  });

  it('returns 409 when target site has non-main branches', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockValidateManifest.mockResolvedValueOnce({ valid: true, errors: [] });
    vi.mocked(mockGetImportProgress).mockResolvedValue(null);
    vi.mocked(mockBuildImportKey).mockReturnValue('import:site-1:2026-05-27T00:00:00Z');
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([
      MOCK_MAIN,
      { id: 'feat-1', siteId: 'site-1', name: 'feature-branch', isMain: false, status: 'active', createdAt: '', updatedAt: '', archivedAt: null },
    ] as never);

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv() as never,
    );
    expect(resp.status).toBe(409);
  });

  it('returns 422 when bundle manifest validation fails', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);
    mockValidateManifest.mockResolvedValueOnce({ valid: false, errors: ['SHA-256 mismatch for site.json'] });

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(422);
    const body = JSON.parse(await resp.text()) as { error: string; details: unknown[] };
    expect(body.error).toContain('manifest');
    expect(body.details).toHaveLength(1);
  });

  it('returns 403 when principal lacks canManageGrants permission', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockRejectedValueOnce(new AuthorizationError('Forbidden'));
    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv() as never,
    );
    expect(resp.status).toBe(403);
  });

  it('skips assertPermission for service principals', async () => {
    const servicePrincipal: AuthenticatedPrincipal = {
      id: 'token-uuid', type: 'service', siteId: 'site-1', scopes: ['write:create'],
      pantheonSiteRoles: {}, tokenExpiry: new Date(Date.now() + 86400000).toISOString(), authProvider: 'site_token',
    };
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);
    mockValidateManifest.mockResolvedValueOnce({ valid: true, errors: [] });
    vi.mocked(mockGetImportProgress).mockResolvedValue(null);
    vi.mocked(mockSaveImportProgress).mockResolvedValue(undefined);
    vi.mocked(mockBuildImportKey).mockReturnValue('import:site-1:2026-05-27T00:00:00Z');
    vi.mocked(updateSite).mockResolvedValueOnce(MOCK_SITE as never);
    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: servicePrincipal },
      createEnv() as never,
    );
    expect(resp.status).toBe(200);
    expect(mockAssertPermission).not.toHaveBeenCalled();
  });

  it('returns 422 when bundleSignature is provided but invalid', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockVerifyBundleSignature.mockResolvedValueOnce(false);

    const formData = new FormData();
    formData.append('file', new Blob([buildMinimalZip()], { type: 'application/zip' }), 'bundle.zip');
    formData.append('bundleSignature', 'invalid-signature');
    const resp = await handleSiteImportRoute(
      new Request('https://example.com/', { method: 'POST', body: formData }),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv() as never,
    );
    expect(resp.status).toBe(422);
    const body = JSON.parse(await resp.text()) as { error: string };
    expect(body.error).toContain('signature');
  });

  it('resumes import with non-main branches without 409 (deadlock fix)', async () => {
    // Simulate a partial import: KV shows branches phase complete.
    vi.mocked(mockGetImportProgress).mockResolvedValue({
      completedPhases: ['site', 'branches'],
      errors: [], startedAt: '', lastUpdatedAt: '',
    });
    vi.mocked(mockHasCompletedPhase).mockImplementation(
      (p, phase) => ['site', 'branches'].includes(phase),
    );
    vi.mocked(mockBuildImportKey).mockReturnValue('import:site-1:2026-05-27T00:00:00Z');
    vi.mocked(mockSaveImportProgress).mockResolvedValue(undefined);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    // Site already has a non-main branch from the first run — would have caused 409 before fix
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([
      MOCK_MAIN,
      { id: 'feat-branch', name: 'feature', isMain: false, status: 'active', createdAt: '' },
    ] as never);
    mockValidateManifest.mockResolvedValueOnce({ valid: true, errors: [] });
    vi.mocked(updateSite).mockResolvedValueOnce(MOCK_SITE as never);

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv() as never,
    );
    // Should succeed (resume), not 409
    expect(resp.status).toBe(200);
  });

  it('returns 200 with importKey for a minimal valid bundle', async () => {
    // Re-setup bundle-import-service mocks after vi.resetAllMocks() clears them
    vi.mocked(mockHasCompletedPhase).mockReturnValue(false);
    vi.mocked(mockGetImportProgress).mockResolvedValue(null);
    vi.mocked(mockSaveImportProgress).mockResolvedValue(undefined);
    vi.mocked(mockBuildImportKey).mockReturnValue('import:site-1:2026-05-27T00:00:00Z');
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);
    mockValidateManifest.mockResolvedValueOnce({ valid: true, errors: [] });
    vi.mocked(updateSite).mockResolvedValueOnce(MOCK_SITE as never);

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(200);
    const body = JSON.parse(await resp.text()) as { importKey: string };
    expect(body.importKey).toBeDefined();
  });

  // =========================================================================
  // Test 19: Import always re-validates SHA-256 even when KV shows partial progress
  // =========================================================================
  it('re-validates SHA-256 manifest even when KV shows completedPhases site + branches (Test 19)', async () => {
    // KV progress shows site + branches already done
    vi.mocked(mockGetImportProgress).mockResolvedValue({
      completedPhases: ['site', 'branches'],
      errors: [],
      startedAt: '2026-05-27T00:00:00Z',
      lastUpdatedAt: '2026-05-27T00:00:00Z',
    });
    vi.mocked(mockBuildImportKey).mockReturnValue('import:site-1:2026-05-27T00:00:00Z');
    vi.mocked(mockSaveImportProgress).mockResolvedValue(undefined);
    // hasCompletedPhase: site=true, branches=true, but validation always runs first
    vi.mocked(mockHasCompletedPhase).mockImplementation(
      (_progress, phase) => phase === 'site' || phase === 'branches',
    );

    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);

    // validateBundleManifest returns invalid — should produce 422 regardless of KV progress
    mockValidateManifest.mockResolvedValueOnce({ valid: false, errors: ['mismatch'] });

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );

    // Validation must have run (confirmed by 422)
    expect(resp.status).toBe(422);
    // validateBundleManifest was called exactly once
    expect(mockValidateManifest).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // Test 22: Import rejects a corrupt ZIP (non-ZIP bytes) with 400
  // =========================================================================
  it('rejects a corrupt ZIP file with 400 (Test 22)', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);

    // Build a request with garbage bytes instead of a valid ZIP
    const garbageBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const form = new FormData();
    form.append('file', new Blob([garbageBytes], { type: 'application/zip' }), 'bundle.zip');
    const req = new Request('https://example.com/api/admin/sites/site-1/import', {
      method: 'POST',
      body: form,
    });

    const resp = await handleSiteImportRoute(
      req,
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(400);
    const body = JSON.parse(await resp.text()) as { error: string };
    expect(body.error.toLowerCase()).toContain('decompress');
  });

  // =========================================================================
  // Test 23: Import rejects a ZIP missing bundle.json with 422
  // =========================================================================
  it('rejects a valid ZIP that is missing bundle.json with 422 (Test 23)', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);

    // Build a valid ZIP but without bundle.json
    const { zipSync: zipSyncFn, strToU8: strToU8Fn } = await import('fflate');
    const zipWithoutBundle = zipSyncFn({
      'site.json': strToU8Fn(JSON.stringify({ id: 'src-1' })),
    });

    const form = new FormData();
    form.append('file', new Blob([zipWithoutBundle], { type: 'application/zip' }), 'bundle.zip');
    const req = new Request('https://example.com/api/admin/sites/site-1/import', {
      method: 'POST',
      body: form,
    });

    const resp = await handleSiteImportRoute(
      req,
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(422);
    const body = JSON.parse(await resp.text()) as { error: string };
    expect(body.error.toLowerCase()).toContain('bundle.json');
  });
});
