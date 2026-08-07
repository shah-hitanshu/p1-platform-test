/**
 * Root-prop migration: nested paths, add/remove, and divergence reporting.
 *
 * The applier used to handle `__root__` with its own inlined loop that only
 * understood top-level keys. Page metadata lives at `root.props._meta`, which is
 * the first object-valued inheritable root prop, so every nested case below is
 * reachable from a template that carries metadata defaults.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSlotDelta } from '../../src/services/slot-delta';

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
  reconstructVersionSnapshot: vi.fn().mockResolvedValue({ content: [] }),
}));

vi.mock('@pantheon-systems/p1-content-validator', () => ({
  validateDocumentStructure: vi.fn(),
}));

const rootProps = (result: Record<string, unknown>): Record<string, unknown> =>
  (result.root as { props: Record<string, unknown> }).props;

const noStructuralChange = (
  snapshot: Record<string, unknown>,
): ReturnType<typeof buildSlotDelta> => buildSlotDelta(snapshot, snapshot);

describe('root prop patches: nested paths', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('applies a nested replace to the nested value, not a flat key', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = {
      content: [],
      root: { props: { title: 'Launch', _meta: { ogTitle: 'Old social title' } } },
    };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [
            { op: 'replace' as const, path: '/_meta/ogTitle', value: 'New social title' },
          ],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: { title: 'Launch', _meta: { ogTitle: 'Old social title' } },
    });

    expect(rootProps(result)._meta).toEqual({ ogTitle: 'New social title' });
    expect(Object.keys(rootProps(result))).not.toContain('_meta/ogTitle');
  });

  it('leaves a locally edited nested value alone', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = {
      content: [],
      root: { props: { _meta: { ogTitle: 'Editor wrote this' } } },
    };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [
            { op: 'replace' as const, path: '/_meta/ogTitle', value: 'New template default' },
          ],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: { _meta: { ogTitle: 'Old template default' } },
    });

    expect(rootProps(result)._meta).toEqual({ ogTitle: 'Editor wrote this' });
  });

  it('adds a newly defined field', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = {
      content: [],
      root: { props: { _meta: { ogTitle: '' } } },
    };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [{ op: 'add' as const, path: '/_meta/author', value: 'Newsroom' }],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: { _meta: { ogTitle: '' } },
    });

    expect(rootProps(result)._meta).toEqual({ ogTitle: '', author: 'Newsroom' });
  });

  it('adds a nested field to a page that has no _meta yet', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = { content: [], root: { props: { title: 'Launch' } } };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [{ op: 'add' as const, path: '/_meta/author', value: 'Newsroom' }],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: { title: 'Launch' },
    });

    expect(rootProps(result)._meta).toEqual({ author: 'Newsroom' });
  });

  it('removes a field the template dropped', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = {
      content: [],
      root: { props: { _meta: { ogTitle: 'Shared', author: 'Newsroom' } } },
    };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [{ op: 'remove' as const, path: '/_meta/author' }],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: { _meta: { ogTitle: 'Shared', author: 'Newsroom' } },
    });

    expect(rootProps(result)._meta).toEqual({ ogTitle: 'Shared' });
  });

  it('keeps a locally edited field the template dropped', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = {
      content: [],
      root: { props: { _meta: { author: 'Editor override' } } },
    };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [{ op: 'remove' as const, path: '/_meta/author' }],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: { _meta: { author: 'Newsroom' } },
    });

    expect(rootProps(result)._meta).toEqual({ author: 'Editor override' });
  });

  it('leaves a snapshot with no root props untouched', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = { content: [] };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [{ op: 'add' as const, path: '/_meta/author', value: 'Newsroom' }],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: {},
    });

    expect(result.root).toBeUndefined();
  });

  it('still applies a top-level root prop', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = { content: [], root: { props: { title: 'Old' } } };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [{ op: 'replace' as const, path: '/title', value: 'New' }],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: { title: 'Old' },
    });

    expect(rootProps(result).title).toBe('New');
  });
});

describe('root prop patches: divergence reporting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reports a diverged root prop as a conflict instead of skipping it', async () => {
    const { detectDocumentConflicts } = await import('../../src/services/migration-service');
    const db = await import('../../src/db');
    const { reconstructVersionSnapshot } = await import('../../src/services/document-version-service');

    const documentSnapshot = {
      content: [],
      root: { props: { _meta: { ogTitle: 'Editor wrote this' } } },
    };

    // Baseline equals the document, so there is no structural change to report.
    vi.mocked(db.query).mockResolvedValue({ rows: [{ version_number: 3 }], rowCount: 1 });
    vi.mocked(reconstructVersionSnapshot).mockResolvedValue(documentSnapshot);

    const result = await detectDocumentConflicts(
      'doc-1',
      'branch-1',
      buildSlotDelta({ content: [] }, { content: [] }),
      documentSnapshot,
      {
        propPatches: [
          {
            componentId: '__root__',
            operations: [
              { op: 'replace' as const, path: '/_meta/ogTitle', value: 'New template default' },
            ],
          },
        ],
        fromTemplateContent: [],
        fromRootProps: { _meta: { ogTitle: 'Old template default' } },
      },
    );

    expect(result?.propConflicts).toHaveLength(1);
    expect(result?.propConflicts?.[0]).toEqual(expect.objectContaining({
      componentId: '__root__',
      propPath: '/_meta/ogTitle',
      documentValue: 'Editor wrote this',
      templateOldValue: 'Old template default',
      templateNewValue: 'New template default',
    }));
  });

  it('reports no conflict when the root prop still matches the template', async () => {
    const { detectDocumentConflicts } = await import('../../src/services/migration-service');
    const db = await import('../../src/db');
    const { reconstructVersionSnapshot } = await import('../../src/services/document-version-service');

    const documentSnapshot = {
      content: [],
      root: { props: { _meta: { ogTitle: 'Old template default' } } },
    };

    vi.mocked(db.query).mockResolvedValue({ rows: [{ version_number: 3 }], rowCount: 1 });
    vi.mocked(reconstructVersionSnapshot).mockResolvedValue(documentSnapshot);

    const result = await detectDocumentConflicts(
      'doc-1',
      'branch-1',
      buildSlotDelta({ content: [] }, { content: [] }),
      documentSnapshot,
      {
        propPatches: [
          {
            componentId: '__root__',
            operations: [
              { op: 'replace' as const, path: '/_meta/ogTitle', value: 'New template default' },
            ],
          },
        ],
        fromTemplateContent: [],
        fromRootProps: { _meta: { ogTitle: 'Old template default' } },
      },
    );

    expect(result).toBeNull();
  });

  it('reports a first-time _meta gain as one whole-object conflict', async () => {
    const { detectDocumentConflicts } = await import('../../src/services/migration-service');
    const db = await import('../../src/db');
    const { reconstructVersionSnapshot } = await import('../../src/services/document-version-service');

    // `jsonPatchCompare` only descends into keys present on both sides, so the
    // first version to carry `_meta` emits a single whole-object `add`. The
    // three-way guard therefore runs at `/_meta`, not per field: a page that
    // already authored any part of `_meta` diverges as a whole and takes none of
    // the defaults. That is reported as one conflict rather than silently lost.
    const documentSnapshot = {
      content: [],
      root: { props: { _meta: { ogTitle: 'Editor wrote this' } } },
    };

    vi.mocked(db.query).mockResolvedValue({ rows: [{ version_number: 3 }], rowCount: 1 });
    vi.mocked(reconstructVersionSnapshot).mockResolvedValue(documentSnapshot);

    const result = await detectDocumentConflicts(
      'doc-1',
      'branch-1',
      buildSlotDelta({ content: [] }, { content: [] }),
      documentSnapshot,
      {
        propPatches: [
          {
            componentId: '__root__',
            operations: [
              {
                op: 'add' as const,
                path: '/_meta',
                value: { ogType: 'article', ogTitle: 'Blog default' },
              },
            ],
          },
        ],
        fromTemplateContent: [],
        fromRootProps: {},
      },
    );

    expect(result?.propConflicts).toEqual([
      {
        componentId: '__root__',
        propPath: '/_meta',
        templateOldValue: undefined,
        templateNewValue: { ogType: 'article', ogTitle: 'Blog default' },
        documentValue: { ogTitle: 'Editor wrote this' },
      },
    ]);
  });

  it('takes the whole object when the page has no _meta of its own', async () => {
    const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

    const snapshot = { content: [], root: { props: { title: 'Launch' } } };

    const result = applyDeltaToSnapshot(snapshot, noStructuralChange(snapshot), {
      propPatches: [
        {
          componentId: '__root__',
          operations: [
            {
              op: 'add' as const,
              path: '/_meta',
              value: { ogType: 'article', ogTitle: 'Blog default' },
            },
          ],
        },
      ],
      fromTemplateContent: [],
      fromRootProps: { title: 'Launch' },
    });

    expect(rootProps(result)._meta).toEqual({ ogType: 'article', ogTitle: 'Blog default' });
  });
});

describe('root prop patches: extraction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('emits an add when the baseline template version had no root props', async () => {
    const { extractTemplateDelta } = await import('../../src/services/migration-service');
    const db = await import('../../src/db');
    const { reconstructVersionSnapshot } = await import('../../src/services/document-version-service');

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });
    vi.mocked(reconstructVersionSnapshot)
      .mockResolvedValueOnce({ content: [] })
      .mockResolvedValueOnce({ content: [], root: { props: { _meta: { ogType: 'article' } } } });

    const { propPatches } = await extractTemplateDelta('template-1', 'branch-1', 1, 2);

    expect(propPatches).toEqual([
      {
        componentId: '__root__',
        operations: [{ op: 'add', path: '/_meta', value: { ogType: 'article' } }],
      },
    ]);
  });

  it('does not strip page root props when the new version has no root at all', async () => {
    const { extractTemplateDelta } = await import('../../src/services/migration-service');
    const db = await import('../../src/db');
    const { reconstructVersionSnapshot } = await import('../../src/services/document-version-service');

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });
    vi.mocked(reconstructVersionSnapshot)
      .mockResolvedValueOnce({ content: [], root: { props: { title: 'Launch' } } })
      .mockResolvedValueOnce({ content: [] });

    const { propPatches } = await extractTemplateDelta('template-1', 'branch-1', 1, 2);

    expect(propPatches).toEqual([]);
  });
});

describe('root prop patches: conflict resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const conflictRow = (propConflicts: unknown[]): Record<string, unknown> => ({
    id: 'conflict-1',
    migration_job_id: 'job-1',
    document_id: 'doc-1',
    branch_id: 'branch-1',
    template_id: 'template-1',
    from_version: 1,
    to_version: 2,
    template_delta: { added: [], removed: [], moved: [], templateIds: [] },
    document_actions: { added: [], removed: [], moved: [], templateIds: [] },
    prop_conflicts: propConflicts,
    conflict_type: 'prop',
    resolution: null,
    created_at: '2026-07-01T00:00:00.000Z',
    resolved_at: null,
  });

  it('applies the template value to a root prop conflict', async () => {
    const { resolveMigrationConflict } = await import('../../src/services/migration-service');
    const db = await import('../../src/db');
    const { getLatestDocumentVersion, createDocumentVersion } =
      await import('../../src/services/document-version-service');

    // `walkComponents` covers content and zones only, so resolving a `__root__`
    // conflict by searching the components would find nothing and report success
    // having written the page back unchanged.
    const row = conflictRow([
      {
        componentId: '__root__',
        propPath: '/_meta/ogTitle',
        templateOldValue: 'Old template default',
        templateNewValue: 'New template default',
        documentValue: 'Editor wrote this',
      },
    ]);

    vi.mocked(db.query).mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: [row], rowCount: 1 });
      }
      return Promise.resolve({
        rows: [{ ...row, resolution: 'apply', resolved_at: '2026-07-01T01:00:00.000Z' }],
        rowCount: 1,
      });
    });

    vi.mocked(getLatestDocumentVersion).mockResolvedValue({
      id: 'v-1',
      documentId: 'doc-1',
      branchId: 'branch-1',
      versionNumber: 3,
      snapshot: { content: [], root: { props: { title: 'My Post', _meta: { ogTitle: 'Editor wrote this' } } } },
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    await resolveMigrationConflict('conflict-1', 'apply', { id: 'user-1', type: 'user' });

    expect(createDocumentVersion).toHaveBeenCalledTimes(1);
    const written = vi.mocked(createDocumentVersion).mock.calls[0]?.[0].snapshot as {
      root: { props: Record<string, unknown> };
    };
    expect(written.root.props._meta).toEqual({ ogTitle: 'New template default' });
    expect(written.root.props.title).toBe('My Post');
  });
});
