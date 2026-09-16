/**
 * Version numbers run per document and branch, and are chosen from a read of the
 * current maximum. A write to the same document and branch that commits between
 * that read and the insert takes the number this one computed, and Postgres
 * rejects the loser. Taking a locale over appends such a version, so it has to
 * survive losing that race rather than surface it to whoever asked for the locale.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const CANONICAL_ID = 'doc-canonical';
const TRANSLATION_ID = 'doc-translation';

vi.mock('../../src/db/scope', () => ({
  db: vi.fn(),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../src/services/document-service', () => ({
  getDocument: vi.fn(),
}));

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersionWithFallback: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
}));

vi.mock('../../src/services/template-read', () => ({
  findMainBranchId: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/relations-service', () => ({
  createLocalizationEdge: vi.fn(),
  listLocalizationEdgesByUpstreamDocument: vi.fn(async () => []),
  listServedTranslationIds: vi.fn(async () => new Set<string>()),
  findTranslationInLocale: vi.fn(async () => ({
    documentId: TRANSLATION_ID,
    liveOnBranch: false,
    syncedUpstreamVersion: null,
    syncedUpstreamVersionId: null,
  })),
}));

/** A rejected insert as the driver reports it, wrapped the way Drizzle wraps it. */
function uniqueViolation(constraintName: string): Error {
  const driverError = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraintName,
  });
  return new Error('Failed query', { cause: driverError });
}

function versionRow(versionNumber: number): Record<string, unknown>[] {
  return [
    {
      id: `version-${String(versionNumber)}`,
      document_id: TRANSLATION_ID,
      branch_id: 'branch-1',
      version_number: versionNumber,
      snapshot: {},
      source: 'edit',
      created_by_id: 'user-1',
      created_by_type: 'user',
      created_at: '2026-07-07T10:00:00.000Z',
    },
  ];
}

const LOCKED = [{ id: CANONICAL_ID }];

const HELD_BY_ANOTHER_BRANCH = {
  documentId: TRANSLATION_ID,
  liveOnBranch: false,
  syncedUpstreamVersion: null,
  syncedUpstreamVersionId: null,
};

/**
 * The one execute every statement on this path runs through. Its call order is
 * the order the path issues them in: the canonical lock, the translation lock,
 * then the version insert, once per attempt.
 */
async function setupTakeOver(): Promise<{
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}> {
  const scope = await import('../../src/db/scope');
  const execute = vi.fn();
  vi.mocked(scope.db).mockReturnValue({ execute } as never);
  vi.mocked(scope.transaction).mockImplementation(async (fn) => fn());

  const documentService = await import('../../src/services/document-service');
  const versionService = await import('../../src/services/document-version-service');
  const relations = await import('../../src/services/relations-service');

  vi.mocked(documentService.getDocument).mockImplementation(
    async (id: string) =>
      ({
        id,
        siteId: 'site-1',
        path: id === CANONICAL_ID ? 'pages/home' : 'pages/home.fr-FR',
        createdAt: '2026-07-07T10:00:00.000Z',
      }),
  );

  vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValue({
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

  vi.mocked(relations.findTranslationInLocale).mockResolvedValue(HELD_BY_ANOTHER_BRANCH);
  return { execute, transaction: vi.mocked(scope.transaction) };
}

async function takeOver(): Promise<unknown> {
  const { createTranslation } = await import('../../src/services/create-translation-service');
  return createTranslation({
    canonicalDocumentId: CANONICAL_ID,
    branchId: 'branch-1',
    locale: 'fr-FR',
    createdById: 'user-1',
    createdByType: 'user',
  });
}

const VERSION_NUMBER_KEY = 'document_versions_document_id_branch_id_version_number_key';

describe('Taking a locale over while another version of it is being written', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('numbers the version again on a fresh transaction and returns the one that landed', async () => {
    const { execute, transaction } = await setupTakeOver();
    vi.mocked(execute)
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(LOCKED)
      .mockRejectedValueOnce(uniqueViolation(VERSION_NUMBER_KEY))
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(versionRow(8));

    const result = (await takeOver()) as { version: { versionNumber: number } };

    expect(result.version.versionNumber).toBe(8);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('reports a translation the other writer made live rather than taking it over', async () => {
    const relations = await import('../../src/services/relations-service');
    const { execute } = await setupTakeOver();
    vi.mocked(execute)
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(LOCKED)
      .mockRejectedValueOnce(uniqueViolation(VERSION_NUMBER_KEY))
      .mockResolvedValue(LOCKED);
    vi.mocked(relations.findTranslationInLocale)
      .mockResolvedValueOnce(HELD_BY_ANOTHER_BRANCH)
      .mockResolvedValueOnce({ ...HELD_BY_ANOTHER_BRANCH, liveOnBranch: true });

    const { TranslationAlreadyExistsError } = await import('../../src/services/errors');
    await expect(takeOver()).rejects.toBeInstanceOf(TranslationAlreadyExistsError);
  });

  it('reports a collision that stands after the retry as a conflict', async () => {
    const { execute, transaction } = await setupTakeOver();
    vi.mocked(execute)
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(LOCKED)
      .mockRejectedValueOnce(uniqueViolation(VERSION_NUMBER_KEY))
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(LOCKED)
      .mockRejectedValueOnce(uniqueViolation(VERSION_NUMBER_KEY));

    const { TranslationVersionContentionError } = await import('../../src/services/errors');
    await expect(takeOver()).rejects.toBeInstanceOf(TranslationVersionContentionError);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  // The driver's rejection names the statement that was refused, and a statement
  // carries the content it was writing.
  it('keeps the refused statement out of what it reports', async () => {
    const { execute } = await setupTakeOver();
    const refused = uniqueViolation(VERSION_NUMBER_KEY);
    refused.message = 'Failed query: INSERT INTO app.document_versions ... Ein Betriebsgeheimnis';
    vi.mocked(execute)
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(LOCKED)
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(LOCKED)
      .mockRejectedValueOnce(refused);

    await expect(takeOver()).rejects.not.toThrow(/Betriebsgeheimnis|INSERT INTO/);
  });

  it('leaves a violation of another constraint to the caller unchanged', async () => {
    const { execute, transaction } = await setupTakeOver();
    vi.mocked(execute)
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(LOCKED)
      .mockRejectedValueOnce(uniqueViolation('documents_site_id_path_active_key'));

    await expect(takeOver()).rejects.toThrow('Failed query');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
