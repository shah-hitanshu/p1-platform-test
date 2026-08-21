/**
 * Regression tests for PCC-3661: countDocumentsOnBranch returned wrong
 * pagination totals — inflated by version history on the single-branch path,
 * and silently missing inherited pages on the COW path when a path prefix and
 * a template filter were combined.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

describe('countDocumentsOnBranch (PCC-3661)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('counts distinct documents, not versions, on the single-branch path', async () => {
    const { countDocumentsOnBranch } = await import(
      '../../src/services/branch-document-service'
    );
    const db = await import('../../src/db');
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '7' }] });

    await countDocumentsOnBranch('branch-main');

    const sql = vi.mocked(db.query).mock.calls[0][0];
    // The inner select joins document_versions — one row per version. Without
    // DISTINCT, the outer COUNT(*) returns versions, so the total grows with
    // edit history while the listing stays per-document.
    expect(sql).toContain('SELECT DISTINCT d.id');
  });

  it('binds the path prefix, not the template ID, in the inherited arm when both filters are set', async () => {
    const { countDocumentsOnBranch } = await import(
      '../../src/services/branch-document-service'
    );
    const db = await import('../../src/db');
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '3' }] });

    await countDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
      pathPrefix: 'pages/',
      templateId: 'template-1',
    });

    const call = vi.mocked(db.query).mock.calls[0];
    const sql = call[0];
    const params = call[1]!;

    expect(params).toEqual([
      'branch-feature',
      'branch-main',
      'pages%',
      'template-1',
    ]);

    // Both UNION arms must compare the effective path against $3 (the escaped
    // prefix). The bug bound the second arm's LIKE to the running param count,
    // which by then pointed at $4 — the template ID — so no inherited page
    // ever matched and they all dropped out of the total.
    const likeBinds = [...sql.matchAll(/LIKE (\$\d+)/g)].map((m) => m[1]);
    expect(likeBinds).toEqual(['$3', '$3']);

    const templateBinds = [
      ...sql.matchAll(/dr\.target_document_id = (\$\d+)/g),
    ].map((m) => m[1]);
    expect(templateBinds).toEqual(['$4', '$4']);
  });
});
