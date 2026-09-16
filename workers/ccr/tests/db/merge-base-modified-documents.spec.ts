/**
 * Merge base document comparison against a real Postgres.
 *
 * `getModifiedDocumentsSince` and `getBranchLineage` are CTE queries: what they
 * return for a given branch, checkpoint and version graph is a property of the
 * SQL, so the rows are asserted here. The SQL those queries build from
 * `options.publishedOnly` is asserted in
 * tests/services/merge-base-service.spec.ts.
 *
 * Prerequisites:
 * - PostgreSQL running: make docker-up
 * - Migrations applied: pnpm db:migrate
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type postgres from 'postgres';
import type { Database } from '../../src/db';
import {
  branches,
  checkpointDocuments,
  checkpoints,
  documentVersions,
  documents,
  sites,
} from '../../src/db/schema';
import {
  findMergeBase,
  getBranchLineage,
  getModifiedDocumentsSince,
} from '../../src/services/merge-base-service';
import { TargetBranchNotFoundError } from '../../src/services/errors';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';

/** Checkpoint ordering is by created_at, so every checkpoint gets its own. */
const FIRST = new Date('2026-01-01T00:00:00.000Z');
const SECOND = new Date('2026-02-01T00:00:00.000Z');
const THIRD = new Date('2026-03-01T00:00:00.000Z');

const AUTHOR = { createdById: randomUUID(), createdByType: 'user' };

let db: Database;
let sql: postgres.Sql;
let close: () => Promise<void>;
let siteIds: string[] = [];
let siteId: string;
let mainBranchId: string;

async function createSite(): Promise<string> {
  const [row] = await db
    .insert(sites)
    .values({ name: `merge-base-${randomUUID()}` })
    .returning({ id: sites.id });
  siteIds.push(row.id);
  return row.id;
}

async function createBranch(values: {
  name: string;
  siteId?: string;
  isMain?: boolean;
  sourceBranchId?: string;
  sourceCheckpointId?: string;
}): Promise<string> {
  const [row] = await db
    .insert(branches)
    .values({ siteId, ...AUTHOR, ...values })
    .returning({ id: branches.id });
  return row.id;
}

async function createDocument(values: { path: string; archivedAt?: Date }): Promise<string> {
  const [row] = await db
    .insert(documents)
    .values({ siteId, ...values })
    .returning({ id: documents.id });
  return row.id;
}

async function createVersion(values: {
  documentId: string;
  branchId: string;
  versionNumber: number;
  source?: string;
  isTombstone?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(documentVersions)
    .values({ ...AUTHOR, snapshot: { title: values.documentId }, ...values })
    .returning({ id: documentVersions.id });
  return row.id;
}

async function createCheckpoint(values: {
  branchId: string;
  createdAt: Date;
  checkpointType?: string;
}): Promise<string> {
  const [row] = await db
    .insert(checkpoints)
    .values({ ...AUTHOR, ...values })
    .returning({ id: checkpoints.id });
  return row.id;
}

async function capture(
  checkpointId: string,
  entries: { documentId: string; versionId: string }[],
): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(checkpointDocuments).values(
    entries.map((entry) => ({
      checkpointId,
      documentId: entry.documentId,
      documentVersionId: entry.versionId,
    })),
  );
}

function byPath(path: string) {
  return (document: { documentPath: string }): boolean => document.documentPath === path;
}

beforeAll(async () => {
  const handles = createRealDatabaseConnection();
  db = handles.db;
  sql = handles.sql;
  close = handles.close;
  await sql`SELECT 1`;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  siteId = await createSite();
  mainBranchId = await createBranch({ name: 'main', isMain: true });
});

afterEach(async () => {
  // Newest site first: a branch may reference one in an older site as its
  // source, and that foreign key is NO ACTION.
  for (const id of [...siteIds].reverse()) {
    await deleteSiteCascade(sql, id);
  }
  siteIds = [];
});

describe('findMergeBase', () => {
  it('should throw TargetBranchNotFoundError when target branch does not exist', async () => {
    const feature = await createBranch({ name: 'feature', sourceBranchId: mainBranchId });

    await expect(findMergeBase(feature, randomUUID())).rejects.toThrow(
      TargetBranchNotFoundError,
    );
  });
});

