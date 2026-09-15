/**
 * Reading back the version row a direct sync wrote.
 *
 * `executeDirectSync` writes through a raw statement, so the stub database
 * records its bindings rather than a row. The statement's `incoming` CTE binds
 * one parameter per column, in the order below, which is what lets the
 * bindings be named here instead of counted at each call site.
 */

import type { DatabaseStub } from '../__stubs__/database';

export interface InsertedVersion {
  documentId: unknown;
  branchId: unknown;
  snapshot: Record<string, unknown>;
  createdById: unknown;
  createdByType: unknown;
  actionType: unknown;
  actionMetadata: unknown;
}

export function insertedVersion(database: DatabaseStub): InsertedVersion {
  const call = database.statements.find(
    (statement) => statement.sql.includes('INSERT INTO app.document_versions'),
  );
  if (call === undefined) {
    throw new Error('No INSERT INTO app.document_versions statement was captured');
  }
  const [
    documentId, branchId, snapshot, createdById, createdByType, actionType, actionMetadata,
  ] = call.params;
  return {
    documentId,
    branchId,
    // The snapshot reaches Postgres as text: the Drizzle client serializes json
    // as identity, so an object would arrive as [object Object].
    snapshot: JSON.parse(snapshot as string) as Record<string, unknown>,
    createdById,
    createdByType,
    actionType,
    actionMetadata,
  };
}
