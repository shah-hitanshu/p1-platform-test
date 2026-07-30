/**
 * Bundle Import Service Tests (PCC-3249)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ query: vi.fn() }));

import { query } from '../../src/db';
import {
  resolveCreatedByRefToId,
  validateBundleManifest,
  buildImportKey,
  hasCompletedPhase,
  verifyBundleSignature,
  type BundleManifest,
  type ImportProgress,
} from '../../src/services/bundle-import-service';
import { signBundleJson } from '../../src/services/bundle-export-service';

const mockQuery = vi.mocked(query);

describe('buildImportKey', () => {
  it('returns a deterministic key', () => {
    expect(buildImportKey('site-abc', '2026-05-27T10:00:00.000Z'))
      .toBe('import:site-abc:2026-05-27T10:00:00.000Z');
  });

  it('returns the same value on two calls', () => {
    const first = buildImportKey('site-abc', '2026-05-27T10:00:00.000Z');
    const second = buildImportKey('site-abc', '2026-05-27T10:00:00.000Z');
    expect(first).toBe(second);
  });
});

describe('hasCompletedPhase', () => {
  it('returns false for null progress (first run)', () => {
    expect(hasCompletedPhase(null, 'site')).toBe(false);
  });

  it('returns true for a phase already in the list', () => {
    const progress: ImportProgress = {
      completedPhases: ['site'],
      errors: [],
      startedAt: '2026-01-01T00:00:00Z',
      lastUpdatedAt: '2026-01-01T00:00:00Z',
    };
    expect(hasCompletedPhase(progress, 'site')).toBe(true);
  });

  it('returns false for a phase not yet in the list', () => {
    const progress: ImportProgress = {
      completedPhases: ['site'],
      errors: [],
      startedAt: '2026-01-01T00:00:00Z',
      lastUpdatedAt: '2026-01-01T00:00:00Z',
    };
    expect(hasCompletedPhase(progress, 'branches')).toBe(false);
  });
});

describe('validateBundleManifest', () => {
  it('passes when all SHA-256 hashes match', async () => {
    const content = new TextEncoder().encode('{"hello":"world"}');
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashHex = 'sha256:' + Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const manifest: BundleManifest = {
      bundleVersion: '1',
      exportedAt: '2026-05-27T00:00:00Z',
      sourceEnvironment: 'sbx1',
      sourceSiteId: 'site-1',
      files: { 'site.json': hashHex },
    };
    const result = await validateBundleManifest(manifest, { 'site.json': content });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when a file hash does not match', async () => {
    const manifest: BundleManifest = {
      bundleVersion: '1',
      exportedAt: '2026-05-27T00:00:00Z',
      sourceEnvironment: 'sbx1',
      sourceSiteId: 'site-1',
      files: { 'site.json': 'sha256:000000' },
    };
    const content = new TextEncoder().encode('{"different":"content"}');
    const result = await validateBundleManifest(manifest, { 'site.json': content });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('site.json');
  });

  it('fails when a manifest file is missing from content', async () => {
    const manifest: BundleManifest = {
      bundleVersion: '1',
      exportedAt: '2026-05-27T00:00:00Z',
      sourceEnvironment: 'sbx1',
      sourceSiteId: 'site-1',
      files: { 'site.json': 'sha256:abc', 'branches.json': 'sha256:def' },
    };
    const result = await validateBundleManifest(
      manifest,
      { 'site.json': new TextEncoder().encode('{}') },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('branches.json'))).toBe(true);
  });

  it('rejects bundleVersion !== "1"', async () => {
    const manifest: BundleManifest = {
      bundleVersion: '99',
      exportedAt: '',
      sourceEnvironment: '',
      sourceSiteId: '',
      files: {},
    };
    const result = await validateBundleManifest(manifest, {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('bundleVersion');
  });
});

describe('resolveCreatedByRefToId', () => {
  const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

  beforeEach(() => { vi.resetAllMocks(); });

  it('returns system UUID for {type:"system"}', async () => {
    const id = await resolveCreatedByRefToId({ type: 'system' });
    expect(id).toBe(SYSTEM_UUID);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('resolves user email to UUID from app.users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-target-uuid' }], rowCount: 1 });
    const id = await resolveCreatedByRefToId({ type: 'user', email: 'chris@example.com' });
    expect(id).toBe('user-target-uuid');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('app.users'),
      ['chris@example.com'],
    );
  });

  it('returns system UUID when user email is null', async () => {
    const id = await resolveCreatedByRefToId({ type: 'user', email: null });
    expect(id).toBe(SYSTEM_UUID);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns system UUID when user email not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const id = await resolveCreatedByRefToId({ type: 'user', email: 'unknown@example.com' });
    expect(id).toBe(SYSTEM_UUID);
  });

  it('resolves agent name to UUID from app.agents', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-target-uuid' }], rowCount: 1 });
    const id = await resolveCreatedByRefToId({ type: 'agent', name: 'Zappy AI' });
    expect(id).toBe('agent-target-uuid');
  });

  it('returns system UUID when agent name is null', async () => {
    const id = await resolveCreatedByRefToId({ type: 'agent', name: null });
    expect(id).toBe(SYSTEM_UUID);
  });

  it('returns system UUID when agent name not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const id = await resolveCreatedByRefToId({ type: 'agent', name: 'Unknown Agent' });
    expect(id).toBe(SYSTEM_UUID);
  });
});

describe('verifyBundleSignature', () => {
  // Exercises the REAL verifier (no mocks) against signatures produced by the real
  // signBundleJson. These run in the Node unit runtime, which is exactly where the prior
  // crypto.subtle.timingSafeEqual implementation threw — so they double as a regression
  // guard that verification stays portable across the Workers and Node runtimes.
  const SECRET = 'unit-test-internal-secret';
  const bundleJson = new TextEncoder().encode(JSON.stringify({ bundleVersion: '1', files: {} }));

  it('returns true for a signature produced by signBundleJson with the same secret', async () => {
    const sig = await signBundleJson(bundleJson, SECRET);
    expect(await verifyBundleSignature(bundleJson, sig, SECRET)).toBe(true);
  });

  it('returns false when the signature was produced with a different secret (wrong signature)', async () => {
    const sig = await signBundleJson(bundleJson, 'a-different-secret');
    expect(await verifyBundleSignature(bundleJson, sig, SECRET)).toBe(false);
  });

  it('returns false when the bundle bytes were tampered after signing (valid signature, tampered bundle)', async () => {
    const sig = await signBundleJson(bundleJson, SECRET);
    const tampered = new TextEncoder().encode(JSON.stringify({ bundleVersion: '1', files: { injected: 'evil' } }));
    expect(await verifyBundleSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('returns false for a malformed / wrong-length signature', async () => {
    expect(await verifyBundleSignature(bundleJson, 'not-a-real-signature', SECRET)).toBe(false);
  });

  it('resolves (does not throw) in the Node runtime — no Workers-only crypto dependency', async () => {
    // Regression: verifyBundleSignature used crypto.subtle.timingSafeEqual (a Workers-only
    // extension), which is undefined in Node and threw, making the real signature path
    // impossible to test outside the Workers runtime. It must now resolve in both.
    const sig = await signBundleJson(bundleJson, SECRET);
    await expect(verifyBundleSignature(bundleJson, sig, SECRET)).resolves.toBe(true);
  });
});
