/**
 * A created translation reports the canonical it was localized from. The insert
 * that returns the document row runs before the localization edge exists, so the
 * row carries no upstream — the response must not describe a document as having
 * nothing upstream in the same breath as naming its canonical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documents, documentVersions } from '../../src/db/schema';
import { createTranslation } from '../../src/services/create-translation-service';
import { getDocument } from '../../src/services/document-service';
import { getLatestDocumentVersionWithFallback } from '../../src/services/document-version-service';

vi.mock('../../src/services/document-service', () => ({
  getDocument: vi.fn(),
}));

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersionWithFallback: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
}));

vi.mock('../../src/services/branch-document-service', () => ({
  documentExistsOnBranch: vi.fn(),
}));

vi.mock('../../src/services/template-read', () => ({
  findMainBranchId: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/relations-service', () => ({
  createLocalizationEdge: vi.fn(
    async (params: { syncedUpstreamVersion: number; syncedUpstreamVersionId: string | null }) => ({
      derivedDocumentId: 'doc-translation',
      upstreamDocumentId: 'doc-canonical',
      relationType: 'localization',
      syncedUpstreamVersion: params.syncedUpstreamVersion,
      syncedUpstreamVersionId: params.syncedUpstreamVersionId,
    }),
  ),
  listLocalizationEdgesByUpstreamDocument: vi.fn(async () => []),
  findTranslationInLocale: vi.fn(async () => null),
}));

const CANONICAL_ID = 'doc-canonical';

function setupHappyPath(stub: DatabaseStub): void {
  vi.mocked(getDocument).mockResolvedValue({
    id: CANONICAL_ID,
    siteId: 'site-1',
    path: 'pages/home',
    createdAt: '2026-07-07T10:00:00.000Z',
  });

  vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValue({
    version: {
      id: 'canonical-version-4',
      documentId: CANONICAL_ID,
      branchId: 'branch-1',
      versionNumber: 4,
      snapshot: { content: [], zones: {}, root: { props: {} } },
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: '2026-07-07T10:00:00.000Z',
    },
    inherited: false,
  } as never);

  // The insert returns the stored row, which carries no localized_from_id: the
  // edge does not exist yet when it runs.
  stub.on(documents).insert.returnsRaw([
    {
      id: 'doc-translation',
      site_id: 'site-1',
      path: 'pages/home.fr-FR',
      locale: 'fr-FR',
      created_at: '2026-07-07T10:00:00.000Z',
    },
  ]);
  stub.on(documentVersions).insert.returnsRaw([
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
  ]);
}

describe('createTranslation result', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = stubDatabase();
  });

  it('names the canonical the translation was localized from', async () => {
    setupHappyPath(stub);

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
    setupHappyPath(stub);

    const result = await createTranslation({
      canonicalDocumentId: CANONICAL_ID,
      branchId: 'branch-1',
      locale: 'fr-FR',
      createdById: 'user-1',
      createdByType: 'user',
    });

    expect(result.document.localizedFromId).toBe(result.localization.upstreamDocumentId);
  });

  it('pins the edge to the identity of the canonical version it cloned', async () => {
    setupHappyPath(stub);

    const result = await createTranslation({
      canonicalDocumentId: CANONICAL_ID,
      branchId: 'branch-1',
      locale: 'fr-FR',
      createdById: 'user-1',
      createdByType: 'user',
    });

    expect(result.localization.syncedUpstreamVersionId).toBe('canonical-version-4');
    expect(result.localization.syncedUpstreamVersion).toBe(4);
  });
});
