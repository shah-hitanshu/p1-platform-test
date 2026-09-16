/**
 * Within-document props.id uniqueness backstop at the version-write path.
 *
 * A content-originating write of a Puck snapshot enforces that every component
 * props.id is unique within the document. The first occurrence in walk order
 * (content[] in index order, then zones arrays) keeps its id; every later
 * duplicate is re-minted to `${type}-${uuid}`. A structured warning fires
 * because a duplicate reaching the database means an upstream boundary missed
 * re-minting. Snapshots with no duplicates persist unchanged with no warning.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentVersions } from '../../src/db/schema';

import {
  batchSyncToPostgres,
  createDocumentVersion,
} from '../../src/services/document-version-service';

const MINTED_ID = /-[0-9a-f]{8}-/;

interface Comp {
  type: string;
  props: { id: string; [key: string]: unknown };
}

function comp(type: string, id: string, extra: Record<string, unknown> = {}): Comp {
  return { type, props: { id, ...extra } };
}

type MockVersionRow = {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  snapshot: Record<string, unknown> | null;
  source: DocumentVersionSource;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
  patch?: unknown[] | null;
  action_type?: string | null;
  action_metadata?: Record<string, unknown> | null;
};

function versionRow(overrides: Partial<MockVersionRow> = {}): MockVersionRow {
  return {
    id: 'version-uuid-123',
    document_id: 'doc-uuid-456',
    branch_id: 'branch-uuid-789',
    version_number: 1,
    snapshot: { content: [] },
    source: 'edit',
    created_by_id: 'user-uuid-001',
    created_by_type: 'user',
    created_at: '2026-07-07T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * The values the version insert binds, in the order its SELECT list names them:
 * document, branch, snapshot, patch, and so on. The version number is computed
 * in the statement rather than bound, so it holds no place in this list.
 */
function insertedValues(database: DatabaseStub): unknown[] {
  const [insert] = database.calls(documentVersions).insert;
  if (insert === undefined) {
    throw new Error('No insert into app.document_versions was captured');
  }
  const selectAt = insert.sql.indexOf('SELECT', insert.sql.indexOf('INSERT INTO'));
  return [...insert.sql.slice(selectAt).matchAll(/\$(\d+)/g)].map(
    (placeholder) => insert.params[Number(placeholder[1]) - 1],
  );
}

/** The snapshot the version insert wrote, which reaches it as JSON text. */
function persistedSnapshot(database: DatabaseStub): {
  content: Comp[];
  zones: Record<string, Comp[]>;
} {
  return JSON.parse(insertedValues(database)[2] as string) as {
    content: Comp[];
    zones: Record<string, Comp[]>;
  };
}

function warnOutput(warnSpy: Mock): string {
  return JSON.stringify(warnSpy.mock.calls);
}

