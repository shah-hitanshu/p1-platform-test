/**
 * Site Export/Import Integration Tests (PCC-3249)
 *
 * Run with: cd workers && pnpm test:integration -- tests/integration/site-export-import.integration.spec.ts
 * Prerequisites: Docker Postgres running, migration 038 applied.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import postgres from 'postgres';
import { zipSync, strToU8 } from 'fflate';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';
import { createSite } from '../../src/services/site-service';
import { getMainBranch, listBranches } from '../../src/services/branch-service';
import { createDocument } from '../../src/services/document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { selectVersionsForDocument } from '../../src/services/bundle-export-service';
import {
  validateBundleManifest,
  resolveCreatedByRefToId,
  buildImportKey,
} from '../../src/services/bundle-import-service';

// Mock auth and R2 presign — not under test in integration scenarios
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthorizationError'; }
  },
}));
vi.mock('../../src/storage/r2-presign', () => ({
  signR2GetUrl: vi.fn().mockResolvedValue({
    url: 'https://r2.example.com/signed',
    expiresAt: '2027-01-01T00:00:00Z',
  }),
}));

import { handleSiteImportRoute } from '../../src/routes/site-import-api';
import type { AuthenticatedPrincipal } from '../../src/types';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';
const createdSiteIds: string[] = [];

/**
 * Creates a real DB connection using the same pattern as all other integration tests in this repo.
 * See agent-auth-flow.integration.spec.ts and soft-delete.integration.spec.ts for reference.
 */
function createRealDatabaseConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const sql = postgres(connectionString, {
    transform: { undefined: null },
    max: 1,
  });

  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await sql.unsafe<T[]>(
        sqlQuery,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );
      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;
      return { rows, rowCount };
    },
  };

  return { connection, sql };
}

let sql: postgres.Sql;

beforeAll(() => {
  const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
  sql = pgSql;
  setDatabaseInstance(connection);
});

afterAll(async () => {
  for (const siteId of createdSiteIds) {
    // Delete in dependency order to avoid FK constraint violations.
    // checkpoint_documents and checkpoints must be removed before branches.
    await sql.unsafe(
      'DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (' +
      '  SELECT cp.id FROM app.checkpoints cp' +
      '  JOIN app.branches b ON b.id = cp.branch_id' +
      '  WHERE b.site_id = $1' +
      ')',
      [siteId as never],
    );
    await sql.unsafe(
      'UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id = $1',
      [siteId as never],
    );
    await sql.unsafe(
      'DELETE FROM app.checkpoints WHERE branch_id IN (' +
      '  SELECT id FROM app.branches WHERE site_id = $1' +
      ')',
      [siteId as never],
    );
    await sql.unsafe(
      'DELETE FROM app.document_versions WHERE document_id IN (' +
      '  SELECT id FROM app.documents WHERE site_id = $1' +
      ')',
      [siteId as never],
    );
    await sql.unsafe('DELETE FROM app.documents WHERE site_id = $1', [siteId as never]);
    // Clean up import_id_maps rows for branches (Test 2 inserts branch-phase rows that
    // individual test cleanup does not cover, since those tests only clean by importKey
    // derived from exportedAt — branch rows may use a different importKey).
    await sql.unsafe(
      'DELETE FROM app.import_id_maps WHERE target_id IN (' +
      '  SELECT id FROM app.branches WHERE site_id = $1' +
      ')',
      [siteId as never],
    );
    await sql.unsafe('DELETE FROM app.branches WHERE site_id = $1', [siteId as never]);
    await sql.unsafe('DELETE FROM app.sites WHERE id = $1', [siteId as never]);
  }
  setDatabaseInstance(null);
  await sql.end();
});

