/**
 * getPathChangesSince — which documents sit at a different effective path on
 * source than on target. Deliberately separate from getModifiedDocumentsSince:
 * a move writes no version row, and must never enter conflict classification.
 * See spec D1a.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { documents } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { getPathChangesSince } from '../../src/services/path-change-service';

const SOURCE = 'source-branch-id';
const TARGET = 'target-branch-id';

let database: DatabaseStub;

beforeEach(() => {
  database = stubDatabase();
});

describe('getPathChangesSince', () => {
  it('returns a row when source has an override and target does not', async () => {
    database.on(documents).select.returnsRaw([
      { document_id: 'doc-1', document_path: 'blog/post', base_document_path: 'post' },
    ]);

    const result = await getPathChangesSince(SOURCE, TARGET);

    expect(result).toEqual([
      { documentId: 'doc-1', documentPath: 'blog/post', baseDocumentPath: 'post' },
    ]);
  });

  it('passes source and target branch ids as parameters', async () => {
    await getPathChangesSince(SOURCE, TARGET);
    expect(database.calls(documents).select[0].params).toEqual([SOURCE, TARGET, SOURCE, TARGET]);
  });

  it('returns an empty array when no override exists anywhere', async () => {
    expect(await getPathChangesSince(SOURCE, TARGET)).toEqual([]);
  });

  it('excludes archived documents and equal paths in SQL, not in JS', async () => {
    await getPathChangesSince(SOURCE, TARGET);
    const { sql: statement } = database.calls(documents).select[0];
    expect(statement).toMatch(/archived_at IS NULL/);
    expect(statement).toMatch(/<>/);
    expect(statement).toMatch(/COALESCE/);
  });

  // Only documents carrying an override on either branch can have moved, so the
  // candidate join has to restrict the scan rather than walk every document in
  // every site.
  it('drives the candidate set from the override table, not from all documents', async () => {
    await getPathChangesSince(SOURCE, TARGET);
    const { sql: statement } = database.calls(documents).select[0];
    expect(statement).toMatch(
      /JOIN \(\s*SELECT DISTINCT document_id\s+FROM app\.branch_document_paths\s+WHERE branch_id IN \(/,
    );
    expect(statement).toMatch(/\) candidate ON candidate\.document_id = d\.id/);
  });
});