describe('createDocumentVersion within-document id uniqueness', () => {
  let database: DatabaseStub;
  let warnSpy: Mock;

  beforeEach(() => {
    vi.restoreAllMocks();
    database = stubDatabase();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('re-mints later duplicates in content while the first occurrence keeps its id', async () => {
    database.on(documentVersions).insert.returnsRaw([versionRow({ version_number: 1 })]);

    await createDocumentVersion({
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      snapshot: {
        content: [
          comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
          comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
        ],
      },
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = persistedSnapshot(database);
    expect(persisted.content).toHaveLength(2);
    expect(persisted.content[0].props.id).toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).not.toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).toMatch(MINTED_ID);
    expect(persisted.content[1].props.id).toMatch(/^HeroBlock-/);
  });

  it('preserves component order, types, and non-id props when re-minting a duplicate', async () => {
    database.on(documentVersions).insert.returnsRaw([versionRow()]);

    await createDocumentVersion({
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      snapshot: {
        content: [
          comp('HeroBlock', 'HeroBlock-dup', { title: 'First', background: 'dark' }),
          comp('BodyBlock', 'BodyBlock-keep', { text: 'body' }),
          comp('HeroBlock', 'HeroBlock-dup', { title: 'Second', background: 'light' }),
        ],
      },
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = persistedSnapshot(database);
    expect(persisted.content.map((c) => c.type)).toEqual(['HeroBlock', 'BodyBlock', 'HeroBlock']);
    expect(persisted.content[1].props.id).toBe('BodyBlock-keep');
    expect(persisted.content[2].props.title).toBe('Second');
    expect(persisted.content[2].props.background).toBe('light');
    expect(persisted.content[2].props.id).toMatch(MINTED_ID);
  });

  it('walks content before zones so a content occurrence keeps the id over a zones duplicate', async () => {
    database.on(documentVersions).insert.returnsRaw([versionRow()]);

    await createDocumentVersion({
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      snapshot: {
        content: [comp('HeroBlock', 'shared-slot', { title: 'In content' })],
        zones: {
          'root:main': [comp('HeroBlock', 'shared-slot', { title: 'In zone' })],
        },
      },
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = persistedSnapshot(database);
    expect(persisted.content[0].props.id).toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).not.toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).toMatch(MINTED_ID);
    expect(persisted.zones['root:main'][0].props.title).toBe('In zone');
  });

  it('re-mints later duplicates within a single zone array', async () => {
    database.on(documentVersions).insert.returnsRaw([versionRow()]);

    await createDocumentVersion({
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      snapshot: {
        content: [],
        zones: {
          'root:main': [
            comp('CardBlock', 'CardBlock-dup', { label: 'A' }),
            comp('CardBlock', 'CardBlock-dup', { label: 'B' }),
          ],
        },
      },
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = persistedSnapshot(database);
    const zone = persisted.zones['root:main'];
    expect(zone[0].props.id).toBe('CardBlock-dup');
    expect(zone[1].props.id).not.toBe('CardBlock-dup');
    expect(zone[1].props.id).toMatch(MINTED_ID);
    expect(zone[1].props.label).toBe('B');
  });

  it('logs a structured warning naming the document and the previous and new ids', async () => {
    database.on(documentVersions).insert.returnsRaw([versionRow()]);

    await createDocumentVersion({
      documentId: 'doc-warned-999',
      branchId: 'branch-uuid-789',
      snapshot: {
        content: [
          comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
          comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
        ],
      },
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const newId = persistedSnapshot(database).content[1].props.id;
    expect(warnSpy).toHaveBeenCalled();
    const output = warnOutput(warnSpy);
    expect(output).toContain('doc-warned-999');
    expect(output).toContain('HeroBlock-dup');
    expect(output).toContain(newId);
  });

  it('applies the backstop regardless of the write source', async () => {
    const sources: { source: DocumentVersionSource; createdByType: 'user' | 'agent' | 'system' }[] = [
      { source: 'edit', createdByType: 'user' },
      { source: 'merge', createdByType: 'user' },
      { source: 'migration', createdByType: 'system' },
      { source: 'realtime', createdByType: 'agent' },
    ];

    for (const { source, createdByType } of sources) {
      database = stubDatabase();
      database.on(documentVersions).insert.returnsRaw([versionRow({ source })]);

      await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: {
          content: [
            comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
            comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
          ],
        },
        source,
        createdById: 'actor-1',
        createdByType,
      });

      const persisted = persistedSnapshot(database);
      expect(persisted.content[1].props.id).not.toBe('HeroBlock-dup');
      expect(persisted.content[1].props.id).toMatch(MINTED_ID);
    }
  });

  it('computes the forward patch from the deduped snapshot', async () => {
    const previous = versionRow({
      version_number: 4,
      snapshot: { content: [comp('HeroBlock', 'HeroBlock-keep', { title: 'First' })] },
    });

    database.on(documentVersions).select.returnsRaw([previous]);
    database.on(documentVersions).insert.returnsRaw([versionRow({ version_number: 5 })]);

    await createDocumentVersion({
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      snapshot: {
        content: [
          comp('HeroBlock', 'HeroBlock-keep', { title: 'First' }),
          comp('HeroBlock', 'HeroBlock-keep', { title: 'Second' }),
        ],
      },
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const patchText = insertedValues(database)[3] as string;
    expect(patchText).not.toBeNull();
    expect(patchText).not.toContain('HeroBlock-keep-second');
    // The added element must carry the re-minted id, never a second HeroBlock-keep.
    const addedIdMatches = patchText.match(/HeroBlock-keep/g) ?? [];
    expect(addedIdMatches).toHaveLength(0);
    expect(patchText).toMatch(MINTED_ID);
  });

  it('persists a snapshot with unique ids unchanged and does not warn', async () => {
    database.on(documentVersions).insert.returnsRaw([versionRow()]);

    const snapshot = {
      content: [
        comp('HeroBlock', 'HeroBlock-a', { title: 'A' }),
        comp('BodyBlock', 'BodyBlock-b', { text: 'B' }),
      ],
      zones: {
        'root:main': [comp('CardBlock', 'CardBlock-c', { label: 'C' })],
      },
    };

    await createDocumentVersion({
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      snapshot: structuredClone(snapshot),
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = persistedSnapshot(database);
    expect(persisted).toEqual(snapshot);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('batchSyncToPostgres within-document id uniqueness', () => {
  let warnSpy: Mock;
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  /**
   * The batch INSERT's jsonb[] snapshot bind (params[2]), parsed back from the
   * JSON strings it binds each element as.
   */
  function insertedSnapshots(): Record<string, unknown>[] {
    const call = database.calls(documentVersions).insert[0];
    if (call === undefined) {
      throw new Error('No batch INSERT into document_versions was captured');
    }
    const snapshotsJson = call.params[2] as string[];
    return snapshotsJson.map((json) => JSON.parse(json) as Record<string, unknown>);
  }

  it('re-mints later duplicates independently for each batched item', async () => {

    database.on(documentVersions).insert.returnsRaw([
      versionRow({ id: 'v1', document_id: 'doc-001', source: 'realtime', version_number: 1 }),
      versionRow({ id: 'v2', document_id: 'doc-002', source: 'realtime', version_number: 1 }),
    ]);

    await batchSyncToPostgres([
      {
        documentId: 'doc-001',
        branchId: 'branch-001',
        snapshot: {
          content: [
            comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
            comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
          ],
        },
        actorId: 'user-001',
        actorType: 'user',
      },
      {
        documentId: 'doc-002',
        branchId: 'branch-001',
        snapshot: {
          content: [
            comp('BodyBlock', 'BodyBlock-dup', { text: 'One' }),
            comp('BodyBlock', 'BodyBlock-dup', { text: 'Two' }),
          ],
        },
        actorId: 'agent-001',
        actorType: 'agent',
      },
    ]);

    const snapshots = insertedSnapshots() as { content: Comp[] }[];
    expect(snapshots).toHaveLength(2);

    expect(snapshots[0].content[0].props.id).toBe('HeroBlock-dup');
    expect(snapshots[0].content[1].props.id).not.toBe('HeroBlock-dup');
    expect(snapshots[0].content[1].props.id).toMatch(MINTED_ID);
    expect(snapshots[0].content[1].props.title).toBe('Second');

    expect(snapshots[1].content[0].props.id).toBe('BodyBlock-dup');
    expect(snapshots[1].content[1].props.id).not.toBe('BodyBlock-dup');
    expect(snapshots[1].content[1].props.id).toMatch(MINTED_ID);
    expect(snapshots[1].content[1].props.text).toBe('Two');
  });

  it('logs a structured warning naming each affected document and its id pairs', async () => {

    database.on(documentVersions).insert.returnsRaw([
      versionRow({ id: 'v1', document_id: 'doc-batch-777', source: 'realtime', version_number: 1 }),
    ]);

    await batchSyncToPostgres([
      {
        documentId: 'doc-batch-777',
        branchId: 'branch-001',
        snapshot: {
          content: [
            comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
            comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
          ],
        },
        actorId: 'user-001',
        actorType: 'user',
      },
    ]);

    const newId = (insertedSnapshots()[0] as { content: Comp[] }).content[1].props.id;
    expect(warnSpy).toHaveBeenCalled();
    const output = warnOutput(warnSpy);
    expect(output).toContain('doc-batch-777');
    expect(output).toContain('HeroBlock-dup');
    expect(output).toContain(newId);
  });

  it('persists batched snapshots with unique ids unchanged and does not warn', async () => {

    database.on(documentVersions).insert.returnsRaw([
      versionRow({ id: 'v1', document_id: 'doc-001', source: 'realtime', version_number: 1 }),
    ]);

    const snapshot = {
      content: [
        comp('HeroBlock', 'HeroBlock-a', { title: 'A' }),
        comp('BodyBlock', 'BodyBlock-b', { text: 'B' }),
      ],
    };

    await batchSyncToPostgres([
      {
        documentId: 'doc-001',
        branchId: 'branch-001',
        snapshot: structuredClone(snapshot),
        actorId: 'user-001',
        actorType: 'user',
      },
    ]);

    const snapshots = insertedSnapshots();
    expect(snapshots[0]).toEqual(snapshot);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
