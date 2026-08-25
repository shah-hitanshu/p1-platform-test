/**
 * Site Export API Handler Tests (PCC-3249)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unzipSync } from 'fflate';
import type { AuthenticatedPrincipal } from '../../src/types';
// validateBundleManifest is used un-mocked in Tests 16 (cross-component self-consistency)
// It only uses crypto.subtle — not the DB — so no conflict with the mocked db module below.
import { validateBundleManifest } from '../../src/services/bundle-import-service';

vi.mock('../../src/services/site-service', () => ({ getSite: vi.fn() }));
vi.mock('../../src/services/branch-service', () => ({
  listBranches: vi.fn(),
  getMainBranch: vi.fn(),
}));
vi.mock('../../src/services/document-service', () => ({ listDocuments: vi.fn() }));
vi.mock('../../src/services/agent-site-role-service', () => ({
  listRolesBySite: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/services/bundle-export-service', () => ({
  selectVersionsForDocument: vi.fn(),
  resolveCreatedByRefsBatch: vi.fn().mockResolvedValue(new Map()),
  getPublishCheckpointsForDocument: vi.fn().mockResolvedValue([]),
  signBundleJson: vi.fn().mockResolvedValue('mock-signature'),
}));
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthorizationError'; }
  },
}));
vi.mock('../../src/storage/r2-presign', () => ({ signR2GetUrl: vi.fn() }));
vi.mock('../../src/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }));

import { getSite } from '../../src/services/site-service';
import { listBranches, getMainBranch } from '../../src/services/branch-service';
import { listDocuments } from '../../src/services/document-service';
import {
  selectVersionsForDocument,
  resolveCreatedByRefsBatch,
  getPublishCheckpointsForDocument,
  signBundleJson,
} from '../../src/services/bundle-export-service';
import { assertPermission, AuthorizationError } from '../../src/auth/authorization';
import { signR2GetUrl } from '../../src/storage/r2-presign';
import { query } from '../../src/db';
import { listRolesBySite } from '../../src/services/agent-site-role-service';
import { handleSiteExportRoute } from '../../src/routes/site-export-api';

const mockGetSite = vi.mocked(getSite);
const mockListBranches = vi.mocked(listBranches);
const mockGetMainBranch = vi.mocked(getMainBranch);
const mockListDocuments = vi.mocked(listDocuments);
const mockSelectVersions = vi.mocked(selectVersionsForDocument);
const mockResolveRefsBatch = vi.mocked(resolveCreatedByRefsBatch);
const mockGetCheckpoints = vi.mocked(getPublishCheckpointsForDocument);
const mockSignBundleJson = vi.mocked(signBundleJson);
const mockAssertPermission = vi.mocked(assertPermission);
const mockSignR2 = vi.mocked(signR2GetUrl);
const mockQuery = vi.mocked(query);
const mockListAgentRoles = vi.mocked(listRolesBySite);

function createPrincipal(): AuthenticatedPrincipal {
  return {
    id: 'user-123',
    type: 'user',
    email: 'admin@example.com',
    systemRole: 'admin',
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  };
}

function createEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ENVIRONMENT: 'sbx1',
    INTERNAL_SECRET: 'test-internal-secret',
    R2_BUNDLES: { put: vi.fn().mockResolvedValue(undefined) },
    R2_BUNDLES_BUCKET: 'ccr-bundles-sbx1',
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    ...overrides,
  };
}

function makeRequest(method = 'GET'): Request {
  return new Request('https://example.com/api/admin/sites/site-1/export', { method });
}

const MOCK_SITE = {
  id: 'site-1',
  name: 'Test Site',
  pantheonSiteId: 'p1',
  workflowSettings: { requireReviewForPublish: false, allowDirectPublish: true },
  allowedOrigins: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
};
const MOCK_MAIN_BRANCH = {
  id: 'main-branch',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  status: 'active',
  createdById: 'u1',
  createdByType: 'user',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
};

describe('handleSiteExportRoute', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Restore defaults wiped by resetAllMocks
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockListAgentRoles.mockResolvedValue([]);
    mockResolveRefsBatch.mockResolvedValue(new Map());
    mockGetCheckpoints.mockResolvedValue([]);
    mockSignBundleJson.mockResolvedValue('mock-bundle-signature');
  });

  it('returns 400 when siteId is undefined', async () => {
    const resp = await handleSiteExportRoute(
      makeRequest(),
      { siteId: undefined, principal: createPrincipal() },
      createEnv(),
    );
    expect(resp.status).toBe(400);
  });

  it('returns 405 for non-GET requests', async () => {
    const resp = await handleSiteExportRoute(
      makeRequest('POST'),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv(),
    );
    expect(resp.status).toBe(405);
  });

  it('returns 404 when site does not exist', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(null);
    const resp = await handleSiteExportRoute(
      makeRequest(),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv(),
    );
    expect(resp.status).toBe(404);
  });

  it('returns 503 when R2_BUNDLES binding is missing', async () => {
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    const env = createEnv({ R2_BUNDLES: undefined });
    const resp = await handleSiteExportRoute(
      makeRequest(),
      { siteId: 'site-1', principal: createPrincipal() },
      env,
    );
    expect(resp.status).toBe(503);
  });

  it('returns 200 with downloadUrl for empty site', async () => {
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    const resp = await handleSiteExportRoute(
      makeRequest(),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv(),
    );
    expect(resp.status).toBe(200);
    const body = JSON.parse(await resp.text()) as { downloadUrl: string };
    expect(body.downloadUrl).toBe('https://r2.example.com/signed');
  });

  it('returns 403 when principal lacks canManageGrants permission', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockRejectedValueOnce(new AuthorizationError('Forbidden'));
    const resp = await handleSiteExportRoute(
      makeRequest(),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv(),
    );
    expect(resp.status).toBe(403);
  });

  it('skips assertPermission for service principals (scope already checked by isServicePrincipalAllowed)', async () => {
    const servicePrincipal: AuthenticatedPrincipal = {
      id: 'token-uuid',
      type: 'service',
      siteId: 'site-1',
      scopes: ['read:all'],
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
      authProvider: 'site_token',
    };
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([]);
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01' });
    await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: servicePrincipal }, createEnv());
    expect(mockAssertPermission).not.toHaveBeenCalled();
  });

  it('returns bundleSignature in response when INTERNAL_SECRET is configured', async () => {
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([]);
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01' });

    const resp = await handleSiteExportRoute(
      makeRequest(),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv(), // includes INTERNAL_SECRET: 'test-internal-secret'
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(typeof (body as Record<string, unknown>).bundleSignature).toBe('string');
  });

  it('excludes _registry/ documents from version selection', async () => {
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([
      { id: 'doc-reg', siteId: 'site-1', path: '_registry/schema', createdAt: '' },
      { id: 'doc-2', siteId: 'site-1', path: 'home', createdAt: '' },
    ] as never);
    mockSelectVersions.mockResolvedValueOnce([{
      id: 'v1',
      versionNumber: 1,
      isPublished: false,
      snapshot: { root: {} },
      createdAt: '2026-01-01T00:00:00Z',
      createdById: 'u1',
      createdByType: 'user',
    }]);
    mockResolveRefsBatch.mockResolvedValueOnce(new Map([['u1', { type: 'user', email: 'admin@example.com' }]]));
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    await handleSiteExportRoute(
      makeRequest(),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv(),
    );

    // _registry/ doc should NOT trigger selectVersionsForDocument; only 'home' should
    expect(mockSelectVersions).toHaveBeenCalledTimes(1);
    expect(mockSelectVersions).toHaveBeenCalledWith('doc-2', 'main-branch', true);
  });

  // =========================================================================
  // Test 5: Export route writes ZIP to R2 with correct key and contentType
  // =========================================================================
  it('writes ZIP to R2 with key matching siteId/timestamp.zip and contentType application/zip (Test 5)', async () => {
    const capturedPutArgs: { key: string; body: Uint8Array; options: unknown }[] = [];
    const mockR2Put = vi.fn().mockImplementation(
      (key: string, body: Uint8Array, options: unknown) => {
        capturedPutArgs.push({ key, body, options });
      },
    );

    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    const env = createEnv({ R2_BUNDLES: { put: mockR2Put } });
    const resp = await handleSiteExportRoute(
      makeRequest(),
      { siteId: 'site-1', principal: createPrincipal() },
      env,
    );

    expect(resp.status).toBe(200);
    const body = JSON.parse(await resp.text()) as {
      downloadUrl: string;
      expiresAt: string;
      exportedAt: string;
      bundleKey: string;
      documentCount: number;
      branchCount: number;
    };
    // All six response fields must be present and correct
    expect(body.downloadUrl).toBe('https://r2.example.com/signed');
    expect(body.expiresAt).toBe('2026-06-01T00:00:00Z');
    expect(typeof body.exportedAt).toBe('string');
    expect(body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
    expect(body.bundleKey).toMatch(/^site-1\/.+\.zip$/);
    expect(body.documentCount).toBe(0); // empty site
    expect(body.branchCount).toBe(1); // one branch (main)

    expect(capturedPutArgs).toHaveLength(1);
    const putCall = capturedPutArgs[0];
    if (putCall === undefined) throw new Error('Expected R2 put to have been called');
    // Key must match pattern site-1/{timestamp}.zip
    expect(putCall.key).toMatch(/^site-1\/.+\.zip$/);
    // bundleKey in response must match the R2 key
    expect(body.bundleKey).toBe(putCall.key);
    // Body must be a non-empty Uint8Array (the ZIP)
    expect(putCall.body).toBeInstanceOf(Uint8Array);
    expect(putCall.body.length).toBeGreaterThan(0);
    // contentType must be application/zip
    const options = putCall.options as { httpMetadata?: { contentType?: string } };
    expect(options.httpMetadata?.contentType).toBe('application/zip');
  });

  // =========================================================================
  // Test 14: versions.jsonl includes branchName and is sorted by createdAt asc
  // =========================================================================
  it('versions.jsonl lines include branchName field and are sorted by createdAt ascending (Test 14)', async () => {

    const FEATURE_BRANCH = {
      id: 'feat-branch',
      siteId: 'site-1',
      name: 'feature-branch',
      isMain: false,
      status: 'active',
      createdById: 'u1',
      createdByType: 'user',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      archivedAt: null,
    };

    const capturedPutArgs: { key: string; body: Uint8Array }[] = [];
    const mockR2Put = vi.fn().mockImplementation(
      (key: string, body: Uint8Array) => { capturedPutArgs.push({ key, body }); },
    );

    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH, FEATURE_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([
      { id: 'doc-1', siteId: 'site-1', path: 'home', createdAt: '2026-01-01T00:00:00Z' },
    ] as never);

    // main branch version — earlier createdAt
    mockSelectVersions.mockResolvedValueOnce([{
      id: 'v-main',
      versionNumber: 1,
      isPublished: false,
      snapshot: { root: { type: 'Root', props: {} } },
      createdAt: '2026-01-01T10:00:00Z',
      createdById: 'u1',
      createdByType: 'user',
    }]);
    mockResolveRefsBatch.mockResolvedValueOnce(new Map([['u1', { type: 'user', email: 'admin@example.com' }]]));

    // feature-branch version — later createdAt
    mockSelectVersions.mockResolvedValueOnce([{
      id: 'v-feat',
      versionNumber: 1,
      isPublished: false,
      snapshot: { root: { type: 'Root', props: { title: 'feature' } } },
      createdAt: '2026-02-01T10:00:00Z',
      createdById: 'u1',
      createdByType: 'user',
    }]);
    mockResolveRefsBatch.mockResolvedValueOnce(new Map([['u1', { type: 'user', email: 'admin@example.com' }]]));

    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    const env = createEnv({ R2_BUNDLES: { put: mockR2Put } });
    await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, env);

    expect(capturedPutArgs).toHaveLength(1);
    const firstPut = capturedPutArgs[0];
    if (firstPut === undefined) throw new Error('Expected R2 put to have been called');
    const zipBytes = firstPut.body;
    const unzipped = unzipSync(zipBytes);
    const versionsRaw = unzipped['documents/home/versions.jsonl'];
    expect(versionsRaw).toBeDefined();

    const lines = new TextDecoder().decode(versionsRaw).split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2);

    const rawLine0 = lines[0];
    const rawLine1 = lines[1];
    if (rawLine0 === undefined || rawLine1 === undefined) throw new Error('Expected 2 version lines');
    const line0 = JSON.parse(rawLine0) as { branchName: string; createdAt: string };
    const line1 = JSON.parse(rawLine1) as { branchName: string; createdAt: string };

    // First line must be the earlier createdAt (main branch)
    expect(line0.branchName).toBe('main');
    expect(line1.branchName).toBe('feature-branch');

    // Verify sorted by createdAt ascending
    expect(line0.createdAt < line1.createdAt).toBe(true);
  });

  // =========================================================================
  // Test 15: bundle.json is NOT included in manifest.files
  // =========================================================================
  it('bundle.json is not included in manifest.files (prevents circular self-hash) (Test 15)', async () => {
    const capturedPutArgs: { key: string; body: Uint8Array }[] = [];
    const mockR2Put = vi.fn().mockImplementation(
      (key: string, body: Uint8Array) => { capturedPutArgs.push({ key, body }); },
    );

    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    const env = createEnv({ R2_BUNDLES: { put: mockR2Put } });
    await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, env);

    expect(capturedPutArgs).toHaveLength(1);
    const putArg = capturedPutArgs[0];
    if (putArg === undefined) throw new Error('Expected R2 put to have been called');
    const unzipped = unzipSync(putArg.body);
    const bundleJson = JSON.parse(new TextDecoder().decode(unzipped['bundle.json'])) as { files: Record<string, string> };

    // bundle.json must NOT appear in manifest.files
    expect(Object.keys(bundleJson.files)).not.toContain('bundle.json');
    // But site.json and branches.json must be present
    expect(Object.keys(bundleJson.files)).toContain('site.json');
    expect(Object.keys(bundleJson.files)).toContain('branches.json');
  });

  // =========================================================================
  // Test 16: All files in manifest.files have matching SHA-256 in the ZIP
  // =========================================================================
  it('export always produces a self-consistent bundle (all manifest SHA-256 hashes match) (Test 16)', async () => {

    const capturedPutArgs: { key: string; body: Uint8Array }[] = [];
    const mockR2Put = vi.fn().mockImplementation(
      (key: string, body: Uint8Array) => { capturedPutArgs.push({ key, body }); },
    );

    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([
      { id: 'doc-1', siteId: 'site-1', path: 'home', createdAt: '2026-01-01T00:00:00Z' },
    ] as never);
    mockSelectVersions.mockResolvedValueOnce([{
      id: 'v1',
      versionNumber: 1,
      isPublished: false,
      snapshot: { root: { type: 'Root', props: {} } },
      createdAt: '2026-01-01T10:00:00Z',
      createdById: 'u1',
      createdByType: 'user',
    }]);
    mockResolveRefsBatch.mockResolvedValueOnce(new Map([['system', { type: 'system' }]]));
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    const env = createEnv({ R2_BUNDLES: { put: mockR2Put } });
    await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, env);

    expect(capturedPutArgs).toHaveLength(1);
    const putArg16 = capturedPutArgs[0];
    if (putArg16 === undefined) throw new Error('Expected R2 put to have been called');
    const unzipped = unzipSync(putArg16.body);
    const manifest = JSON.parse(new TextDecoder().decode(unzipped['bundle.json'])) as {
      bundleVersion: string;
      exportedAt: string;
      sourceEnvironment: string;
      sourceSiteId: string;
      files: Record<string, string>;
    };

    // validateBundleManifest is the real (un-mocked) implementation — it uses crypto.subtle
    const result = await validateBundleManifest(manifest, unzipped);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // =========================================================================
  // Test 20: Empty site produces ZIP with exactly bundle.json, site.json, branches.json, collaborators.json
  // =========================================================================
  it('empty site export produces ZIP with exactly bundle.json, site.json, branches.json, collaborators.json (Test 20)', async () => {
    const capturedPutArgs: { key: string; body: Uint8Array }[] = [];
    const mockR2Put = vi.fn().mockImplementation(
      (key: string, body: Uint8Array) => { capturedPutArgs.push({ key, body }); },
    );

    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    const env = createEnv({ R2_BUNDLES: { put: mockR2Put } });
    const resp = await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, env);

    expect(resp.status).toBe(200);
    const body = JSON.parse(await resp.text()) as { documentCount: number; downloadUrl: string };
    expect(body.documentCount).toBe(0);

    expect(capturedPutArgs).toHaveLength(1);
    const putArg20 = capturedPutArgs[0];
    if (putArg20 === undefined) throw new Error('Expected R2 put to have been called');
    const unzipped = unzipSync(putArg20.body);
    const keys = Object.keys(unzipped).sort();

    // ZIP must contain exactly these three files
    expect(keys).toEqual(['branches.json', 'bundle.json', 'collaborators.json', 'site.json']);
  });

  // =========================================================================
  // Test 37: ZIP assembly timing — must complete in under 500ms
  // =========================================================================
  it('ZIP assembly for a minimal bundle completes in under 500ms (Test 37)', async () => {

    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([
      { id: 'doc-1', siteId: 'site-1', path: 'home', createdAt: '2026-01-01T00:00:00Z' },
    ] as never);
    mockSelectVersions.mockResolvedValueOnce([{
      id: 'v1',
      versionNumber: 1,
      isPublished: false,
      snapshot: { root: { type: 'Root', props: {} } },
      createdAt: '2026-01-01T10:00:00Z',
      createdById: 'u1',
      createdByType: 'user',
    }]);
    mockResolveRefsBatch.mockResolvedValueOnce(new Map([['system', { type: 'system' }]]));
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    const start = Date.now();
    const resp = await handleSiteExportRoute(
      makeRequest(),
      { siteId: 'site-1', principal: createPrincipal() },
      createEnv(),
    );
    const elapsed = Date.now() - start;

    expect(resp.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });
});
