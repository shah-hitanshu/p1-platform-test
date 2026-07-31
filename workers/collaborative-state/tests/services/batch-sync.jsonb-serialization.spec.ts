/**
 * batchSyncToPostgres binds raw objects (not pre-stringified JSON) to its
 * jsonb[] params. postgres.js's jsonb[] encoder serializes each element
 * itself, so a pre-stringified element is JSON-encoded twice and Postgres
 * stores a jsonb string scalar of escaped JSON instead of the object.
 *
 * This test mocks query(), so it sees only the value handed to the driver,
 * never what Postgres stores — it cannot observe the double-encoding directly.
 * The database-backed guard is
 * tests/integration/batch-sync.jsonb-serialization.integration.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ query: vi.fn() }));

describe('PCC-3468: batchSyncToPostgres jsonb[] serialization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Capture the parameters bound to the batch INSERT (the query containing the
  // jsonb[] unnests). Uses a typed mockImplementation so the captured params
  // are strongly typed without casting the untyped mock's call log.
  async function captureInsertParams(): Promise<{
    db: typeof import('../../src/db');
    getParams: () => unknown[];
  }> {
    const db = await import('../../src/db');
    let insertParams: unknown[] | undefined;
    vi.mocked(db.query).mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('unnest($3::jsonb[])')) {
        insertParams = params;
      }
      return Promise.resolve({ rows: [] });
    });
    return {
      db,
      getParams: (): unknown[] => {
        if (insertParams === undefined) {
          throw new Error('batch insert query was not issued');
        }
        return insertParams;
      },
    };
  }

  it('binds snapshots ($3) and action_metadata ($7) as raw objects, never JSON strings', async () => {
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
    const { getParams } = await captureInsertParams();

    await batchSyncToPostgres([
      {
        documentId: 'doc-001',
        branchId: 'branch-001',
        snapshot: { root: { props: { title: 'Doc 1' } }, content: [] },
        // Non-uuid, no `|` -> actor resolver passes through with zero DB calls,
        // so the batch INSERT is the only query issued.
        actorId: 'user-legacy-001',
        actorType: 'user',
        actionType: 'edit',
        actionMetadata: { componentType: 'Hero', zone: 'root' },
      },
    ]);

    const params = getParams();
    const snapshots = params[2];
    const actionMetadatas = params[6];

    if (!Array.isArray(snapshots) || !Array.isArray(actionMetadatas)) {
      throw new Error('expected snapshots and action_metadata binds to be arrays');
    }

    // A pre-stringified element here double-encodes once Postgres's own
    // jsonb[] driver serialization runs on top of it.
    for (const snapshot of snapshots) {
      expect(typeof snapshot).toBe('object');
    }
    expect(snapshots[0]).toEqual({ root: { props: { title: 'Doc 1' } }, content: [] });
    expect(actionMetadatas[0]).toEqual({ componentType: 'Hero', zone: 'root' });
  });

  it('binds absent action_metadata as SQL null, not the string "null"', async () => {
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
    const { getParams } = await captureInsertParams();

    await batchSyncToPostgres([
      {
        documentId: 'doc-002',
        branchId: 'branch-001',
        snapshot: { root: {} },
        actorId: 'user-legacy-001',
        actorType: 'user',
        // no actionType / actionMetadata -> null
      },
    ]);

    const actionMetadatas = getParams()[6];
    if (!Array.isArray(actionMetadatas)) {
      throw new Error('expected action_metadata bind to be an array');
    }
    expect(actionMetadatas[0]).toBeNull();
  });
});
