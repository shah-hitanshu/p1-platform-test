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

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

const MINTED_ID = /-[0-9a-f]{8}-/;

interface Comp {
  type: string;
  props: { id: string; [key: string]: unknown };
}

function comp(type: string, id: string, extra: Record<string, unknown> = {}): Comp {
  return { type, props: { id, ...extra } };
}

interface MockVersionRow {
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
}

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

/** Params array of the query call that inserts into document_versions. */
function insertCallParams(queryMock: Mock): unknown[] {
  const call = queryMock.mock.calls.find(
    (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO app.document_versions'),
  );
  if (call === undefined) {
    throw new Error('No INSERT INTO app.document_versions call was captured');
  }
  return call[1] as unknown[];
}

function warnOutput(warnSpy: Mock): string {
  return JSON.stringify(warnSpy.mock.calls);
}

describe('createDocumentVersion within-document id uniqueness', () => {
  let warnSpy: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('re-mints later duplicates in content while the first occurrence keeps its id', async () => {
    const { createDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [versionRow({ version_number: 1 })] });

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

    const persisted = insertCallParams(queryMock)[2] as { content: Comp[] };
    expect(persisted.content).toHaveLength(2);
    expect(persisted.content[0].props.id).toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).not.toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).toMatch(MINTED_ID);
    expect(persisted.content[1].props.id).toMatch(/^HeroBlock-/);
  });

  it('preserves component order, types, and non-id props when re-minting a duplicate', async () => {
    const { createDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [versionRow()] });

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

    const persisted = insertCallParams(queryMock)[2] as { content: Comp[] };
    expect(persisted.content.map((c) => c.type)).toEqual(['HeroBlock', 'BodyBlock', 'HeroBlock']);
    expect(persisted.content[1].props.id).toBe('BodyBlock-keep');
    expect(persisted.content[2].props.title).toBe('Second');
    expect(persisted.content[2].props.background).toBe('light');
    expect(persisted.content[2].props.id).toMatch(MINTED_ID);
  });

  it('walks content before zones so a content occurrence keeps the id over a zones duplicate', async () => {
    const { createDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [versionRow()] });

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

    const persisted = insertCallParams(queryMock)[2] as {
      content: Comp[];
      zones: Record<string, Comp[]>;
    };
    expect(persisted.content[0].props.id).toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).not.toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).toMatch(MINTED_ID);
    expect(persisted.zones['root:main'][0].props.title).toBe('In zone');
  });

  it('re-mints later duplicates within a single zone array', async () => {
    const { createDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [versionRow()] });

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

    const persisted = insertCallParams(queryMock)[2] as { zones: Record<string, Comp[]> };
    const zone = persisted.zones['root:main'];
    expect(zone[0].props.id).toBe('CardBlock-dup');
    expect(zone[1].props.id).not.toBe('CardBlock-dup');
    expect(zone[1].props.id).toMatch(MINTED_ID);
    expect(zone[1].props.label).toBe('B');
  });

  it('logs a structured warning naming the document and the previous and new ids', async () => {
    const { createDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [versionRow()] });

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

    const newId = (insertCallParams(queryMock)[2] as { content: Comp[] }).content[1].props.id;
    expect(warnSpy).toHaveBeenCalled();
    const output = warnOutput(warnSpy);
    expect(output).toContain('doc-warned-999');
    expect(output).toContain('HeroBlock-dup');
    expect(output).toContain(newId);
  });

  it('applies the backstop regardless of the write source', async () => {
    const { createDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const sources: { source: DocumentVersionSource; createdByType: 'user' | 'agent' | 'system' }[] = [
      { source: 'edit', createdByType: 'user' },
      { source: 'merge', createdByType: 'user' },
      { source: 'migration', createdByType: 'system' },
      { source: 'realtime', createdByType: 'agent' },
    ];

    for (const { source, createdByType } of sources) {
      queryMock.mockReset();
      queryMock
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [versionRow({ source })] });

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

      const persisted = insertCallParams(queryMock)[2] as { content: Comp[] };
      expect(persisted.content[1].props.id).not.toBe('HeroBlock-dup');
      expect(persisted.content[1].props.id).toMatch(MINTED_ID);
    }
  });

  it('computes the forward patch from the deduped snapshot', async () => {
    const { createDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const previous = versionRow({
      version_number: 4,
      snapshot: { content: [comp('HeroBlock', 'HeroBlock-keep', { title: 'First' })] },
    });

    queryMock
      .mockResolvedValueOnce({ rows: [previous] })
      .mockResolvedValueOnce({ rows: [versionRow({ version_number: 5 })] });

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

    const params = insertCallParams(queryMock);
    const patchParam = params[3] as string;
    expect(patchParam).not.toBeNull();
    const patchText = typeof patchParam === 'string' ? patchParam : JSON.stringify(patchParam);
    expect(patchText).not.toContain('HeroBlock-keep-second');
    // The added element must carry the re-minted id, never a second HeroBlock-keep.
    const addedIdMatches = patchText.match(/HeroBlock-keep/g) ?? [];
    expect(addedIdMatches).toHaveLength(0);
    expect(patchText).toMatch(MINTED_ID);
  });

  it('persists a snapshot with unique ids unchanged and does not warn', async () => {
    const { createDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [versionRow()] });

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

    const persisted = insertCallParams(queryMock)[2];
    expect(persisted).toEqual(snapshot);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('batchSyncToPostgres within-document id uniqueness', () => {
  let warnSpy: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('re-mints later duplicates independently for each batched item', async () => {
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock.mockResolvedValue({ rows: [] });
    queryMock.mockResolvedValueOnce({
      rows: [
        versionRow({ id: 'v1', document_id: 'doc-001', source: 'realtime', version_number: 1 }),
        versionRow({ id: 'v2', document_id: 'doc-002', source: 'realtime', version_number: 1 }),
      ],
    });

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

    const snapshots = insertCallParams(queryMock)[2] as { content: Comp[] }[];
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
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock.mockResolvedValue({ rows: [] });
    queryMock.mockResolvedValueOnce({
      rows: [versionRow({ id: 'v1', document_id: 'doc-batch-777', source: 'realtime', version_number: 1 })],
    });

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

    const newId = (
      (insertCallParams(queryMock)[2] as { content: Comp[] }[])[0]
    ).content[1].props.id;
    expect(warnSpy).toHaveBeenCalled();
    const output = warnOutput(warnSpy);
    expect(output).toContain('doc-batch-777');
    expect(output).toContain('HeroBlock-dup');
    expect(output).toContain(newId);
  });

  it('persists batched snapshots with unique ids unchanged and does not warn', async () => {
    const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock.mockResolvedValue({ rows: [] });
    queryMock.mockResolvedValueOnce({
      rows: [versionRow({ id: 'v1', document_id: 'doc-001', source: 'realtime', version_number: 1 })],
    });

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

    const snapshots = insertCallParams(queryMock)[2] as Record<string, unknown>[];
    expect(snapshots[0]).toEqual(snapshot);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
