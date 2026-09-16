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
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documents, documentVersions } from '../../src/db/schema';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';

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
 * The snapshot the version insert wrote. It reaches the statement as JSON text,
 * so the assertions parse it back: the Drizzle client serializes json as
 * identity, and an object bound to a jsonb parameter would arrive as
 * `[object Object]`.
 */
function persistedSnapshot(stub: DatabaseStub): { content: Comp[]; zones: Record<string, Comp[]> } {
  const [insert] = stub.calls(documentVersions).insert;
  if (insert === undefined) {
    throw new Error('No insert into app.document_versions was captured');
  }
  return JSON.parse(insert.params[2] as string) as {
    content: Comp[];
    zones: Record<string, Comp[]>;
  };
}

describe('createDocumentOnBranch within-document id uniqueness', () => {
  let stub: DatabaseStub;
  let warnSpy: Mock;

  beforeEach(() => {
    vi.restoreAllMocks();
    stub = stubDatabase();
    stub.on(documents).insert.returnsRaw([docRow()]);
    stub.on(documentVersions).insert.returnsRaw([versionRow()]);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('re-mints later duplicates in content while the first occurrence keeps its id', async () => {
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

    const persisted = persistedSnapshot(stub);
    expect(persisted.content).toHaveLength(2);
    expect(persisted.content[0].props.id).toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).not.toBe('HeroBlock-dup');
    expect(persisted.content[1].props.id).toMatch(MINTED_ID);
    expect(persisted.content[1].props.id).toMatch(/^HeroBlock-/);
    expect(persisted.content[1].props.title).toBe('Second');
  });

  it('preserves component order and types when re-minting a duplicate', async () => {
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

    const persisted = persistedSnapshot(stub);
    expect(persisted.content.map((c) => c.type)).toEqual(['HeroBlock', 'BodyBlock', 'HeroBlock']);
    expect(persisted.content[1].props.id).toBe('BodyBlock-keep');
    expect(persisted.content[2].props.id).toMatch(MINTED_ID);
  });

  it('walks content before zones so a content occurrence keeps the id over a zones duplicate', async () => {
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

    const persisted = persistedSnapshot(stub);
    expect(persisted.content[0].props.id).toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).not.toBe('shared-slot');
    expect(persisted.zones['root:main'][0].props.id).toMatch(MINTED_ID);
  });

  it('logs a structured warning naming the document and the previous and new ids', async () => {
    stub.on(documents).insert.returnsRaw([docRow({ id: 'doc-warned-555' })]);
    stub.on(documentVersions).insert.returnsRaw([versionRow({ document_id: 'doc-warned-555' })]);

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

    const newId = persistedSnapshot(stub).content[1].props.id;
    expect(warnSpy).toHaveBeenCalled();
    const output = JSON.stringify(warnSpy.mock.calls);
    expect(output).toContain('doc-warned-555');
    expect(output).toContain('HeroBlock-dup');
    expect(output).toContain(newId);
  });

  it('persists a snapshot with unique ids unchanged and does not warn', async () => {
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

    expect(persistedSnapshot(stub)).toEqual(snapshot);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