describe('getModifiedDocumentsSince', () => {
  it('should return documents modified on branch since checkpoint', async () => {
    const home = await createDocument({ path: 'pages/home' });
    const about = await createDocument({ path: 'pages/about' });
    const homeBase = await createVersion({
      documentId: home,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const aboutBase = await createVersion({
      documentId: about,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [
      { documentId: home, versionId: homeBase },
      { documentId: about, versionId: aboutBase },
    ]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    await createVersion({ documentId: home, branchId: feature, versionNumber: 3 });
    await createVersion({ documentId: about, branchId: feature, versionNumber: 2 });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result).toHaveLength(2);
    const modifiedHome = result.find(byPath('pages/home'));
    expect(modifiedHome?.documentId).toBe(home);
    expect(modifiedHome?.latestVersionNumber).toBe(3);
    expect(modifiedHome?.baseVersionNumber).toBe(1);
    expect(modifiedHome?.baseVersionId).toBe(homeBase);
    expect(result.find(byPath('pages/about'))?.latestVersionNumber).toBe(2);
  });

  it('should return empty array when no documents modified', async () => {
    const home = await createDocument({ path: 'pages/home' });
    const version = await createVersion({
      documentId: home,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [{ documentId: home, versionId: version }]);

    const result = await getModifiedDocumentsSince(mainBranchId, checkpoint);

    expect(result).toEqual([]);
  });

  it('should include deleted documents', async () => {
    const home = await createDocument({ path: 'pages/home' });
    const base = await createVersion({
      documentId: home,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [{ documentId: home, versionId: base }]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    await createVersion({
      documentId: home,
      branchId: feature,
      versionNumber: 2,
      isTombstone: true,
    });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result).toHaveLength(1);
    expect(result[0].isDeleted).toBe(true);
  });

  it('should include documents with source=edit versions (genuinely modified)', async () => {
    const edited = await createDocument({ path: 'pages/edited' });
    const base = await createVersion({
      documentId: edited,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [{ documentId: edited, versionId: base }]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    await createVersion({
      documentId: edited,
      branchId: feature,
      versionNumber: 3,
      source: 'edit',
    });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result).toHaveLength(1);
    expect(result[0].documentId).toBe(edited);
    expect(result[0].latestVersionNumber).toBe(3);
  });

  it('should exclude documents with only source=branch versions (unmodified copies)', async () => {
    const copied = await createDocument({ path: 'pages/copied' });
    const edited = await createDocument({ path: 'pages/edited' });
    const copiedBase = await createVersion({
      documentId: copied,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const editedBase = await createVersion({
      documentId: edited,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [
      { documentId: copied, versionId: copiedBase },
      { documentId: edited, versionId: editedBase },
    ]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    await createVersion({
      documentId: copied,
      branchId: feature,
      versionNumber: 1,
      source: 'branch',
    });
    await createVersion({ documentId: edited, branchId: feature, versionNumber: 2, source: 'edit' });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result).toHaveLength(1);
    expect(result[0].documentId).toBe(edited);
  });

  it('should use SQL that filters out unmodified branch copies', async () => {
    const live = await createDocument({ path: 'pages/live' });
    const archived = await createDocument({ path: 'pages/archived', archivedAt: THIRD });
    const liveBase = await createVersion({
      documentId: live,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const archivedBase = await createVersion({
      documentId: archived,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [
      { documentId: live, versionId: liveBase },
      { documentId: archived, versionId: archivedBase },
    ]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    await createVersion({ documentId: live, branchId: feature, versionNumber: 1, source: 'branch' });
    await createVersion({
      documentId: archived,
      branchId: feature,
      versionNumber: 1,
      source: 'branch',
    });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    // The exclusion is scoped to live documents: an archived branch copy is a
    // deletion the merge still has to carry.
    expect(result.map((document) => document.documentPath)).toEqual(['pages/archived']);
  });

  it('should mark archived documents as isDeleted true', async () => {
    const archived = await createDocument({ path: 'pages/archived-page', archivedAt: THIRD });
    const base = await createVersion({
      documentId: archived,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [{ documentId: archived, versionId: base }]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    await createVersion({
      documentId: archived,
      branchId: feature,
      versionNumber: 2,
      isTombstone: true,
    });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result).toHaveLength(1);
    expect(result[0].isDeleted).toBe(true);
    expect(result[0].documentPath).toBe('pages/archived-page');
  });

  it('should include documents in checkpoint but not on branch as deleted', async () => {
    const removed = await createDocument({ path: 'pages/removed' });
    const base = await createVersion({
      documentId: removed,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [{ documentId: removed, versionId: base }]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    const tombstone = await createVersion({
      documentId: removed,
      branchId: feature,
      versionNumber: 2,
      isTombstone: true,
    });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result).toHaveLength(1);
    expect(result[0].documentId).toBe(removed);
    expect(result[0].isDeleted).toBe(true);
    expect(result[0].latestVersionId).toBe(tombstone);
    expect(result[0].baseVersionId).toBe(base);
    expect(result[0].baseVersionNumber).toBe(1);
  });

  it('should resolve full checkpoint state at merge base time for source branch queries (issue #34)', async () => {
    const home = await createDocument({ path: 'pages/home' });
    const base = await createVersion({
      documentId: home,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const earlier = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(earlier, [{ documentId: home, versionId: base }]);
    // The merge base captures nothing of its own; the state at its time comes
    // from every checkpoint on the branch at or before it.
    const mergeBase = await createCheckpoint({ branchId: mainBranchId, createdAt: SECOND });
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: mergeBase,
    });
    await createVersion({ documentId: home, branchId: feature, versionNumber: 1, source: 'branch' });

    const result = await getModifiedDocumentsSince(feature, mergeBase);

    expect(result).toEqual([]);
  });

  it('should exclude archived documents not in checkpoint (created then deleted, net-zero)', async () => {
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    const netZero = await createDocument({ path: 'pages/net-zero', archivedAt: THIRD });
    await createVersion({ documentId: netZero, branchId: feature, versionNumber: 1 });
    const created = await createDocument({ path: 'pages/created' });
    await createVersion({ documentId: created, branchId: feature, versionNumber: 1 });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result.map((document) => document.documentPath)).toEqual(['pages/created']);
  });

  it('should NOT treat inherited documents as deleted on COW branches', async () => {
    const inherited = await createDocument({ path: 'pages/inherited' });
    const base = await createVersion({
      documentId: inherited,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [{ documentId: inherited, versionId: base }]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    const edited = await createDocument({ path: 'pages/edited' });
    await createVersion({ documentId: edited, branchId: feature, versionNumber: 1 });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    // A document with no version on the branch is inherited, not deleted.
    expect(result.map((document) => document.documentPath)).toEqual(['pages/edited']);
  });

  it('compares latest vs base by version_id (UUID), not version_number (per-branch sequence)', async () => {
    // version_number is per-(branch, document), so a branch's v2 and main's v2
    // are different content. Only version_id is globally unique, and comparing
    // numbers would drop this document from the modified set.
    const collided = await createDocument({ path: 'articles/collided' });
    const base = await createVersion({
      documentId: collided,
      branchId: mainBranchId,
      versionNumber: 2,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [{ documentId: collided, versionId: base }]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    const latest = await createVersion({
      documentId: collided,
      branchId: feature,
      versionNumber: 2,
      source: 'edit',
    });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result).toHaveLength(1);
    expect(result[0].latestVersionNumber).toBe(result[0].baseVersionNumber);
    expect(result[0].latestVersionId).toBe(latest);
    expect(result[0].baseVersionId).toBe(base);
  });

  it('should detect tombstoned documents via is_tombstone column', async () => {
    const removed = await createDocument({ path: 'pages/removed' });
    const base = await createVersion({
      documentId: removed,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const checkpoint = await createCheckpoint({ branchId: mainBranchId, createdAt: FIRST });
    await capture(checkpoint, [{ documentId: removed, versionId: base }]);
    const feature = await createBranch({
      name: 'feature',
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint,
    });
    await createVersion({ documentId: removed, branchId: feature, versionNumber: 2 });
    const tombstone = await createVersion({
      documentId: removed,
      branchId: feature,
      versionNumber: 3,
      isTombstone: true,
    });

    const result = await getModifiedDocumentsSince(feature, checkpoint);

    expect(result).toHaveLength(1);
    expect(result[0].isDeleted).toBe(true);
    // A deletion is a tombstone version, not the absence of one.
    expect(result[0].latestVersionId).toBe(tombstone);
    expect(result[0].latestVersionNumber).toBe(3);
  });
});

describe('getModifiedDocumentsSince with publishedOnly option', () => {
  it('should not include unpublished edits when publishedOnly is true', async () => {
    const home = await createDocument({ path: 'pages/home' });
    const published = await createVersion({
      documentId: home,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const publishCheckpoint = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: FIRST,
      checkpointType: 'publish',
    });
    await capture(publishCheckpoint, [{ documentId: home, versionId: published }]);
    await createVersion({
      documentId: home,
      branchId: mainBranchId,
      versionNumber: 2,
      source: 'edit',
    });
    const mergeBase = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: SECOND,
      checkpointType: 'auto',
    });

    expect(await getModifiedDocumentsSince(mainBranchId, mergeBase, { publishedOnly: true }))
      .toEqual([]);
    // The same edit is a change on the source side, where the current state is
    // document_versions rather than the published capture.
    expect(await getModifiedDocumentsSince(mainBranchId, mergeBase)).toHaveLength(1);
  });

  it('should resolve full published state at merge base time, not just single checkpoint docs (issue #34)', async () => {
    const old = await createDocument({ path: 'pages/old' });
    const oldPublished = await createVersion({
      documentId: old,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const earlierPublish = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: FIRST,
      checkpointType: 'publish',
    });
    await capture(earlierPublish, [{ documentId: old, versionId: oldPublished }]);
    const mergeBase = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: SECOND,
      checkpointType: 'publish',
    });
    const fresh = await createDocument({ path: 'pages/new' });
    const freshPublished = await createVersion({
      documentId: fresh,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const laterPublish = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: THIRD,
      checkpointType: 'publish',
    });
    await capture(laterPublish, [{ documentId: fresh, versionId: freshPublished }]);

    const result = await getModifiedDocumentsSince(mainBranchId, mergeBase, {
      publishedOnly: true,
    });

    // The merge base captures nothing, so only the publish after it is a change.
    expect(result.map((document) => document.documentPath)).toEqual(['pages/new']);
    expect(result[0].baseVersionId).toBeNull();
  });

  it('should not report document as modified when it was published before merge base and unchanged since (issue #34)', async () => {
    const stable = await createDocument({ path: 'pages/stable' });
    const published = await createVersion({
      documentId: stable,
      branchId: mainBranchId,
      versionNumber: 78,
    });
    const earlierPublish = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: FIRST,
      checkpointType: 'publish',
    });
    await capture(earlierPublish, [{ documentId: stable, versionId: published }]);
    const mergeBase = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: SECOND,
      checkpointType: 'auto',
    });

    const result = await getModifiedDocumentsSince(mainBranchId, mergeBase, {
      publishedOnly: true,
    });

    expect(result).toEqual([]);
  });

  it('should detect new published documents since checkpoint when publishedOnly is true', async () => {
    const mergeBase = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: FIRST,
      checkpointType: 'publish',
    });
    const fresh = await createDocument({ path: 'pages/new-page' });
    const published = await createVersion({
      documentId: fresh,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const laterPublish = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: SECOND,
      checkpointType: 'publish',
    });
    await capture(laterPublish, [{ documentId: fresh, versionId: published }]);

    const result = await getModifiedDocumentsSince(mainBranchId, mergeBase, {
      publishedOnly: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].documentId).toBe(fresh);
    expect(result[0].latestVersionId).toBe(published);
    expect(result[0].baseVersionId).toBeNull();
  });
});

describe('getModifiedDocumentsSince — tombstone overlay on publishedOnly', () => {
  it('passes through isDeleted=true when the publish checkpoint reference IS the tombstone (no overlay needed)', async () => {
    const removed = await createDocument({ path: 'pages/removed' });
    const base = await createVersion({
      documentId: removed,
      branchId: mainBranchId,
      versionNumber: 1,
    });
    const mergeBase = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: FIRST,
      checkpointType: 'publish',
    });
    await capture(mergeBase, [{ documentId: removed, versionId: base }]);
    const tombstone = await createVersion({
      documentId: removed,
      branchId: mainBranchId,
      versionNumber: 2,
      isTombstone: true,
    });
    const publishedDeletion = await createCheckpoint({
      branchId: mainBranchId,
      createdAt: SECOND,
      checkpointType: 'publish',
    });
    await capture(publishedDeletion, [{ documentId: removed, versionId: tombstone }]);

    const result = await getModifiedDocumentsSince(mainBranchId, mergeBase, {
      publishedOnly: true,
    });

    // A tombstone the publish captured is the published state, so the overlay's
    // strict version_number comparison must not exclude it.
    expect(result).toHaveLength(1);
    expect(result[0].isDeleted).toBe(true);
    expect(result[0].latestVersionId).toBe(tombstone);
  });
});

describe('getBranchLineage', () => {
  it('should return branch lineage from current to root', async () => {
    const feature = await createBranch({ name: 'feature', sourceBranchId: mainBranchId });

    const result = await getBranchLineage(feature);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(feature);
    expect(result[0].depth).toBe(0);
    expect(result[1].id).toBe(mainBranchId);
    expect(result[1].depth).toBe(1);
  });

  it('should return single branch for root branch (main)', async () => {
    const result = await getBranchLineage(mainBranchId);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(mainBranchId);
    expect(result[0].sourceBranchId).toBeNull();
    expect(result[0].depth).toBe(0);
  });

  it('should handle deep branch hierarchies', async () => {
    // Branching is main-only: a branch's source must be its site's main branch,
    // so a chain longer than two links spans sites.
    const downstreamSiteId = await createSite();
    const feature = await createBranch({
      name: 'feature',
      siteId: downstreamSiteId,
      isMain: true,
      sourceBranchId: mainBranchId,
    });
    const sub = await createBranch({
      name: 'feature-sub',
      siteId: downstreamSiteId,
      sourceBranchId: feature,
    });

    const result = await getBranchLineage(sub);

    expect(result).toHaveLength(3);
    expect(result.map((branch) => branch.id)).toEqual([sub, feature, mainBranchId]);
  });
});
