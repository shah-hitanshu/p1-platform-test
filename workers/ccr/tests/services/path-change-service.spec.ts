/**
 * getPathChangesSince — which documents sit at a different effective path on
 * source than on target. Deliberately separate from getModifiedDocumentsSince:
 * a move writes no version row, and must never enter conflict classification.
 * See spec D1a.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ query: vi.fn() }));

import { query } from '../../src/db';
import { getPathChangesSince } from '../../src/services/path-change-service';

const SOURCE = 'source-branch-id';
const TARGET = 'target-branch-id';

beforeEach(() => {
  vi.mocked(query).mockReset();
});

describe('getPathChangesSince', () => {
  it('returns a row when source has an override and target does not', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ document_id: 'doc-1', document_path: 'blog/post', base_document_path: 'post' }],
      rowCount: 1,
    });

    const result = await getPathChangesSince(SOURCE, TARGET);

    expect(result).toEqual([
      { documentId: 'doc-1', documentPath: 'blog/post', baseDocumentPath: 'post' },
    ]);
  });

  it('passes source and target branch ids as the first two parameters', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getPathChangesSince(SOURCE, TARGET);
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params?.[0]).toBe(SOURCE);
    expect(params?.[1]).toBe(TARGET);
  });

  it('returns an empty array when no override exists anywhere', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getPathChangesSince(SOURCE, TARGET)).toEqual([]);
  });

  it('excludes archived documents and equal paths in SQL, not in JS', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getPathChangesSince(SOURCE, TARGET);
    const [sqlText] = vi.mocked(query).mock.calls[0];
    expect(sqlText).toMatch(/archived_at IS NULL/);
    expect(sqlText).toMatch(/<>/);
    expect(sqlText).toMatch(/COALESCE/);
  });

  // Starting from app.documents scans every document in every site: only
  // documents carrying an override on either branch can have moved.
  it('drives the candidate set from the override table, not from all documents', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getPathChangesSince(SOURCE, TARGET);
    const [sqlText] = vi.mocked(query).mock.calls[0];
    expect(sqlText).toMatch(/FROM \(\s*SELECT DISTINCT document_id/);
    expect(sqlText).toMatch(/FROM app\.branch_document_paths\s*WHERE branch_id IN \(\$1, \$2\)/);
    expect(sqlText).toMatch(/JOIN app\.documents d ON d\.id = candidate\.document_id/);
    expect(sqlText).not.toMatch(/FROM app\.documents d\b/);
  });
});
