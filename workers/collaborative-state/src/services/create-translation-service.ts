/**
 * Create-translation Service
 *
 * Clones a canonical document into a locale variant. The clone preserves every
 * component slot id exactly so the translation and its canonical share slot
 * identity, and a 'localization' edge pins the translation to the canonical
 * version it was cloned from.
 *
 * @see workers/src/db/migrations/052_document_locale.sql
 */

import type { Document } from '../types';
import { query, withTransaction } from '../db';
import { getFirstRow } from './checkpoint-mappers';
import {
  DocumentNotFoundError,
  DuplicateDocumentPathError,
  isUniqueConstraintViolation,
  mapRowToDocument,
  mapRowToDocumentVersion,
  normalizePath,
  validatePath,
} from './document-types';
import type {
  DocumentRow,
  DocumentVersion,
  DocumentVersionRow,
  DocumentWithArchive,
} from './document-types';
import { getDocument } from './document-service';
import { documentExistsOnBranch } from './branch-document-service';
import { getLatestDocumentVersion, reconstructVersionSnapshot } from './document-version-service';
import { enforceUniqueSlotIds } from './slot-id-backstop';
import { createLocalizationEdge, listLocalizationEdgesByTarget } from './relations-service';
import { validateLocale } from './locale';

/**
 * Summary of a localization edge returned alongside a created translation.
 */
export interface LocalizationEdgeSummary {
  sourceDocumentId: string;
  targetDocumentId: string;
  relationType: 'localization';
  syncedVersion: number | null;
}

/**
 * Parameters for creating a translation of a canonical document.
 */
export interface CreateTranslationParams {
  canonicalDocumentId: string;
  branchId: string;
  locale: string;
  /** Path for the new translation; defaults to `{canonicalPath}.{locale}`. */
  path?: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'service';
}

/**
 * Result of creating a translation.
 */
export interface CreateTranslationResult {
  document: Document;
  version: DocumentVersion;
  localization: LocalizationEdgeSummary;
}

/**
 * A canonical document paired with the locale variants derived from it.
 */
export interface LocaleVariantsResult {
  canonical: Document;
  variants: { document: Document; localization: LocalizationEdgeSummary }[];
}

export { InvalidLocaleError } from './locale';

/**
 * Thrown when the canonical document has no version on the branch to clone.
 */
export class CanonicalVersionNotFoundError extends Error {
  public readonly name = 'CanonicalVersionNotFoundError';

  constructor(
    public readonly documentId: string,
    public readonly branchId: string,
  ) {
    super(`Document "${documentId}" has no version on branch "${branchId}".`);
    Object.setPrototypeOf(this, CanonicalVersionNotFoundError.prototype);
  }
}

/**
 * Thrown when the canonical already has a translation in the requested locale.
 */
export class TranslationAlreadyExistsError extends Error {
  public readonly name = 'TranslationAlreadyExistsError';

  constructor(
    public readonly canonicalDocumentId: string,
    public readonly locale: string,
  ) {
    super(`A "${locale}" translation of document "${canonicalDocumentId}" already exists.`);
    Object.setPrototypeOf(this, TranslationAlreadyExistsError.prototype);
  }
}

/**
 * Clones a canonical document's current snapshot into a new locale variant,
 * preserving slot ids, and records a localization edge pinned to the canonical's
 * current version.
 *
 * @throws InvalidLocaleError if the locale is malformed
 * @throws DocumentNotFoundError if the canonical does not exist
 * @throws CanonicalVersionNotFoundError if the canonical has no version on the branch
 * @throws TranslationAlreadyExistsError if the locale already exists for the canonical
 * @throws DuplicateDocumentPathError if a document already occupies the translation path
 */
