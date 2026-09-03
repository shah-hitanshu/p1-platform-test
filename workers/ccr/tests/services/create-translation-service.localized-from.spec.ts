/**
 * A created translation reports the canonical it was localized from. The insert
 * that returns the document row runs before the localization edge exists, so the
 * row carries no upstream — the response must not describe a document as having
 * nothing upstream in the same breath as naming its canonical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../src/services/document-service', () => ({
  getDocument: vi.fn(),
}));

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
}));

vi.mock('../../src/services/branch-document-service', () => ({
  documentExistsOnBranch: vi.fn(),
}));

vi.mock('../../src/services/relations-service', () => ({
  createLocalizationEdge: vi.fn(async () => ({
    derivedDocumentId: 'doc-translation',
    upstreamDocumentId: 'doc-canonical',
    relationType: 'localization',
    syncedUpstreamVersion: 4,
  })),
  listLocalizationEdgesByUpstreamDocument: vi.fn(async () => []),
}));

const CANONICAL_ID = 'doc-canonical';

async function setupHappyPath(): Promise<void> {
  const db = await import('../../src/db');
  const documentService = await import('../../src/services/document-service');
  const versionService = await import('../../src/services/document-version-service');

  vi.mocked(documentService.getDocument).mockResolvedValue({
    id: CANONICAL_ID,
    siteId: 'site-1',
    path: 'pages/home',
    createdAt: '2026-07-07T10:00:00.000Z',
  });

  vi.mocked(versionService.getLatestDocumentVersion).mockResolvedValue({
    id: 'canonical-version-4',
    documentId: CANONICAL_ID,
    branchId: 'branch-1',
    versionNumber: 4,
    snapshot: { content: [], zones: {}, root: { props: {} } },
    source: 'edit',
    createdById: 'user-1',
    createdByType: 'user',
    createdAt: '2026-07-07T10:00:00.000Z',
  } as never);

  vi.mocked(db.query)
    .mockResolvedValueOnce({ rows: [{ id: CANONICAL_ID }] }) // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({ rows: [] }) // duplicate-locale check
    .mockResolvedValueOnce({
      rows: [
        {
          id: 'doc-translation',
          site_id: 'site-1',
          path: 'pages/home.fr-FR',
          locale: 'fr-FR',
          created_at: '2026-07-07T10:00:00.000Z',
        },
      ],
    }) // INSERT document, RETURNING * — no localized_from_id column
    .mockResolvedValueOnce({
      rows: [
        {
          id: 'version-1',
          document_id: 'doc-translation',
          branch_id: 'branch-1',
          version_number: 1,
          snapshot: {},
          source: 'edit',
          created_by_id: 'user-1',
          created_by_type: 'user',
          created_at: '2026-07-07T10:00:00.000Z',
        },
      ],
    }); // INSERT version
}

describe('createTranslation result', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('names the canonical the translation was localized from', async () => {
    const { createTranslation } = await import('../../src/services/create-translation-service');
    await setupHappyPath();

    const result = await createTranslation({
      canonicalDocumentId: CANONICAL_ID,
      branchId: 'branch-1',
      locale: 'fr-FR',
      createdById: 'user-1',
      createdByType: 'user',
    });

    expect(result.document.localizedFromId).toBe(CANONICAL_ID);
  });

  it('agrees with the localization edge it returns alongside', async () => {
    const { createTranslation } = await import('../../src/services/create-translation-service');
    await setupHappyPath();

    const result = await createTranslation({
      canonicalDocumentId: CANONICAL_ID,
      branchId: 'branch-1',
      locale: 'fr-FR',
      createdById: 'user-1',
      createdByType: 'user',
    });

    expect(result.document.localizedFromId).toBe(result.localization.upstreamDocumentId);
  });
});
