/**
 * Observability for the document-insert path.
 *
 * Provoking the unique constraint used to make Postgres log an ERROR line per
 * conflict — the wrong severity in the wrong place, but the only evidence that
 * path reuse was happening at all. ON CONFLICT DO NOTHING removes the line, so
 * these are what replace it: routine reuse at debug, and the one branch that
 * discards state at info.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documents, documentVersions } from '../../src/db/schema';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';

function docRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-uuid-456',
    site_id: 'site-uuid-123',
    path: 'pages/new',
    created_at: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'version-uuid-123',
    document_id: 'doc-uuid-456',
    branch_id: 'branch-uuid-789',
    version_number: 1,
    snapshot: {},
    source: 'edit',
    created_by_id: 'user-uuid-001',
    created_by_type: 'user',
    created_at: '2026-08-21T10:00:00.000Z',
    is_tombstone: false,
    ...overrides,
  };
}

/** Resolves a debug call's context, which is passed as a thunk. */
function contextOf(call: unknown[]): Record<string, unknown> {
  const arg = call[1];
  return (typeof arg === 'function' ? (arg as () => unknown)() : arg) as Record<string, unknown>;
}

function loggedWith(mock: typeof logger.debug, outcome: string): Record<string, unknown> | undefined {
  const call = mock.mock.calls.find((c) => contextOf(c).outcome === outcome);
  return call ? contextOf(call) : undefined;
}

describe('document insert observability', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = stubDatabase();
  });

  it('reports a reused path at debug, with the ids needed to find it', async () => {
    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow({ id: 'existing-doc-id' })]);
    stub.on(documentVersions).insert.returnsRaw([versionRow({ document_id: 'existing-doc-id' })]);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      // A copy-on-write reuse: the path exists site-wide, with no version on
      // this branch yet. Deliberately not a registry path — those have their
      // own reporting, and this assertion is about the ordinary case.
      path: 'pages/inherited',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const context = loggedWith(logger.debug, 'reused');
    expect(context).toMatchObject({
      site_id: 'site-uuid-123',
      branch_id: 'branch-uuid-789',
      document_id: 'existing-doc-id',
      doc_path: 'pages/inherited',
    });
    // Routine volume — this must not be promoted to info.
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('reports a new path at debug', async () => {
    stub.on(documents).insert.returnsRaw([docRow()]);
    stub.on(documentVersions).insert.returnsRaw([versionRow()]);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/new',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(loggedWith(logger.debug, 'created')).toMatchObject({ document_id: 'doc-uuid-456' });
  });

  it('keeps a skipped registry write off info, so a real one stands out', async () => {
    const descriptor = { name: 'HeroBlock', descriptorHash: 'abc123', registeredAt: '2026-08-01T00:00:00.000Z' };

    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([
      docRow({ id: 'registry-doc', path: '_registry/components/heroblock' }),
    ]);
    stub.on(documentVersions).select.returnsRaw([
      versionRow({ document_id: 'registry-doc', snapshot: descriptor }),
    ]);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: '_registry/components/heroblock',
      // Same component, restamped — what every CI run posts.
      snapshot: { ...descriptor, registeredAt: '2026-08-21T09:00:00.000Z' },
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(loggedWith(logger.debug, 'skipped_unchanged')).toMatchObject({
      document_id: 'registry-doc',
      doc_path: '_registry/components/heroblock',
    });
    // The point of the split: an unchanged sync run is silent at info, so any
    // registry write that does land is visible on its own.
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('reports a registry write that actually changed at info', async () => {
    const stored = { name: 'HeroBlock', descriptorHash: 'abc123' };

    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([
      docRow({ id: 'registry-doc', path: '_registry/components/heroblock' }),
    ]);
    stub.on(documentVersions).select.returnsRaw([
      versionRow({ document_id: 'registry-doc', snapshot: stored }),
    ]);
    stub.on(documentVersions).insert.returnsRaw([versionRow({ document_id: 'registry-doc' })]);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: '_registry/components/heroblock',
      snapshot: { ...stored, descriptorHash: 'def456' },
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const call = logger.info.mock.calls.find((c) => contextOf(c).outcome === 'registry_changed');
    expect(call).toBeDefined();
    expect(contextOf(call!)).toMatchObject({ document_id: 'registry-doc' });
  });

  it('reports a recreation after tombstone at info — it is the branch that discards state', async () => {
    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow({ id: 'tombstoned-doc' })]);
    stub.on(documentVersions).select.returnsRaw([
      versionRow({ document_id: 'tombstoned-doc', is_tombstone: true }),
    ]);
    stub.on(documentVersions).insert.returnsRaw([
      versionRow({ document_id: 'tombstoned-doc', source: 'recreate' }),
    ]);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/was-deleted',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const call = logger.info.mock.calls.find((c) => contextOf(c).outcome === 'recreated');
    expect(call).toBeDefined();
    expect(contextOf(call!)).toMatchObject({
      document_id: 'tombstoned-doc',
      doc_path: 'pages/was-deleted',
    });
  });
});
