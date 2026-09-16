/**
 * Regression tests for PCC-3661: countDocumentsOnBranch returned wrong
 * pagination totals — inflated by version history on the single-branch path,
 * and silently missing inherited pages on the COW path when a path prefix and
 * a template filter were combined.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { countDocumentsOnBranch } from '../../src/services/branch-document-service';

/** The values a statement binds to each occurrence of `pattern`'s placeholder. */
function boundTo(statement: { sql: string; params: unknown[] }, pattern: RegExp): unknown[] {
  return [...statement.sql.matchAll(pattern)].map(
    (match) => statement.params[Number(match[1]) - 1],
  );
}

describe('countDocumentsOnBranch (PCC-3661)', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
    stub.on('counted').select.returnsRaw([{ count: '7' }]);
  });

  it('counts distinct documents, not versions, on the single-branch path', async () => {
    await countDocumentsOnBranch('branch-main');

    // The inner select joins document_versions — one row per version. Without
    // DISTINCT, the outer COUNT(*) returns versions, so the total grows with
    // edit history while the listing stays per-document.
    expect(stub.statements[0].sql).toContain('SELECT DISTINCT d.id');
  });

  it('binds the path prefix, not the template ID, in the inherited arm when both filters are set', async () => {
    await countDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
      pathPrefix: 'pages/',
      templateId: 'template-1',
    });

    const statement = stub.statements[0];

    // Both UNION arms must compare the effective path against the escaped
    // prefix. The bug bound the second arm's LIKE to the running param count,
    // which by then pointed at the template ID — so no inherited page ever
    // matched and they all dropped out of the total.
    expect(boundTo(statement, /LIKE \$(\d+)/g)).toEqual(['pages/%', 'pages/%']);
    expect(boundTo(statement, /dr\.target_document_id = \$(\d+)/g)).toEqual([
      'template-1',
      'template-1',
    ]);
  });
});
