/**
 * Bundle Export Service Tests (PCC-3249)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Test 36: Regression guard — abandoned migration scripts must not exist
// These files were deleted as part of PCC-3249 cleanup (Task 0). This test
// prevents them from being accidentally re-added.
// ---------------------------------------------------------------------------
describe('abandoned scripts cleanup (Test 36)', () => {
  const workersRoot = join(__dirname, '../..');

  it('migrate-site.ts script file does not exist', () => {
    expect(existsSync(join(workersRoot, 'scripts/migrate-site.ts'))).toBe(false);
  });

  it('tsconfig.scripts.json file does not exist', () => {
    expect(existsSync(join(workersRoot, 'tsconfig.scripts.json'))).toBe(false);
  });
});

vi.mock('../../src/db', () => ({ query: vi.fn() }));
vi.mock('../../src/services/document-version-service', () => ({
  reconstructVersionSnapshot: vi.fn(),
}));

import { query } from '../../src/db';
import { reconstructVersionSnapshot } from '../../src/services/document-version-service';
import { VersionReconstructionError } from '../../src/services/errors';
import {
  resolveCreatedByRefsBatch,
  selectVersionsForDocument,
} from '../../src/services/bundle-export-service';

const mockQuery = vi.mocked(query);
const mockReconstruct = vi.mocked(reconstructVersionSnapshot);

// resolveCreatedByRefsBatch replaces the removed resolveCreatedByRef — same semantics,
// batched into at most 2 DB round trips. Tests verify per-type behavior via batch input.
describe('resolveCreatedByRefsBatch', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns {type:"system"} for system type without db lookup', async () => {
    const map = await resolveCreatedByRefsBatch([{ createdById: 'sys-id', createdByType: 'system' }]);
    expect(map.get('sys-id')).toEqual({ type: 'system' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('resolves user UUIDs to emails from app.users in one query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-uuid-123', email: 'chris@example.com' }], rowCount: 1 });
    const map = await resolveCreatedByRefsBatch([{ createdById: 'user-uuid-123', createdByType: 'user' }]);
    expect(map.get('user-uuid-123')).toEqual({ type: 'user', email: 'chris@example.com' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns null email when user UUID not found (deleted user)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const map = await resolveCreatedByRefsBatch([{ createdById: 'missing-uuid', createdByType: 'user' }]);
    expect(map.get('missing-uuid')).toEqual({ type: 'user', email: null });
  });

  it('resolves agent UUIDs to names from app.agents in one query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-456', name: 'Zappy AI Assistant' }], rowCount: 1 });
    const map = await resolveCreatedByRefsBatch([{ createdById: 'agent-uuid-456', createdByType: 'agent' }]);
    expect(map.get('agent-uuid-456')).toEqual({ type: 'agent', name: 'Zappy AI Assistant' });
  });

  it('returns null name when agent UUID not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const map = await resolveCreatedByRefsBatch([{ createdById: 'missing-agent', createdByType: 'agent' }]);
    expect(map.get('missing-agent')).toEqual({ type: 'agent', name: null });
  });

  it('issues at most 2 DB queries for a mix of user, agent, and system types', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'a@b.com' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'ag1', name: 'Bot' }], rowCount: 1 });
    await resolveCreatedByRefsBatch([
      { createdById: 'u1', createdByType: 'user' },
      { createdById: 'ag1', createdByType: 'agent' },
      { createdById: 'sys', createdByType: 'system' },
    ]);
    expect(mockQuery).toHaveBeenCalledTimes(2); // one for users, one for agents
  });
});

describe('selectVersionsForDocument', () => {
  const DOC_ID = 'doc-1';
  const MAIN_BRANCH = 'main-branch-id';
  const OTHER_BRANCH = 'branch-2';

  beforeEach(() => { vi.resetAllMocks(); });

  it('returns empty array when document has no versions on branch', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    expect(result).toEqual([]);
  });

  it('on main branch: includes all published versions plus latest unpublished draft', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
        { id: 'v3', version_number: 3, snapshot: null, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-03T00:00:00Z' },
      ],
      rowCount: 3,
    });
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root', props: { v: 2 } } });
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root', props: { v: 3 } } });

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    // v2 (published) and v3 (latest draft) included; v1 skipped
    expect(result).toHaveLength(2);
    expect(result[0].versionNumber).toBe(2);
    expect(result[0].isPublished).toBe(true);
    expect(result[1].versionNumber).toBe(3);
    expect(result[1].isPublished).toBe(false);
  });

  it('on main branch: includes only latest when nothing is published', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
      ],
      rowCount: 2,
    });
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root' } });

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    expect(result).toHaveLength(1);
    expect(result[0].versionNumber).toBe(2);
  });

  it('on main branch: if latest is already published, does not duplicate it', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
      ],
      rowCount: 1,
    });

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    expect(result).toHaveLength(1);
    expect(result[0].snapshot).toEqual({ root: {} });
  });

  it('omits a version that cannot be rebuilt and keeps exporting the rest', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
        { id: 'v3', version_number: 3, snapshot: null, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-03T00:00:00Z' },
      ],
      rowCount: 3,
    });
    mockReconstruct.mockRejectedValueOnce(
      new VersionReconstructionError(DOC_ID, MAIN_BRANCH, 2, 2),
    );
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root', props: { v: 3 } } });

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);

    expect(result.map((v) => v.versionNumber)).toEqual([1, 3]);
  });

  it('propagates failures that are not reconstruction failures', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
      ],
      rowCount: 2,
    });
    mockReconstruct.mockRejectedValueOnce(new Error('connection reset'));

    await expect(selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true))
      .rejects.toThrow('connection reset');
  });

  it('on non-main branch: returns only the latest version', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
      ],
      rowCount: 2,
    });
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root', props: { v: 2 } } });

    const result = await selectVersionsForDocument(DOC_ID, OTHER_BRANCH, false);
    expect(result).toHaveLength(1);
    expect(result[0].versionNumber).toBe(2);
  });

  it('excludes tombstone versions', async () => {
    // The mock returns a tombstone row mixed with a non-tombstone row, simulating a scenario
    // where the SQL filter is bypassed (defense-in-depth: the in-memory filter must also work).
    // SQL already filters tombstones via WHERE is_tombstone = false; this test ensures the
    // in-memory filter also catches tombstones so a regression in either layer is detectable.
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: { root: {} }, is_published: false, is_tombstone: true, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
      ],
      rowCount: 2,
    });

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    // v2 is a tombstone and must be excluded; only v1 survives
    expect(result).toHaveLength(1);
    expect(result[0].versionNumber).toBe(1);
  });
});
