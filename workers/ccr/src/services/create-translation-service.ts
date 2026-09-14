/**
 * Create-translation Service
 *
 * Clones a canonical document into a locale variant. The clone preserves every
 * component slot id exactly so the translation and its canonical share slot
 * identity, and a 'localization' edge pins the translation to the canonical
 * version it was cloned from.
 *
 * @see src/db/schema/documents.schema.ts (documents.locale)
 */

import type { Document } from '../types';
import { query, withTransaction } from '../db';
import { getFirstRow } from './checkpoint-mappers';
import {
  mapRowToDocument,
  mapRowToDocumentVersion,
  normalizePath,
  validatePath,
} from './document-types';
import { DocumentNotFoundError } from './errors';
import type { DocumentVersion, DocumentWithArchive } from './document-types';
import { getDocument } from './document-service';
import type { ClonedSnapshot } from './document-clone';
import {
  cloneLatestSnapshot,
  cloneSnapshotAtVersion,
  insertDocumentWithVersion,
  insertVersionOnBranch,
  isVersionNumberCollision,
} from './document-clone';
import { findMainBranchId } from './template-read';
import type { TranslationInLocale } from './relations-service';
import {
  createLocalizationEdge,
  findTranslationInLocale,
  listLocalizationEdgesByUpstreamDocument,
  listServedTranslationIds,
} from './relations-service';
import { validateLocale } from './locale';
import {
  CanonicalVersionNotFoundError,
  TranslationAlreadyExistsError,
  TranslationVersionContentionError,
} from './errors';

/**
 * How a new translation's content is seeded. `copy` takes the canonical's content
 * verbatim, to be translated in place, and is the only mode implemented: the
 * parameter exists so a caller states which it wants rather than relying on the
 * default meaning what it happens to mean today.
 */
export const TRANSLATION_MODES = ['copy'] as const;

export type TranslationMode = (typeof TRANSLATION_MODES)[number];

/**
 * Summary of a localization edge returned alongside a created translation.
 */
