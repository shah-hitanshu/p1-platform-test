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
  type BundleManifest,
  type ImportProgress,
} from '../../src/services/bundle-import-service';

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
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-target-uuid' }], rowCount: 1 } as never);
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
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const id = await resolveCreatedByRefToId({ type: 'user', email: 'unknown@example.com' });
    expect(id).toBe(SYSTEM_UUID);
  });

  it('resolves agent name to UUID from app.agents', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-target-uuid' }], rowCount: 1 } as never);
    const id = await resolveCreatedByRefToId({ type: 'agent', name: 'Zappy AI' });
    expect(id).toBe('agent-target-uuid');
  });

  it('returns system UUID when agent name is null', async () => {
    const id = await resolveCreatedByRefToId({ type: 'agent', name: null });
    expect(id).toBe(SYSTEM_UUID);
  });

  it('returns system UUID when agent name not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const id = await resolveCreatedByRefToId({ type: 'agent', name: 'Unknown Agent' });
    expect(id).toBe(SYSTEM_UUID);
  });
});
