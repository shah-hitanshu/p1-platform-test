/**
 * Within-document props.id uniqueness backstop at the initial document write.
 *
 * createDocumentOnBranch writes version 1 of a document. Its snapshot must
 * carry unique component props.id values: the first occurrence in walk order
 * (content[] then zones arrays) keeps its id; later duplicates are re-minted to
 * `${type}-${uuid}` and a structured warning fires. A snapshot with no
 * duplicates is persisted unchanged with no warning.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

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

function docRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-uuid-456',
    site_id: 'site-uuid-123',
    path: 'pages/new',
    created_at: '2026-07-07T10:00:00.000Z',
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
 * Mock the happy-path transaction: BEGIN, INSERT document, SAVEPOINT,
 * INSERT version, RELEASE SAVEPOINT, COMMIT.
 */
function mockHappyPathTransaction(queryMock: Mock): void {
  queryMock
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [docRow()] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [versionRow()] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
}

/** Params array of the query call that inserts into document_versions. */
function insertVersionParams(queryMock: Mock): unknown[] {
  const call = queryMock.mock.calls.find(
    (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO app.document_versions'),
  );
  if (call === undefined) {
    throw new Error('No INSERT INTO app.document_versions call was captured');
  }
  return call[1] as unknown[];
}

describe('createDocumentOnBranch within-document id uniqueness', () => {
  let warnSpy: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('re-mints later duplicates in content while the first occurrence keeps its id', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);
    mockHappyPathTransaction(queryMock);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/new',
      snapshot: {
        content: [
          comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
          comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
        ],
      },
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = insertVersionParams(queryMock)[2] as { content: Comp[] };
    expect(persisted.content).toHaveLength(2);
    expect(persisted.content[0].props.id).toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).not.toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).toMatch(MINTED_ID);
    expect(persisted.content[1].props.id).toMatch(/^HeroBlock-/);
    expect(persisted.content[1].props.title).toBe('Second');
  });

  it('preserves component order and types when re-minting a duplicate', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);
    mockHappyPathTransaction(queryMock);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/new',
      snapshot: {
        content: [
          comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
          comp('BodyBlock', 'BodyBlock-keep', { text: 'body' }),
          comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
        ],
      },
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = insertVersionParams(queryMock)[2] as { content: Comp[] };
    expect(persisted.content.map((c) => c.type)).toEqual(['HeroBlock', 'BodyBlock', 'HeroBlock']);
    expect(persisted.content[1].props.id).toBe('BodyBlock-keep');
    expect(persisted.content[2].props.id).toMatch(MINTED_ID);
  });

  it('walks content before zones so a content occurrence keeps the id over a zones duplicate', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);
    mockHappyPathTransaction(queryMock);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/new',
      snapshot: {
        content: [comp('HeroBlock', 'shared-slot', { title: 'In content' })],
        zones: {
          'root:main': [comp('HeroBlock', 'shared-slot', { title: 'In zone' })],
        },
      },
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = insertVersionParams(queryMock)[2] as {
      content: Comp[];
      zones: Record<string, Comp[]>;
    };
    expect(persisted.content[0].props.id).toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).not.toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).toMatch(MINTED_ID);
  });

  it('logs a structured warning naming the document and the previous and new ids', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [docRow({ id: 'doc-warned-555' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [versionRow({ document_id: 'doc-warned-555' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/new',
      snapshot: {
        content: [
          comp('HeroBlock', 'HeroBlock-dup', { title: 'First' }),
          comp('HeroBlock', 'HeroBlock-dup', { title: 'Second' }),
        ],
      },
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const newId = (insertVersionParams(queryMock)[2] as { content: Comp[] }).content[1].props.id;
    expect(warnSpy).toHaveBeenCalled();
    const output = JSON.stringify(warnSpy.mock.calls);
    expect(output).toContain('doc-warned-555');
    expect(output).toContain('HeroBlock-dup');
    expect(output).toContain(newId);
  });

  it('persists a snapshot with unique ids unchanged and does not warn', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);
    mockHappyPathTransaction(queryMock);

    const snapshot = {
      content: [
        comp('HeroBlock', 'HeroBlock-a', { title: 'A' }),
        comp('BodyBlock', 'BodyBlock-b', { text: 'B' }),
      ],
      zones: {
        'root:main': [comp('CardBlock', 'CardBlock-c', { label: 'C' })],
      },
    };

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/new',
      snapshot: structuredClone(snapshot),
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const persisted = insertVersionParams(queryMock)[2];
    expect(persisted).toEqual(snapshot);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
