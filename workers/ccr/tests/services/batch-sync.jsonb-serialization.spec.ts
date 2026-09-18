/**
 * batchSyncToPostgres binds each jsonb[] element as a JSON string, because the
 * Drizzle client parses and serializes json as identity: its array serializer
 * quotes each element for the array literal without encoding it first, so an
 * unstringified element crashes the serializer. On the legacy query()
 * connection, which keeps postgres.js's own json serializer, the same
 * pre-stringifying would double-encode instead [PCC-3468]. Which is correct
 * depends on the connection the statement runs on.
 *
 * This test stubs the Drizzle connection, so it sees only the value handed to
 * the driver, never what Postgres stores — it cannot observe how Postgres
 * parses the bound string back into jsonb. The database-backed guard is
 * tests/integration/batch-sync.jsonb-serialization.integration.spec.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentVersions } from '../../src/db/schema';

describe('PCC-3468: batchSyncToPostgres jsonb[] serialization', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  // The batch INSERT binds documentIds, branchIds, snapshots, actorIds,
  // actorTypes, actionTypes, actionMetadatas in that order (params[2] is the
  // jsonb[] snapshot bind, params[6] the jsonb[] action_metadata bind).
  function insertParams(): unknown[] {
    const call = database.calls(documentVersions).insert[0];
    if (call === undefined) {
      throw new Error('batch insert query was not issued');
    }
    return call.params;
  }

  it('binds snapshots ($3) and action_metadata ($7) as JSON strings, each parsing back to the original object', async () => {
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

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

    const params = insertParams();
    const snapshots = params[2];
    const actionMetadatas = params[6];

    if (!Array.isArray(snapshots) || !Array.isArray(actionMetadatas)) {
      throw new Error('expected snapshots and action_metadata binds to be arrays');
    }

    // Every element must be a JSON string — an object element crashes the
    // jsonb[] array serializer rather than being encoded.
    for (const snapshot of snapshots) {
      expect(typeof snapshot).toBe('string');
    }
    expect(JSON.parse(snapshots[0] as string)).toEqual({ root: { props: { title: 'Doc 1' } }, content: [] });
    expect(JSON.parse(actionMetadatas[0] as string)).toEqual({ componentType: 'Hero', zone: 'root' });
  });

  it('binds absent action_metadata as SQL null, not the string "null"', async () => {
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

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

    const actionMetadatas = insertParams()[6];
    if (!Array.isArray(actionMetadatas)) {
      throw new Error('expected action_metadata bind to be an array');
    }
    expect(actionMetadatas[0]).toBeNull();
  });

  it('folds an attribution into action_metadata, with or without other metadata', async () => {
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
    const attribution = {
      agent: { id: 'agent-1', name: 'Copy Editor' },
      onBehalfOf: { id: 'user-legacy-001', name: 'Ada' },
      description: 'Shorten the headline',
    };

    await batchSyncToPostgres([
      {
        documentId: 'doc-003',
        branchId: 'branch-001',
        snapshot: { root: {} },
        actorId: 'user-legacy-001',
        actorType: 'user',
        attribution,
      },
      {
        documentId: 'doc-004',
        branchId: 'branch-001',
        snapshot: { root: {} },
        actorId: 'user-legacy-001',
        actorType: 'user',
        actionMetadata: { componentType: 'Hero' },
        attribution,
      },
    ]);

    const actionMetadatas = insertParams()[6];
    if (!Array.isArray(actionMetadatas)) {
      throw new Error('expected action_metadata bind to be an array');
    }
    expect(JSON.parse(actionMetadatas[0] as string)).toEqual({ attribution });
    expect(JSON.parse(actionMetadatas[1] as string)).toEqual({ componentType: 'Hero', attribution });
  });
});
