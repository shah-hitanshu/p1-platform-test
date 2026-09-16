/**
 * Branch creation copies structure state with an INSERT ... SELECT whose column
 * list is the table's own, in schema order, so a projection out of that order
 * lands values in the wrong columns.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type postgres from 'postgres';
import { branches, branchStructureState, sites, siteStructures } from '../../src/db/schema';
import { copyStructureStateForBranch } from '../../src/services/structure-service';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';

const siteId = randomUUID();
const sourceBranchId = randomUUID();
const targetBranchId = randomUUID();
const structureId = randomUUID();
const author = randomUUID();
const lastModifiedAt = new Date('2026-01-02T03:04:05.000Z');

const source = {
  branchId: sourceBranchId,
  structureId,
  structureTree: [{ id: 'root', children: ['leaf'] }],
  metadataSchema: { type: 'object', properties: { headline: { type: 'string' } } },
  schemaEnforcement: 'strict',
  hasChangesSinceCheckpoint: true,
  lastModifiedAt,
  lastModifiedBy: author,
  name: 'Products',
  slug: 'products',
  description: 'Product catalogue',
  structureType: 'taxonomy',
};

let db: ReturnType<typeof createRealDatabaseConnection>['db'];
let close: ReturnType<typeof createRealDatabaseConnection>['close'];
let sql: postgres.Sql;

beforeAll(async () => {
  ({ db, close, sql } = createRealDatabaseConnection());

  await db.insert(sites).values({ id: siteId, name: 'Structure copy' });
  await db.insert(branches).values([
    { id: sourceBranchId, siteId, name: 'main', isMain: true, createdById: author, createdByType: 'user' },
    { id: targetBranchId, siteId, name: 'feature', createdById: author, createdByType: 'user' },
  ]);
  await db.insert(siteStructures).values({ id: structureId, siteId });
  await db.insert(branchStructureState).values(source);
});

afterAll(async () => {
  await deleteSiteCascade(sql, siteId);
  await close();
});

describe('copyStructureStateForBranch', () => {
  it('lands every column of the source row in the same column of the copy', async () => {
    await copyStructureStateForBranch(sourceBranchId, targetBranchId);

    const [copied] = await db
      .select()
      .from(branchStructureState)
      .where(
        and(
          eq(branchStructureState.branchId, targetBranchId),
          eq(branchStructureState.structureId, structureId),
        ),
      );

    expect(copied).toEqual({
      ...source,
      branchId: targetBranchId,
      // The copy starts even with the checkpoint the source has drifted from.
      hasChangesSinceCheckpoint: false,
    });
  });
});