// ---------------------------------------------------------------------------
// Helper: create a minimal site with creatorId=SYSTEM_UUID
// ---------------------------------------------------------------------------
async function createTestSite(nameSuffix: string): Promise<{ id: string }> {
  const site = await createSite({
    name: `Export Test ${nameSuffix} ${String(Date.now())}`,
    pantheonSiteId: `export-${nameSuffix}-${String(Date.now())}`,
    creatorId: SYSTEM_UUID,
    createdByType: 'system',
  });
  createdSiteIds.push(site.id);
  return site;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal KV mock
// ---------------------------------------------------------------------------
function createMockKV(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// Helper: create a principal that passes mocked assertPermission
// ---------------------------------------------------------------------------
function createAdminPrincipal(): AuthenticatedPrincipal {
  return {
    id: 'user-admin',
    type: 'user',
    email: 'admin@example.com',
    systemRole: 'admin',
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helper: compute SHA-256 hex with crypto.subtle
// ---------------------------------------------------------------------------
async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TEST_INTERNAL_SECRET = 'test-internal-secret-for-import';

async function hmacSha256(data: Uint8Array, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Helper: build a valid ZIP bundle for import with real SHA-256 hashes
// ---------------------------------------------------------------------------
async function buildValidImportZip(opts: {
  sourceSiteId: string;
  sourceSiteName: string;
  branches?: { id: string; name: string; isMain: boolean }[];
  documents?: {
    path: string;
    id: string;
    versions: {
      branchName: string;
      versionNumber: number;
      isPublished: boolean;
      snapshot: Record<string, unknown>;
      createdAt: string;
    }[];
  }[];
}): Promise<{ zip: Uint8Array; bundleSignature: string }> {
  const {
    sourceSiteId,
    sourceSiteName,
    branches = [{ id: 'src-main', name: 'main', isMain: true }],
    documents = [],
  } = opts;

  const files: Record<string, Uint8Array> = {};

  files['site.json'] = strToU8(JSON.stringify({
    id: sourceSiteId,
    name: sourceSiteName,
    pantheonSiteId: 'p1',
    workflowSettings: { requireReviewForPublish: false, allowDirectPublish: true },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }));

  files['branches.json'] = strToU8(JSON.stringify(
    branches.map((b) => ({
      ...b,
      status: 'active',
      sourceBranchId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      archivedAt: null,
    })),
  ));

  for (const doc of documents) {
    files[`documents/${doc.path}/meta.json`] = strToU8(JSON.stringify({
      id: doc.id,
      path: doc.path,
      createdAt: '2026-01-01T00:00:00Z',
    }));
    files[`documents/${doc.path}/versions.jsonl`] = strToU8(
      doc.versions.map((v) => JSON.stringify({
        branchName: v.branchName,
        versionNumber: v.versionNumber,
        isPublished: v.isPublished,
        snapshot: v.snapshot,
        createdAt: v.createdAt,
        createdByRef: { type: 'system' },
      })).join('\n'),
    );
    files[`documents/${doc.path}/publish_checkpoints.jsonl`] = strToU8('');
  }

  // Compute real SHA-256 hashes
  const manifest: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(files)) {
    manifest[filePath] = await sha256Hex(content);
  }

  const exportedAt = '2026-05-27T00:00:00.000Z';
  const bundleJsonBytes = strToU8(JSON.stringify({
    bundleVersion: '1',
    exportedAt,
    sourceEnvironment: 'sbx1',
    sourceSiteId,
    files: manifest,
  }));
  files['bundle.json'] = bundleJsonBytes;

  const bundleSignature = await hmacSha256(bundleJsonBytes, TEST_INTERNAL_SECRET);
  return { zip: zipSync(files), bundleSignature };
}

// ===========================================================================
// selectVersionsForDocument integration
// ===========================================================================

describe('selectVersionsForDocument integration', () => {
  it('returns the latest version for a document with one version on main branch (Test 6)', async () => {
    // createSite also creates the main branch internally.
    // Do NOT pass creatorId here — creatorId triggers a role grant that requires the UUID
    // to exist in app.users or app.agents, and the system UUID (all-zeros) may not be seeded.
    // Omitting creatorId is safe: the site is created without a creator grant, which is
    // valid for test purposes.
    const site = await createTestSite('t6');

    const branch = await getMainBranch(site.id);
    if (branch === null) throw new Error('Main branch not found');

    const doc = await createDocument({ siteId: site.id, path: 'home' });

    await createDocumentVersion({
      documentId: doc.id,
      branchId: branch.id,
      snapshot: { root: { type: 'Root', props: {} } },
      source: 'edit',
      createdById: SYSTEM_UUID,
      createdByType: 'system',
      skipDuplicateCheck: true,
    });

    const selected = await selectVersionsForDocument(doc.id, branch.id, true);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.snapshot).toEqual({ root: { type: 'Root', props: {} } });
  });

  // Test 7: non-main branch returns only the latest version
  it('returns only the latest version for a non-main branch (Test 7)', async () => {
    const site = await createTestSite('t7');
    const mainBranch = await getMainBranch(site.id);
    if (mainBranch === null) throw new Error('Main branch not found');

    // Create a non-main branch directly in SQL (createBranch needs createdByType user|agent)
    const branchResult = await sql.unsafe<{ id: string }[]>(
      `INSERT INTO app.branches (site_id, name, source_branch_id, is_main, status, created_by_id, created_by_type)
       VALUES ($1, 'feature', $2, false, 'active', $3, 'user')
       RETURNING id`,
      [site.id as never, mainBranch.id as never, SYSTEM_UUID as never],
    );
    const nonMainBranch = branchResult[0];
    if (nonMainBranch === undefined) throw new Error('Failed to create feature branch');

    const doc = await createDocument({ siteId: site.id, path: 'home' });

    // Create 2 versions on the non-main branch — first one is "published" via SQL
    const v1 = await createDocumentVersion({
      documentId: doc.id,
      branchId: nonMainBranch.id,
      snapshot: { root: { type: 'Root', props: { title: 'v1' } } },
      source: 'edit',
      createdById: SYSTEM_UUID,
      createdByType: 'system',
      skipDuplicateCheck: true,
    });

    // Create a publish checkpoint for v1
    const cpResult = await sql.unsafe<{ id: string }[]>(
      `INSERT INTO app.checkpoints (branch_id, name, checkpoint_type, created_by_id, created_by_type, status)
       VALUES ($1, 'test', 'publish', $2, 'user', 'completed')
       RETURNING id`,
      [nonMainBranch.id as never, SYSTEM_UUID as never],
    );
    const cpId = cpResult[0]?.id;
    if (cpId !== undefined) {
      await sql.unsafe(
        `INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
         VALUES ($1, $2, $3)`,
        [cpId as never, doc.id as never, v1.id as never],
      );
    }

    // Create a second (latest) version
    await createDocumentVersion({
      documentId: doc.id,
      branchId: nonMainBranch.id,
      snapshot: { root: { type: 'Root', props: { title: 'v2-latest' } } },
      source: 'edit',
      createdById: SYSTEM_UUID,
      createdByType: 'system',
      skipDuplicateCheck: true,
    });

    // Non-main branch: should return only the latest version
    const selected = await selectVersionsForDocument(doc.id, nonMainBranch.id, false);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.snapshot).toEqual({ root: { type: 'Root', props: { title: 'v2-latest' } } });
  });

  // Test 8: tombstone versions are excluded
  it('excludes tombstone versions (Test 8)', async () => {
    const site = await createTestSite('t8');
    const branch = await getMainBranch(site.id);
    if (branch === null) throw new Error('Main branch not found');

    const doc = await createDocument({ siteId: site.id, path: 'home' });

    // Create 2 versions
    await createDocumentVersion({
      documentId: doc.id,
      branchId: branch.id,
      snapshot: { root: { type: 'Root', props: { title: 'v1' } } },
      source: 'edit',
      createdById: SYSTEM_UUID,
      createdByType: 'system',
      skipDuplicateCheck: true,
    });
    const v2 = await createDocumentVersion({
      documentId: doc.id,
      branchId: branch.id,
      snapshot: { root: { type: 'Root', props: { title: 'v2-tombstone' } } },
      source: 'edit',
      createdById: SYSTEM_UUID,
      createdByType: 'system',
      skipDuplicateCheck: true,
    });

    // Tombstone v2
    await sql.unsafe(
      'UPDATE app.document_versions SET is_tombstone = true WHERE id = $1',
      [v2.id as never],
    );

    const selected = await selectVersionsForDocument(doc.id, branch.id, true);
    // Should return only v1 (the non-tombstoned version)
    expect(selected).toHaveLength(1);
    expect(selected[0]?.snapshot).toEqual({ root: { type: 'Root', props: { title: 'v1' } } });
  });

  // Test 4: Version selection with 3 versions — published + latest draft only
  it('returns only published version(s) + unpublished latest draft, not intermediate (Test 4)', async () => {
    const site = await createTestSite('t4');
    const branch = await getMainBranch(site.id);
    if (branch === null) throw new Error('Main branch not found');

    const doc = await createDocument({ siteId: site.id, path: 'home' });

    // v1: unpublished draft
    await createDocumentVersion({
      documentId: doc.id,
      branchId: branch.id,
      snapshot: { root: { type: 'Root', props: { v: '1-draft' } } },
      source: 'edit',
      createdById: SYSTEM_UUID,
      createdByType: 'system',
      skipDuplicateCheck: true,
    });

    // v2: published
    const v2 = await createDocumentVersion({
      documentId: doc.id,
      branchId: branch.id,
      snapshot: { root: { type: 'Root', props: { v: '2-published' } } },
      source: 'edit',
      createdById: SYSTEM_UUID,
      createdByType: 'system',
      skipDuplicateCheck: true,
    });
    // Create publish checkpoint for v2
    const cpResult = await sql.unsafe<{ id: string }[]>(
      `INSERT INTO app.checkpoints (branch_id, name, checkpoint_type, created_by_id, created_by_type, status)
       VALUES ($1, 'publish v2', 'publish', $2, 'user', 'completed')
       RETURNING id`,
      [branch.id as never, SYSTEM_UUID as never],
    );
    const cpId = cpResult[0]?.id;
    if (cpId !== undefined) {
      await sql.unsafe(
        `INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
         VALUES ($1, $2, $3)`,
        [cpId as never, doc.id as never, v2.id as never],
      );
    }

    // v3: unpublished draft (latest)
    await createDocumentVersion({
      documentId: doc.id,
      branchId: branch.id,
      snapshot: { root: { type: 'Root', props: { v: '3-draft' } } },
      source: 'edit',
      createdById: SYSTEM_UUID,
      createdByType: 'system',
      skipDuplicateCheck: true,
    });

    const selected = await selectVersionsForDocument(doc.id, branch.id, true);

    // Must return exactly 2 entries: v2 (isPublished=true) and v3 (isPublished=false)
    // v1 (intermediate unpublished) must NOT be included
    expect(selected).toHaveLength(2);
    expect(selected[0]?.isPublished).toBe(true);
    expect(selected[0]?.snapshot).toEqual({ root: { type: 'Root', props: { v: '2-published' } } });
    expect(selected[1]?.isPublished).toBe(false);
    expect(selected[1]?.snapshot).toEqual({ root: { type: 'Root', props: { v: '3-draft' } } });
  });
});

// ===========================================================================
// resolveCreatedByRefToId integration
// ===========================================================================

describe('resolveCreatedByRefToId integration', () => {
  it('returns system UUID for type=system', async () => {
    const id = await resolveCreatedByRefToId({ type: 'system' });
    expect(id).toBe(SYSTEM_UUID);
  });

  it('returns system UUID for unknown user email (Test 11)', async () => {
    const id = await resolveCreatedByRefToId({ type: 'user', email: 'nobody@noreply.invalid' });
    expect(id).toBe(SYSTEM_UUID);
  });
});

// ===========================================================================
// import_id_maps table integration
// ===========================================================================

describe('import_id_maps table integration', () => {
  it('accepts writes and reads correctly (Test 10)', async () => {
    const importKey = buildImportKey('test-site-imap', '2026-05-27T00:00:00Z');
    await sql.unsafe(
      'INSERT INTO app.import_id_maps (import_key, source_id, target_id, entity_type) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [importKey, 'src-99', 'tgt-99', 'document'],
    );
    const result = await sql.unsafe<{ target_id: string }[]>(
      'SELECT target_id FROM app.import_id_maps WHERE import_key = $1 AND source_id = $2',
      [importKey, 'src-99'],
    );
    expect(result[0]?.target_id).toBe('tgt-99');
    await sql.unsafe('DELETE FROM app.import_id_maps WHERE import_key = $1', [importKey]);
  });
});

// ===========================================================================
// validateBundleManifest integration
// ===========================================================================

describe('validateBundleManifest integration', () => {
  it('passes for valid content computed with crypto.subtle (Test 9)', async () => {
    const content = new TextEncoder().encode('{"hello":"world"}');
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashHex = 'sha256:' + Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const result = await validateBundleManifest(
      {
        bundleVersion: '1',
        exportedAt: '2026-05-27T00:00:00Z',
        sourceEnvironment: 'sbx1',
        sourceSiteId: 'site-1',
        files: { 'site.json': hashHex },
      },
      { 'site.json': content },
    );
    expect(result.valid).toBe(true);
  });
});

// ===========================================================================
// Import handler scenario tests (real DB + mocked auth)
// ===========================================================================

describe('handleSiteImportRoute integration scenarios', () => {
  // Test 2: Import of a bundle with two non-main branches creates both branches on target
  it('creates non-main branches from branches.json on the target site (Test 2)', async () => {
    const targetSite = await createTestSite('t2-target');
    const targetMain = await getMainBranch(targetSite.id);
    if (targetMain === null) throw new Error('Main branch not found');

    const { zip, bundleSignature } = await buildValidImportZip({
      sourceSiteId: 'src-site-t2',
      sourceSiteName: 'Source T2',
      branches: [
        { id: 'src-main', name: 'main', isMain: true },
        { id: 'src-feat', name: 'feature-branch', isMain: false },
      ],
    });

    const form = new FormData();
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'bundle.zip');
    form.append('bundleSignature', bundleSignature);
    const req = new Request('https://example.com/api/admin/sites/' + targetSite.id + '/import', {
      method: 'POST',
      body: form,
    });

    const resp = await handleSiteImportRoute(
      req,
      { siteId: targetSite.id, principal: createAdminPrincipal() },
      { CONFIG_KV: createMockKV(), INTERNAL_SECRET: TEST_INTERNAL_SECRET } as never,
    );
    expect(resp.status).toBe(200);

    // Read back DB state
    const branches = await listBranches(targetSite.id);
    const branchNames = branches.map((b) => b.name).sort();
    expect(branchNames).toContain('main');
    expect(branchNames).toContain('feature-branch');
  });

  // Test 12: Import handler creates import_id_maps entries for created document
  it('creates import_id_maps entries for created document (Test 12)', async () => {
    const targetSite = await createTestSite('t12-target');
    const targetMain = await getMainBranch(targetSite.id);
    if (targetMain === null) throw new Error('Main branch not found');

    const sourceDocId = 'src-doc-t12-abc';
    const { zip, bundleSignature } = await buildValidImportZip({
      sourceSiteId: 'src-site-t12',
      sourceSiteName: 'Source T12',
      documents: [{
        path: 'home',
        id: sourceDocId,
        versions: [{
          branchName: 'main',
          versionNumber: 1,
          isPublished: false,
          snapshot: { root: { type: 'Root', props: {} } },
          createdAt: '2026-01-01T00:00:00Z',
        }],
      }],
    });

    const importKey = buildImportKey(targetSite.id, '2026-05-27T00:00:00.000Z');

    const form = new FormData();
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'bundle.zip');
    form.append('bundleSignature', bundleSignature);
    const req = new Request('https://example.com/api/admin/sites/' + targetSite.id + '/import', {
      method: 'POST',
      body: form,
    });

    const resp = await handleSiteImportRoute(
      req,
      { siteId: targetSite.id, principal: createAdminPrincipal() },
      { CONFIG_KV: createMockKV(), INTERNAL_SECRET: TEST_INTERNAL_SECRET } as never,
    );
    expect(resp.status).toBe(200);

    // Query import_id_maps for the document mapping
    const result = await sql.unsafe<{ source_id: string; entity_type: string }[]>(
      'SELECT source_id, entity_type FROM app.import_id_maps WHERE import_key = $1 AND entity_type = $2',
      [importKey, 'document'],
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.source_id).toBe(sourceDocId);

    // Cleanup import_id_maps
    await sql.unsafe('DELETE FROM app.import_id_maps WHERE import_key = $1', [importKey]);
  });

  // Test 13: Import handler creates a publish checkpoint when a version has isPublished=true
  it('creates a publish checkpoint when a version line has isPublished=true (Test 13)', async () => {
    const targetSite = await createTestSite('t13-target');
    const targetMain = await getMainBranch(targetSite.id);
    if (targetMain === null) throw new Error('Main branch not found');

    const importKey = buildImportKey(targetSite.id, '2026-05-27T00:00:00.000Z');

    const { zip, bundleSignature } = await buildValidImportZip({
      sourceSiteId: 'src-site-t13',
      sourceSiteName: 'Source T13',
      documents: [{
        path: 'home',
        id: 'src-doc-t13',
        versions: [{
          branchName: 'main',
          versionNumber: 1,
          isPublished: true,  // <-- this should cause a publish checkpoint to be created
          snapshot: { root: { type: 'Root', props: { title: 'published' } } },
          createdAt: '2026-01-01T00:00:00Z',
        }],
      }],
    });

    const form = new FormData();
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'bundle.zip');
    form.append('bundleSignature', bundleSignature);
    const req = new Request('https://example.com/api/admin/sites/' + targetSite.id + '/import', {
      method: 'POST',
      body: form,
    });

    const resp = await handleSiteImportRoute(
      req,
      { siteId: targetSite.id, principal: createAdminPrincipal() },
      { CONFIG_KV: createMockKV(), INTERNAL_SECRET: TEST_INTERNAL_SECRET } as never,
    );
    expect(resp.status).toBe(200);

    // Verify a publish checkpoint exists for the target main branch
    const cpResult = await sql.unsafe<{ id: string; checkpoint_type: string }[]>(
      `SELECT cp.id, cp.checkpoint_type
       FROM app.checkpoints cp
       WHERE cp.branch_id = $1 AND cp.checkpoint_type = 'publish'`,
      [targetMain.id as never],
    );
    expect(cpResult.length).toBeGreaterThanOrEqual(1);

    // Verify checkpoint_documents links the checkpoint to a version
    const firstCp = cpResult[0];
    if (firstCp === undefined) throw new Error('Expected publish checkpoint to exist');
    const cpDocResult = await sql.unsafe<{ document_version_id: string }[]>(
      `SELECT cd.document_version_id
       FROM app.checkpoint_documents cd
       WHERE cd.checkpoint_id = $1`,
      [firstCp.id as never],
    );
    expect(cpDocResult.length).toBeGreaterThanOrEqual(1);

    // Cleanup import_id_maps
    await sql.unsafe('DELETE FROM app.import_id_maps WHERE import_key = $1', [importKey]);
  });

  // Test 1: Full export-then-import round-trip
  it('full round-trip: import creates document, version, and publish checkpoint (Test 1)', async () => {
    // Source: manually built bundle with one published version
    const targetSite = await createTestSite('t1-target');
    const targetMain = await getMainBranch(targetSite.id);
    if (targetMain === null) throw new Error('Main branch not found');

    const importKey = buildImportKey(targetSite.id, '2026-05-27T00:00:00.000Z');

    const { zip, bundleSignature } = await buildValidImportZip({
      sourceSiteId: 'src-site-t1',
      sourceSiteName: 'Source T1',
      documents: [{
        path: 'home',
        id: 'src-doc-t1',
        versions: [{
          branchName: 'main',
          versionNumber: 1,
          isPublished: true,
          snapshot: { root: { type: 'Root', props: { title: 'imported home' } } },
          createdAt: '2026-01-01T00:00:00Z',
        }],
      }],
    });

    const form = new FormData();
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'bundle.zip');
    form.append('bundleSignature', bundleSignature);
    const req = new Request('https://example.com/api/admin/sites/' + targetSite.id + '/import', {
      method: 'POST',
      body: form,
    });

    const resp = await handleSiteImportRoute(
      req,
      { siteId: targetSite.id, principal: createAdminPrincipal() },
      { CONFIG_KV: createMockKV(), INTERNAL_SECRET: TEST_INTERNAL_SECRET } as never,
    );
    expect(resp.status).toBe(200);

    const body = JSON.parse(await resp.text()) as { importKey: string; documentCount: number };
    expect(body.documentCount).toBe(1);

    // Verify document was created
    const docResult = await sql.unsafe<{ id: string; path: string }[]>(
      'SELECT id, path FROM app.documents WHERE site_id = $1',
      [targetSite.id as never],
    );
    expect(docResult).toHaveLength(1);
    expect(docResult[0]?.path).toBe('home');

    // Verify document version was created
    const firstDoc = docResult[0];
    if (firstDoc === undefined) throw new Error('Expected document to exist');
    const versionResult = await sql.unsafe<{ id: string; version_number: number }[]>(
      `SELECT dv.id, dv.version_number
       FROM app.document_versions dv
       WHERE dv.document_id = $1`,
      [firstDoc.id as never],
    );
    expect(versionResult).toHaveLength(1);
    expect(versionResult[0]?.version_number).toBe(1);

    // Verify publish checkpoint exists
    const cpResult = await sql.unsafe<{ id: string }[]>(
      'SELECT cp.id FROM app.checkpoints cp WHERE cp.branch_id = $1 AND cp.checkpoint_type = \'publish\'',
      [targetMain.id as never],
    );
    expect(cpResult.length).toBeGreaterThanOrEqual(1);

    // Cleanup import_id_maps
    await sql.unsafe('DELETE FROM app.import_id_maps WHERE import_key = $1', [importKey]);
  });

  // Test 3: Re-running import with partial KV progress resumes without duplicating data
  it('resumes from partial KV progress without duplicating branches (Test 3)', async () => {
    const targetSiteOriginalName = `Export Test t3-target ${String(Date.now())}`;
    const targetSite = await createTestSite('t3-target');
    // Read the actual name assigned by createTestSite (it appends a timestamp internally)
    const siteRow = await sql.unsafe<{ name: string }[]>(
      'SELECT name FROM app.sites WHERE id = $1',
      [targetSite.id as never],
    );
    const originalSiteName = siteRow[0]?.name ?? targetSiteOriginalName;

    const targetMain = await getMainBranch(targetSite.id);
    if (targetMain === null) throw new Error('Main branch not found');

    const exportedAt = '2026-05-27T00:00:00.000Z';
    const importKey = buildImportKey(targetSite.id, exportedAt);

    // Pre-populate KV with progress showing site + branches already complete
    const progressJson = JSON.stringify({
      completedPhases: ['site', 'branches'],
      errors: [],
      startedAt: exportedAt,
      lastUpdatedAt: exportedAt,
    });
    const kvStore = new Map<string, string>();
    kvStore.set(importKey, progressJson);
    const mockKV: KVNamespace = {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(kvStore.get(key) ?? null)),
      put: vi.fn().mockImplementation((key: string, value: string) => {
        kvStore.set(key, value);
        return Promise.resolve();
      }),
    } as unknown as KVNamespace;

    const { zip, bundleSignature } = await buildValidImportZip({
      sourceSiteId: 'src-site-t3',
      sourceSiteName: 'Source T3',
      branches: [{ id: 'src-main', name: 'main', isMain: true }],
      documents: [{
        path: 'home',
        id: 'src-doc-t3',
        versions: [{
          branchName: 'main',
          versionNumber: 1,
          isPublished: false,
          snapshot: { root: { type: 'Root', props: {} } },
          createdAt: '2026-01-01T00:00:00Z',
        }],
      }],
    });

    const form = new FormData();
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'bundle.zip');
    form.append('bundleSignature', bundleSignature);
    const req = new Request('https://example.com/api/admin/sites/' + targetSite.id + '/import', {
      method: 'POST',
      body: form,
    });

    const resp = await handleSiteImportRoute(
      req,
      { siteId: targetSite.id, principal: createAdminPrincipal() },
      { CONFIG_KV: mockKV, INTERNAL_SECRET: TEST_INTERNAL_SECRET } as never,
    );
    expect(resp.status).toBe(200);

    // Verify there is only one branch (main) on the target — no duplicates
    const branches = await listBranches(targetSite.id);
    const mainBranches = branches.filter((b) => b.isMain);
    expect(mainBranches).toHaveLength(1);

    // Verify the document was created (document phase ran)
    const docs = await sql.unsafe<{ id: string }[]>(
      'SELECT id FROM app.documents WHERE site_id = $1',
      [targetSite.id as never],
    );
    expect(docs).toHaveLength(1);

    // Verify updateSite was NOT called: site name must still be the original test name,
    // not the bundle source name 'Source T3'. If the site phase ran, it would rename
    // the site to match the bundle's site.json name.
    const siteAfter = await sql.unsafe<{ name: string }[]>(
      'SELECT name FROM app.sites WHERE id = $1',
      [targetSite.id as never],
    );
    expect(siteAfter[0]?.name).toBe(originalSiteName);
    expect(siteAfter[0]?.name).not.toBe('Source T3');

    // Cleanup import_id_maps
    await sql.unsafe('DELETE FROM app.import_id_maps WHERE import_key = $1', [importKey]);
  });
});