export async function createTranslation(
  params: CreateTranslationParams,
): Promise<CreateTranslationResult> {
  const locale = validateLocale(params.locale);

  const canonical = await getDocument(params.canonicalDocumentId);
  if (canonical === null) {
    throw new DocumentNotFoundError(params.canonicalDocumentId);
  }

  const latest = await getLatestDocumentVersion(params.canonicalDocumentId, params.branchId);
  if (latest === null) {
    throw new CanonicalVersionNotFoundError(params.canonicalDocumentId, params.branchId);
  }
  // A diff-only latest version stores no snapshot; rebuild it from the baseline.
  const storedSnapshot = latest.snapshot as Record<string, unknown> | null | undefined;
  const sourceSnapshot =
    storedSnapshot ??
    (await reconstructVersionSnapshot(
      params.canonicalDocumentId,
      params.branchId,
      latest.versionNumber,
    ));
  if (sourceSnapshot === null) {
    throw new CanonicalVersionNotFoundError(params.canonicalDocumentId, params.branchId);
  }

  const path = normalizePath(params.path ?? `${canonical.path}.${locale}`);
  validatePath(path);

  // Cloning a valid snapshot leaves every slot id in place; the backstop only
  // re-mints ids that collide within a single document.
  const clonedSnapshot = enforceUniqueSlotIds(
    params.canonicalDocumentId,
    structuredClone(sourceSnapshot),
  );

  return withTransaction(async () => {
    // A canonical holds at most one translation per locale. No constraint spans
    // the edge and the locale column, so concurrent creates are serialized on the
    // canonical row and the check runs behind that lock.
    await query('SELECT 1 FROM app.documents WHERE id = $1 FOR UPDATE', [
      params.canonicalDocumentId,
    ]);

    const duplicate = await query<{ id: string }>(
      `SELECT d.id FROM app.document_relations dr
         JOIN app.documents d ON d.id = dr.source_document_id
        WHERE dr.target_document_id = $1
          AND dr.relation_type = 'localization'
          AND d.locale = $2
          AND d.archived_at IS NULL
        LIMIT 1`,
      [params.canonicalDocumentId, locale],
    );
    if (duplicate.rows.length > 0) {
      throw new TranslationAlreadyExistsError(params.canonicalDocumentId, locale);
    }

    let documentRow: DocumentRow;
    try {
      const docResult = await query<DocumentRow>(
        `INSERT INTO app.documents (site_id, path, locale)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [canonical.siteId, path, locale],
      );
      documentRow = getFirstRow(docResult.rows);
    } catch (docError) {
      if (isUniqueConstraintViolation(docError)) {
        throw new DuplicateDocumentPathError(path, canonical.siteId);
      }
      throw docError;
    }

    const versionResult = await query<DocumentVersionRow>(
      `INSERT INTO app.document_versions (
         document_id, branch_id, version_number, snapshot,
         source, created_by_id, created_by_type
       )
       VALUES ($1, $2, 1, $3, 'edit', $4, $5)
       RETURNING *`,
      [documentRow.id, params.branchId, clonedSnapshot, params.createdById, params.createdByType],
    );

    const edge = await createLocalizationEdge({
      sourceDocumentId: documentRow.id,
      targetDocumentId: params.canonicalDocumentId,
      syncedVersion: latest.versionNumber,
    });

    return {
      document: mapRowToDocument(documentRow),
      version: mapRowToDocumentVersion(getFirstRow(versionResult.rows)),
      localization: {
        sourceDocumentId: edge.sourceDocumentId,
        targetDocumentId: edge.targetDocumentId,
        relationType: 'localization',
        syncedVersion: edge.syncedVersion,
      },
    };
  });
}

/**
 * Returns the canonical document and the locale variants derived from it that the
 * given branch can see: a variant is listed when it holds a live version on the
 * branch and is not archived. Documents and edges are site-scoped, so branch
 * visibility is what narrows the listing: a variant authored on another branch is
 * never listed against a branch that has never held it.
 *
 * @throws DocumentNotFoundError if the canonical does not exist
 */
export async function listLocaleVariants(
  canonicalDocumentId: string,
  branchId: string,
): Promise<LocaleVariantsResult> {
  const canonical = await getDocument(canonicalDocumentId);
  if (canonical === null) {
    throw new DocumentNotFoundError(canonicalDocumentId);
  }

  const edges = await listLocalizationEdgesByTarget(canonicalDocumentId);
  const variants: LocaleVariantsResult['variants'] = [];
  for (const edge of edges) {
    const document: DocumentWithArchive | null = await getDocument(edge.sourceDocumentId);
    if (document === null || document.archivedAt !== undefined) {
      continue;
    }
    if (!(await documentExistsOnBranch(edge.sourceDocumentId, branchId))) {
      continue;
    }
    variants.push({
      document,
      localization: {
        sourceDocumentId: edge.sourceDocumentId,
        targetDocumentId: edge.targetDocumentId,
        relationType: 'localization',
        syncedVersion: edge.syncedVersion,
      },
    });
  }

  return { canonical, variants };
}
