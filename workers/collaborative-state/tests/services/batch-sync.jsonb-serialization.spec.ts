/**
 * PCC-3468: batchSyncToPostgres must pre-serialize the object arrays it binds
 * to jsonb[] parameters.
 *
 * postgres.js 3.4.9 regressed its array serializer: an array of JS objects
 * passed to a jsonb[] bind (`unnest($N::jsonb[])`) throws
 * `TypeError: Cannot read properties of undefined (reading 'replace')` in
 * arrayEscape — crashing the WHOLE sync batch before any insert (the queue
 * consumer dead-letters; realtime edits never persist). The committed lockfile
 * pins 3.4.9, so a fresh CI/staging/prod build hits this.
 *
 * Fix: bind pre-stringified JSON. Postgres parses each text element into jsonb,
 * which is correct on every driver version. These tests guard the serialization
 * mechanism regardless of the installed driver (a mocked-query unit test cannot
 * observe the driver crash directly, so it asserts the shape that avoids it).
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

  it('binds snapshots ($3) and action_metadata ($7) as JSON strings, never raw objects', async () => {
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
    const { getParams } = await captureInsertParams();

    await batchSyncToPostgres([
      {
        documentId: 'doc-001',
        branchId: 'branch-001',
        // A production-shaped nested object — the exact thing that crashes the
        // 3.4.9 array serializer when passed raw to a jsonb[] bind.
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

    // Every jsonb[] element must be a JSON string (a raw object crashes 3.4.9).
    for (const snapshot of snapshots) {
      expect(typeof snapshot).toBe('string');
    }
    // ...and it must be valid JSON round-tripping to the original shape.
    const parsed = JSON.parse(snapshots[0] as string) as { root?: { props?: { title?: string } } };
    expect(parsed.root?.props?.title).toBe('Doc 1');

    expect(actionMetadatas[0]).toBe(JSON.stringify({ componentType: 'Hero', zone: 'root' }));
  });

  it('serializes absent action_metadata as SQL null, not the string "null"', async () => {
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