export interface LocalizationEdgeSummary {
  derivedDocumentId: string;
  upstreamDocumentId: string;
  relationType: 'localization';
  syncedUpstreamVersion: number | null;
  syncedUpstreamVersionId: string | null;
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
  /**
   * How the locale's content is seeded.
   */
  mode?: TranslationMode;
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

export { InvalidLocaleError } from './errors';

/**
 * Seeds a branch's version of a translation the site already holds.
 *
 * A locale is held once per site, as one document every branch reads through its own
 * versions. A branch serving none of them takes the document over rather than
 * authoring a second one, which the site-wide unique path would refuse anyway.
 *
 * The new version is appended to whatever the branch already holds of the document,
 * a tombstone from deleting the translation here included: a version after the
 * tombstone is what makes the document live on the branch again. Discarding the
 * branch's versions instead would take published ones with it, which a publish
 * checkpoint still refers to.
 */
async function takeOverTranslation(
  params: CreateTranslationParams,
  mainBranchId: string | undefined,
  existing: TranslationInLocale,
  clone: ClonedSnapshot,
): Promise<CreateTranslationResult> {
  // The edge is written once and its alignment belongs to every branch reading the
  // translation, so a take-over cannot move it to the canonical version this branch
  // serves without telling the others they have reconciled work they have not. The
  // content moves to the alignment instead: seeded from the canonical version the
  // translation is aligned to, so what is outstanding against it is what the other
  // branches see outstanding too.
  //
  // Only an alignment this branch may read is followed. A translation authored from
  // a canonical draft is aligned to a version private to the branch that drafted it,
  // and seeding from that would copy unreleased content into a document every branch
  // reads. The canonical this branch serves is seeded instead, and the alignment is
  // left where it stands either way, so what the other branches see outstanding does
  // not move.
  let aligned = clone;
  if (existing.syncedUpstreamVersionId !== null) {
    const atAlignment = await cloneSnapshotAtVersion(
      params.canonicalDocumentId,
      existing.syncedUpstreamVersionId,
      mainBranchId === undefined ? [params.branchId] : [params.branchId, mainBranchId],
    );
    aligned = atAlignment ?? clone;
  }

  // Numbering a version from a read of the current maximum, which the lock serializes
  // against another take-over of the same translation.
  await query('SELECT 1 FROM app.documents WHERE id = $1 FOR UPDATE', [existing.documentId]);

  const versionRows = await insertVersionOnBranch({
    documentId: existing.documentId,
    branchId: params.branchId,
    snapshot: aligned.snapshot,
    createdById: params.createdById,
    createdByType: params.createdByType,
  });

  const document = await getDocument(existing.documentId);
  if (document === null) {
    throw new DocumentNotFoundError(existing.documentId);
  }

  return {
    document: { ...document, localizedFromId: params.canonicalDocumentId },
    version: mapRowToDocumentVersion(getFirstRow(versionRows)),
    localization: {
      derivedDocumentId: existing.documentId,
      upstreamDocumentId: params.canonicalDocumentId,
      relationType: 'localization',
      syncedUpstreamVersion: existing.syncedUpstreamVersion,
      syncedUpstreamVersionId: existing.syncedUpstreamVersionId,
    },
  };
}

/**
 * How many times a translation's version is numbered before the write is reported
 * as contended. A second attempt clears the ordinary race; losing again means the
 * document is being written to faster than one caller can join.
 */
const VERSION_NUMBER_ATTEMPTS = 2;

/**
 * Clones a canonical document's current snapshot into a new locale variant,
 * preserving slot ids, and records a localization edge pinned to the canonical's
 * current version.
 *
 * A locale another branch holds but this one does not serve is available here: the
 * branch takes that translation over and seeds its own version of it, so the two
 * branches read one document through separate histories. `path` names where a new
 * translation goes and is not consulted for a take-over, which keeps the document
 * where it already sits.
 *
 * @throws InvalidLocaleError if the locale is malformed
 * @throws DocumentNotFoundError if the canonical does not exist
 * @throws CanonicalVersionNotFoundError if the canonical has no version on the branch or on main
 * @throws TranslationAlreadyExistsError if the branch already serves a translation in the locale
 * @throws TranslationVersionContentionError if a concurrent write took the version number twice
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

  // A branch holds no version of a page it has not edited, so main is offered as
  // the fallback: the translation is seeded from the canonical the branch serves.
  const mainBranchId = await findMainBranchId(params.branchId);
  const clone = await cloneLatestSnapshot(
    params.canonicalDocumentId,
    params.branchId,
    mainBranchId ?? params.branchId,
  );
  if (clone === null) {
    throw new CanonicalVersionNotFoundError(params.canonicalDocumentId, params.branchId);
  }

  const path = normalizePath(params.path ?? `${canonical.path}.${locale}`);
  validatePath(path);

  const attempt = (): Promise<CreateTranslationResult> =>
    withTransaction(async () => {
      // A branch holds at most one translation per locale. No constraint spans the
      // edge and the locale column, so concurrent creates are serialized on the
      // canonical row and the check runs behind that lock.
      await query('SELECT 1 FROM app.documents WHERE id = $1 FOR UPDATE', [
        params.canonicalDocumentId,
      ]);

      const existing = await findTranslationInLocale(
        params.canonicalDocumentId,
        locale,
        params.branchId,
        mainBranchId,
      );
      if (existing !== null) {
        if (existing.liveOnBranch) {
          throw new TranslationAlreadyExistsError(params.canonicalDocumentId, locale);
        }
        return takeOverTranslation(params, mainBranchId, existing, clone);
      }

      const { row: documentRow, versionRows } = await insertDocumentWithVersion({
        siteId: canonical.siteId,
        path,
        locale,
        branchId: params.branchId,
        snapshot: clone.snapshot,
        createdById: params.createdById,
        createdByType: params.createdByType,
      });

      const edge = await createLocalizationEdge({
        derivedDocumentId: documentRow.id,
        upstreamDocumentId: params.canonicalDocumentId,
        syncedUpstreamVersion: clone.versionNumber,
        syncedUpstreamVersionId: clone.versionId,
      });

      return {
        // The document insert returns before the edge exists, so the row carries
        // no upstream. The edge is the answer, and the response would otherwise
        // report a translation as deriving from nothing.
        document: { ...mapRowToDocument(documentRow), localizedFromId: edge.upstreamDocumentId },
        version: mapRowToDocumentVersion(getFirstRow(versionRows)),
        localization: {
          derivedDocumentId: edge.derivedDocumentId,
          upstreamDocumentId: edge.upstreamDocumentId,
          relationType: 'localization',
          syncedUpstreamVersion: edge.syncedUpstreamVersion,
          syncedUpstreamVersionId: edge.syncedUpstreamVersionId,
        },
      };
    });

  // Taking a locale over appends a version numbered from a read of the current
  // maximum, and an ordinary edit of the same document and branch reads that same
  // maximum without waiting for this lock. The loser of that race is rejected on
  // the number alone, so the work is done again rather than reported as failed.
  //
  // Every attempt is a whole attempt, on a transaction Postgres has not abandoned
  // and against state that has moved: a concurrent writer that made the locale
  // live here is a taken locale on the next read, which is the answer to give.
  for (let attemptsMade = 1; ; attemptsMade++) {
    try {
      return await attempt();
    } catch (error) {
      if (!isVersionNumberCollision(error)) {
        throw error;
      }
      // The driver's own rejection is not passed on: it names the statement it
      // refused, and the statement carries the content it was writing.
      if (attemptsMade === VERSION_NUMBER_ATTEMPTS) {
        throw new TranslationVersionContentionError(params.canonicalDocumentId, locale);
      }
    }
  }
}

/**
 * Returns the canonical document and the locale variants derived from it that the
 * given branch serves: the ones it holds a live version of, and the ones it
 * inherits published from main. Documents and edges are site-scoped, so branch
 * visibility is what narrows the listing: a variant authored on another branch is
 * never listed against a branch that has never held it, and one main holds only as
 * a draft is nothing the branch serves yet.
 *
 * This is the rule {@link createTranslation} applies to decide a locale is taken, so
 * a language reported as unavailable is a language listed here.
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

  const served = await listServedTranslationIds(
    canonicalDocumentId,
    branchId,
    await findMainBranchId(branchId),
  );
  const edges = await listLocalizationEdgesByUpstreamDocument(canonicalDocumentId);
  const variants: LocaleVariantsResult['variants'] = [];
  for (const edge of edges) {
    if (!served.has(edge.derivedDocumentId)) {
      continue;
    }
    const document: DocumentWithArchive | null = await getDocument(edge.derivedDocumentId);
    if (document === null) {
      continue;
    }
    variants.push({
      document,
      localization: {
        derivedDocumentId: edge.derivedDocumentId,
        upstreamDocumentId: edge.upstreamDocumentId,
        relationType: 'localization',
        syncedUpstreamVersion: edge.syncedUpstreamVersion,
        syncedUpstreamVersionId: edge.syncedUpstreamVersionId,
      },
    });
  }

  return { canonical, variants };
}
