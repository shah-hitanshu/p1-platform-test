/**
 * Structure-node reparenting rules, run against Postgres.
 *
 * The cycle guard is a recursive walk up the parent chain, so it is only
 * answerable by a database that can run the recursion.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createRealDatabaseConnection } from '../helpers/database';
import type { Database } from '../../src/db/executor';
import { siteStructures, sites, structureNodes } from '../../src/db/schema';
import { moveNode, getNode } from '../../src/services/node-service';
import { CircularReferenceError, NodeNotFoundError } from '../../src/services/errors';

describe('Node reparenting', () => {
  let db: Database;
  let close: () => Promise<void>;
  let structureId: string;
  let parentId: string;
  let childId: string;
  let grandchildId: string;
  let siteId: string;

  beforeAll(async () => {
    const handles = createRealDatabaseConnection();
    db = handles.db;
    close = () => handles.connection.close();

    const [site] = await db
      .insert(sites)
      .values({ name: 'node-reparenting-test' })
      .returning({ id: sites.id });
    siteId = site!.id;

    const [structure] = await db
      .insert(siteStructures)
      .values({ siteId })
      .returning({ id: siteStructures.id });
    structureId = structure!.id;

    const [parent] = await db
      .insert(structureNodes)
      .values({ structureId, name: 'Parent', slug: 'parent', nodeType: 'section', position: 0 })
      .returning({ id: structureNodes.id });
    parentId = parent!.id;

    const [child] = await db
      .insert(structureNodes)
      .values({
        structureId,
        parentNodeId: parentId,
        name: 'Child',
        slug: 'child',
        nodeType: 'section',
        position: 0,
      })
      .returning({ id: structureNodes.id });
    childId = child!.id;

    const [grandchild] = await db
      .insert(structureNodes)
      .values({
        structureId,
        parentNodeId: childId,
        name: 'Grandchild',
        slug: 'grandchild',
        nodeType: 'section',
        position: 0,
      })
      .returning({ id: structureNodes.id });
    grandchildId = grandchild!.id;
  });

  afterAll(async () => {
    await db.delete(structureNodes).where(eq(structureNodes.structureId, structureId));
    await db.delete(siteStructures).where(eq(siteStructures.id, structureId));
    await db.delete(sites).where(eq(sites.id, siteId));
    await close();
  });

  it('rejects a move that would make a node its own descendant', async () => {
    await expect(moveNode(parentId, { newParentId: childId, newPosition: 0 })).rejects.toThrow(
      CircularReferenceError,
    );

    const unchanged = await getNode(parentId);
    expect(unchanged?.parentNodeId).toBeUndefined();
  });

  it('rejects a move onto an indirect descendant', async () => {
    await expect(
      moveNode(parentId, { newParentId: grandchildId, newPosition: 0 }),
    ).rejects.toThrow(CircularReferenceError);
  });

  it('rejects a move onto the node itself', async () => {
    await expect(moveNode(childId, { newParentId: childId, newPosition: 0 })).rejects.toThrow(
      CircularReferenceError,
    );
  });

  it('accepts a move to an unrelated parent', async () => {
    const [sibling] = await db
      .insert(structureNodes)
      .values({ structureId, name: 'Sibling', slug: 'sibling', nodeType: 'section', position: 1 })
      .returning({ id: structureNodes.id });

    const moved = await moveNode(grandchildId, {
      newParentId: sibling!.id,
      newPosition: 3,
    });

    expect(moved.parentNodeId).toBe(sibling!.id);
    expect(moved.position).toBe(3);
  });

  it('reports a missing node rather than reparenting nothing', async () => {
    await expect(
      moveNode('00000000-0000-0000-0000-000000000000', {
        newParentId: null,
        newPosition: 0,
      }),
    ).rejects.toThrow(NodeNotFoundError);
  });
});
