/**
 * Migration service on slot-id-keyed deltas.
 *
 * The template delta is derived from an id-keyed diff of the two template
 * version snapshots, and conflicts exist only where the template delta and
 * the document's own changes since its last migration touch the same slot
 * id. Document-local components never conflict with a template change.
 *
 * PROPOSAL-015 Design 5.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
}));

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersion: vi.fn(),
  createDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
}));

import { query } from '../../src/db';
import {
  getLatestDocumentVersion,
  createDocumentVersion,
  reconstructVersionSnapshot,
} from '../../src/services/document-version-service';
import {
  extractTemplateDelta,
  detectDocumentConflicts,
  applyDeltaToDocument,
  resolveMigrationConflict,
} from '../../src/services/migration-service';
import { buildSlotDelta } from '../../src/services/slot-delta';

const mockQuery = vi.mocked(query);
const mockGetLatest = vi.mocked(getLatestDocumentVersion);
const mockCreateVersion = vi.mocked(createDocumentVersion);
const mockReconstruct = vi.mocked(reconstructVersionSnapshot);

interface Comp {
  type: string;
  props: { id: string; [key: string]: unknown };
}

function comp(type: string, id: string, extra: Record<string, unknown> = {}): Comp {
  return { type, props: { id, ...extra } };
}

function snapshot(
  content: unknown[],
  zones: Record<string, unknown[]> = {},
  rootProps: Record<string, unknown> = {},
): Record<string, unknown> {
  return { content, zones, root: { props: rootProps } };
}

const HERO = comp('HeroBlock', 'HeroBlock-aaaa', { title: 'Hero' });
const BODY = comp('BodyBlock', 'BodyBlock-bbbb', { text: 'Body' });
const CTA = comp('CtaBlock', 'CtaBlock-cccc', { label: 'Go' });

const TEMPLATE_ID = 'tpl-1';
const DOC_ID = 'doc-1';
const BRANCH_ID = 'branch-1';
const PRINCIPAL = { id: 'user-1', type: 'user' as const };

describe('extractTemplateDelta', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('derives the structural delta from the version snapshots keyed by slot id', async () => {
    mockReconstruct.mockImplementation((_id, _branch, version) =>
      Promise.resolve(version === 1 ? snapshot([HERO]) : snapshot([HERO, BODY])),
    );
    // Stored editor actions contradicting the snapshots must not drive the delta.
    mockQuery.mockResolvedValue({
      rows: [{ action_metadata: { puckActions: [{ type: 'delete', sourceIndex: 0 }] } }],
      rowCount: 1,
    });

    const delta = await extractTemplateDelta(TEMPLATE_ID, BRANCH_ID, 1, 2);

    expect(delta.slotDelta.added).toHaveLength(1);
    expect(delta.slotDelta.added[0].component).toEqual(BODY);
    expect(delta.slotDelta.removed).toEqual([]);
    expect(delta.slotDelta.moved).toEqual([]);
  });

  it('extracts id-keyed prop patches alongside the structural delta', async () => {
    const heroV2 = comp('HeroBlock', 'HeroBlock-aaaa', { title: 'New hero' });
    mockReconstruct.mockImplementation((_id, _branch, version) =>
      Promise.resolve(version === 1 ? snapshot([HERO]) : snapshot([heroV2])),
    );
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const delta = await extractTemplateDelta(TEMPLATE_ID, BRANCH_ID, 1, 2);

    expect(delta.slotDelta.added).toEqual([]);
    expect(delta.propPatches).toHaveLength(1);
    expect(delta.propPatches[0].componentId).toBe('HeroBlock-aaaa');
  });

  it('detects structural changes inside zones', async () => {
    mockReconstruct.mockImplementation((_id, _branch, version) =>
      Promise.resolve(
        version === 1
          ? snapshot([HERO])
          : snapshot([HERO], { 'HeroBlock-aaaa:cta': [CTA] }),
      ),
    );
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const delta = await extractTemplateDelta(TEMPLATE_ID, BRANCH_ID, 1, 2);

    expect(delta.slotDelta.added).toHaveLength(1);
    expect(delta.slotDelta.added[0].placement.zone).toBe('HeroBlock-aaaa:cta');
  });

  it('yields an empty delta when the from-version predates the content shape', async () => {
    // A manifest-shaped from-version has no content to diff; migrating across
    // the content-shape conversion boundary is a representation change and
    // propagates nothing to bound pages.
    const manifest = {
      name: 'blog',
      label: 'Blog',
      components: [{ type: 'HeroBlock', pinned: true, defaultProps: { title: '' } }],
    };
    mockReconstruct.mockImplementation((_id, _branch, version) =>
      Promise.resolve(version === 1 ? manifest : snapshot([HERO, BODY])),
    );
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const delta = await extractTemplateDelta(TEMPLATE_ID, BRANCH_ID, 1, 2);

    expect(delta.slotDelta.added).toEqual([]);
    expect(delta.slotDelta.removed).toEqual([]);
    expect(delta.slotDelta.moved).toEqual([]);
    expect(delta.propPatches).toEqual([]);
  });
});

describe('detectDocumentConflicts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function primeBaseline(options: {
    lastMigrationVersion: number;
    earliestVersion?: number;
    baselineSnapshot: Record<string, unknown>;
  }): void {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("source = 'migration'")) {
        return Promise.resolve({
          rows: [{ version_number: options.lastMigrationVersion }],
          rowCount: 1,
        });
      }
      return Promise.resolve({
        rows: [{ version_number: options.earliestVersion ?? 1 }],
        rowCount: 1,
      });
    });
    mockReconstruct.mockResolvedValue(options.baselineSnapshot);
  }

  it('returns null when the document is unchanged since its baseline', async () => {
    const templateDelta = buildSlotDelta(snapshot([HERO]), snapshot([HERO, BODY]));
    const current = snapshot([HERO]);
    primeBaseline({ lastMigrationVersion: 3, baselineSnapshot: snapshot([HERO]) });

    const result = await detectDocumentConflicts(DOC_ID, BRANCH_ID, templateDelta, current);

    expect(result).toBeNull();
  });

  it('does not conflict when the document only changed local components', async () => {
    const templateDelta = buildSlotDelta(snapshot([HERO]), snapshot([HERO, BODY]));
    const local = comp('LocalBlock', 'LocalBlock-1111', {});
    primeBaseline({ lastMigrationVersion: 3, baselineSnapshot: snapshot([HERO]) });

    const result = await detectDocumentConflicts(
      DOC_ID, BRANCH_ID, templateDelta, snapshot([HERO, local]),
    );

    expect(result).not.toBeNull();
    expect(result?.hasConflict).toBe(false);
    expect(result?.documentDelta.added.map((a) => a.component.props.id)).toEqual([
      'LocalBlock-1111',
    ]);
  });

  it('conflicts when the document and the template touched the same slot id', async () => {
    const templateDelta = buildSlotDelta(snapshot([HERO, CTA]), snapshot([HERO]));
    primeBaseline({ lastMigrationVersion: 3, baselineSnapshot: snapshot([HERO, CTA]) });

    const result = await detectDocumentConflicts(
      DOC_ID, BRANCH_ID, templateDelta, snapshot([HERO]),
    );

    expect(result?.hasConflict).toBe(true);
  });

  it('does not conflict when the two sides touched different slot ids', async () => {
    const templateDelta = buildSlotDelta(snapshot([HERO, BODY]), snapshot([BODY, HERO]));
    primeBaseline({
      lastMigrationVersion: 3,
      baselineSnapshot: snapshot([HERO, BODY, CTA]),
    });

    const result = await detectDocumentConflicts(
      DOC_ID, BRANCH_ID, templateDelta, snapshot([HERO, BODY]),
    );

    expect(result?.hasConflict).toBe(false);
  });

  it('baselines a never-migrated document at its earliest version', async () => {
    const templateDelta = buildSlotDelta(snapshot([HERO]), snapshot([HERO, BODY]));
    primeBaseline({
      lastMigrationVersion: 0,
      earliestVersion: 1,
      baselineSnapshot: snapshot([HERO]),
    });

    await detectDocumentConflicts(DOC_ID, BRANCH_ID, templateDelta, snapshot([HERO]));

    expect(mockReconstruct).toHaveBeenCalledWith(DOC_ID, BRANCH_ID, 1);
  });

  it('baselines a migrated document at its last migration version', async () => {
    const templateDelta = buildSlotDelta(snapshot([HERO]), snapshot([HERO, BODY]));
    primeBaseline({ lastMigrationVersion: 5, baselineSnapshot: snapshot([HERO]) });

    await detectDocumentConflicts(DOC_ID, BRANCH_ID, templateDelta, snapshot([HERO]));

    expect(mockReconstruct).toHaveBeenCalledWith(DOC_ID, BRANCH_ID, 5);
  });

  it('detects prop conflicts on zone components', async () => {
    const templateDelta = buildSlotDelta(snapshot([HERO]), snapshot([HERO]));
    const docZoneCta = comp('CtaBlock', 'CtaBlock-cccc', { label: 'Diverged' });
    primeBaseline({
      lastMigrationVersion: 3,
      baselineSnapshot: snapshot([HERO], { 'HeroBlock-aaaa:cta': [docZoneCta] }),
    });

    const result = await detectDocumentConflicts(
      DOC_ID,
      BRANCH_ID,
      templateDelta,
      snapshot([HERO], { 'HeroBlock-aaaa:cta': [docZoneCta] }),
      {
        propPatches: [{
          componentId: 'CtaBlock-cccc',
          operations: [{ op: 'replace', path: '/label', value: 'New label' }],
        }],
        fromTemplateContent: [],
        fromZones: { 'HeroBlock-aaaa:cta': [CTA] },
      },
    );

    expect(result?.hasConflict).toBe(false);
    expect(result?.propConflicts).toHaveLength(1);
    expect(result?.propConflicts?.[0]).toMatchObject({
      componentId: 'CtaBlock-cccc',
      propPath: '/label',
      documentValue: 'Diverged',
      templateOldValue: 'Go',
      templateNewValue: 'New label',
    });
  });

  it('echoes both deltas in the conflict result', async () => {
    const templateDelta = buildSlotDelta(snapshot([HERO]), snapshot([HERO, BODY]));
    const local = comp('LocalBlock', 'LocalBlock-1111', {});
    primeBaseline({ lastMigrationVersion: 3, baselineSnapshot: snapshot([HERO]) });

    const result = await detectDocumentConflicts(
      DOC_ID, BRANCH_ID, templateDelta, snapshot([HERO, local]),
    );

    expect(result?.templateDelta).toBe(templateDelta);
    expect(result?.documentDelta.added).toHaveLength(1);
  });
});

describe('applyDeltaToDocument', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('applies the slot delta and persists a migration-sourced version', async () => {
    const delta = buildSlotDelta(snapshot([HERO]), snapshot([HERO, BODY]));
    mockGetLatest.mockResolvedValue({
      id: 'v-1',
      versionNumber: 4,
      snapshot: snapshot([HERO]),
    } as never);
    mockCreateVersion.mockResolvedValue({ id: 'v-2' } as never);

    const result = await applyDeltaToDocument(DOC_ID, BRANCH_ID, delta, PRINCIPAL);

    expect(result.versionId).toBe('v-2');
    const persisted = mockCreateVersion.mock.calls[0][0];
    expect(persisted.source).toBe('migration');
    const content = (persisted.snapshot as { content: Comp[] }).content;
    expect(content.map((c) => c.props.id)).toEqual(['HeroBlock-aaaa', 'BodyBlock-bbbb']);
    expect(content[1].props.text).toBe('Body');
  });

  it('records the migration action with the touched slot ids', async () => {
    const delta = buildSlotDelta(snapshot([HERO, CTA]), snapshot([HERO, BODY]));
    mockGetLatest.mockResolvedValue({
      id: 'v-1',
      versionNumber: 4,
      snapshot: snapshot([HERO, CTA]),
    } as never);
    mockCreateVersion.mockResolvedValue({ id: 'v-2' } as never);

    await applyDeltaToDocument(DOC_ID, BRANCH_ID, delta, PRINCIPAL);

    const persisted = mockCreateVersion.mock.calls[0][0];
    expect(persisted.puckActions).toEqual([
      expect.objectContaining({
        type: 'migration',
        addedIds: ['BodyBlock-bbbb'],
        removedIds: ['CtaBlock-cccc'],
        movedIds: [],
      }),
    ]);
  });

  it('applies prop patches with the three-way merge during migration', async () => {
    const heroOld = comp('HeroBlock', 'HeroBlock-aaaa', { title: 'Old' });
    const delta = buildSlotDelta(snapshot([heroOld]), snapshot([heroOld]));
    mockGetLatest.mockResolvedValue({
      id: 'v-1',
      versionNumber: 4,
      snapshot: snapshot([heroOld]),
    } as never);
    mockCreateVersion.mockResolvedValue({ id: 'v-2' } as never);

    await applyDeltaToDocument(DOC_ID, BRANCH_ID, delta, PRINCIPAL, {
      propPatches: [{
        componentId: 'HeroBlock-aaaa',
        operations: [{ op: 'replace', path: '/title', value: 'New' }],
      }],
      fromTemplateContent: [heroOld],
    });

    const persisted = mockCreateVersion.mock.calls[0][0];
    const content = (persisted.snapshot as { content: Comp[] }).content;
    expect(content[0].props.title).toBe('New');
  });
});

describe('resolveMigrationConflict', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const conflictRow = (
    templateDelta: unknown,
    opts: { conflictType?: string; propConflicts?: unknown[] } = {},
  ): Record<string, unknown> => ({
    id: 'conflict-1',
    migration_job_id: 'job-1',
    document_id: DOC_ID,
    branch_id: BRANCH_ID,
    template_id: TEMPLATE_ID,
    from_version: 1,
    to_version: 2,
    template_delta: templateDelta,
    document_actions: { added: [], removed: [], moved: [], templateIds: [] },
    prop_conflicts: opts.propConflicts ?? [],
    conflict_type: opts.conflictType ?? 'structural',
    resolution: null,
    created_at: '2026-07-01T00:00:00Z',
    resolved_at: null,
  });

  it('re-applies a stored slot delta when resolved with apply', async () => {
    const delta = buildSlotDelta(snapshot([HERO]), snapshot([HERO, BODY]));
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: [conflictRow(delta)], rowCount: 1 });
      }
      return Promise.resolve({
        rows: [{ ...conflictRow(delta), resolution: 'apply', resolved_at: '2026-07-01T00:00:00Z' }],
        rowCount: 1,
      });
    });
    mockGetLatest.mockResolvedValue({
      id: 'v-1',
      versionNumber: 4,
      snapshot: snapshot([HERO]),
    } as never);
    mockCreateVersion.mockResolvedValue({ id: 'v-2' } as never);

    const resolved = await resolveMigrationConflict('conflict-1', 'apply', PRINCIPAL);

    expect(resolved.resolution).toBe('apply');
    const persisted = mockCreateVersion.mock.calls[0][0];
    const content = (persisted.snapshot as { content: Comp[] }).content;
    expect(content.map((c) => c.props.id)).toEqual(['HeroBlock-aaaa', 'BodyBlock-bbbb']);
  });

  it('applies the migration prop patches alongside the stored structural delta', async () => {
    const ctaOld = comp('CtaBlock', 'CtaBlock-cccc', { label: 'Go' });
    const ctaNew = comp('CtaBlock', 'CtaBlock-cccc', { label: 'New label' });
    const delta = buildSlotDelta(snapshot([HERO, ctaOld]), snapshot([HERO, ctaNew]));
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: [conflictRow(delta)], rowCount: 1 });
      }
      return Promise.resolve({
        rows: [{ ...conflictRow(delta), resolution: 'apply', resolved_at: '2026-07-01T00:00:00Z' }],
        rowCount: 1,
      });
    });
    mockReconstruct.mockImplementation((documentId, _branch, version) => {
      if (documentId === TEMPLATE_ID) {
        return Promise.resolve(version === 1 ? snapshot([HERO, ctaOld]) : snapshot([HERO, ctaNew]));
      }
      return Promise.resolve(null);
    });
    mockGetLatest.mockResolvedValue({
      id: 'v-1',
      versionNumber: 4,
      snapshot: snapshot([HERO, ctaOld]),
    } as never);
    mockCreateVersion.mockResolvedValue({ id: 'v-2' } as never);

    await resolveMigrationConflict('conflict-1', 'apply', PRINCIPAL);

    const persisted = mockCreateVersion.mock.calls[0][0];
    const content = (persisted.snapshot as { content: Comp[] }).content;
    const cta = content.find((c) => c.props.id === 'CtaBlock-cccc');
    expect(cta?.props.label).toBe('New label');
  });

  const propConflictRow = (): Record<string, unknown> => conflictRow(
    { added: [], removed: [], moved: [], templateIds: [] },
    {
      conflictType: 'prop',
      propConflicts: [{
        componentId: 'CtaBlock-cccc',
        propPath: '/label',
        templateOldValue: 'Go',
        templateNewValue: 'New label',
        documentValue: 'Customized',
      }],
    },
  );

  it('sets the diverged prop to the template value when a prop conflict is applied', async () => {
    const ctaDiverged = comp('CtaBlock', 'CtaBlock-cccc', { label: 'Customized' });
    const row = propConflictRow();
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: [row], rowCount: 1 });
      }
      return Promise.resolve({
        rows: [{ ...row, resolution: 'apply', resolved_at: '2026-07-01T00:00:00Z' }],
        rowCount: 1,
      });
    });
    mockGetLatest.mockResolvedValue({
      id: 'v-1',
      versionNumber: 4,
      snapshot: snapshot([HERO, ctaDiverged]),
    } as never);
    mockCreateVersion.mockResolvedValue({ id: 'v-2' } as never);

    await resolveMigrationConflict('conflict-1', 'apply', PRINCIPAL);

    const persisted = mockCreateVersion.mock.calls[0][0];
    const content = (persisted.snapshot as { content: Comp[] }).content;
    const cta = content.find((c) => c.props.id === 'CtaBlock-cccc');
    expect(cta?.props.label).toBe('New label');
  });

  it('keeps the local value and writes no version when a prop conflict is skipped', async () => {
    const ctaDiverged = comp('CtaBlock', 'CtaBlock-cccc', { label: 'Customized' });
    const row = propConflictRow();
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: [row], rowCount: 1 });
      }
      return Promise.resolve({
        rows: [{ ...row, resolution: 'skip', resolved_at: '2026-07-01T00:00:00Z' }],
        rowCount: 1,
      });
    });
    mockGetLatest.mockResolvedValue({
      id: 'v-1',
      versionNumber: 4,
      snapshot: snapshot([HERO, ctaDiverged]),
    } as never);

    const resolved = await resolveMigrationConflict('conflict-1', 'skip', PRINCIPAL);

    expect(resolved.resolution).toBe('skip');
    expect(mockCreateVersion).not.toHaveBeenCalled();
  });

  it('rejects applying a conflict stored with a legacy action-array payload', async () => {
    mockQuery.mockResolvedValue({
      rows: [conflictRow([{ type: 'insert', componentType: 'BodyBlock', destinationIndex: 1 }])],
      rowCount: 1,
    });

    await expect(
      resolveMigrationConflict('conflict-1', 'apply', PRINCIPAL),
    ).rejects.toThrow(/legacy/i);
  });

  it('records skip resolutions without touching the document', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({
          rows: [conflictRow([{ type: 'insert' }])],
          rowCount: 1,
        });
      }
      return Promise.resolve({
        rows: [{
          ...conflictRow([{ type: 'insert' }]),
          resolution: 'skip',
          resolved_at: '2026-07-01T00:00:00Z',
        }],
        rowCount: 1,
      });
    });

    const resolved = await resolveMigrationConflict('conflict-1', 'skip', PRINCIPAL);

    expect(resolved.resolution).toBe('skip');
    expect(mockCreateVersion).not.toHaveBeenCalled();
  });
});
