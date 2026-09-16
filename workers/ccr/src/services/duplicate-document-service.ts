/**
 * Duplicates a document, and optionally its whole subtree, on one branch.
 *
 * The per-document clone is shared with create-translation-service; the one
 * difference is that the snapshot read falls back to main, because a
 * copy-on-write document has no version of its own on the branch. Path
 * allocation is its own problem — see findFreeSuffix.
 *
 * A copy keeps the source's locale but not its localization edge, so copying a
 * French translation gives a standalone French document rather than a second
 * translation of the same canonical.
 */

import type { Document } from '../types';
import { sql } from 'drizzle-orm';
import { db, transaction } from '../db/scope';
import {
  mapRowToDocument,
  normalizePath,
  validatePath,
  MAX_PATH_LENGTH,
} from './document-types';
import type { DocumentOnBranch } from './document-types';
import { getDocument } from './document-service';
import { listDocumentsOnBranch } from './branch-document-service';
import { cloneLatestSnapshot, insertDocumentWithVersion } from './document-clone';
import {
  DocumentNotFoundError,
  DuplicateSubtreeTooLargeError,
  InvalidDocumentPathError,
  PathAllocationExhaustedError,
} from './errors';

export const MAX_DUPLICATE_DESCENDANTS = 100;
const MAX_PATH_ATTEMPTS = 50;
const TEMPLATES_PREFIX = '_registry/templates/';

export interface DuplicateDocumentParams {
  documentId: string;
  branchId: string;
  siteId: string;
  mainBranchId?: string;
  includeChildren: boolean;
  createdById: string;
  createdByType: 'user' | 'agent' | 'service';
}

export interface DuplicateDocumentResult {
  documents: Document[];
}

/** Strips a trailing `-<digits>` so `/about-2` copies to `/about-3`, not `/about-2-2`. */
function stem(value: string): string {
  return value.replace(/-\d+$/, '');
}

/** `about/team` + 3 → `about/team-3`. Only the last segment takes the suffix. */
export function suffixedPath(sourcePath: string, n: number): string {
  const cut = sourcePath.lastIndexOf('/');
  const parent = cut === -1 ? '' : sourcePath.slice(0, cut + 1);
  const last = cut === -1 ? sourcePath : sourcePath.slice(cut + 1);
  return `${parent}${stem(last)}-${String(n)}`;
}

/** Hyphenated, matching the prototype: "About" + 3 → "About-3". */
export function suffixedTitle(sourceTitle: string, n: number): string {
  return `${stem(sourceTitle)}-${String(n)}`;
}

/**
 * The first N whose whole candidate set is free. Checked against app.documents
 * directly, not the branch listing: uniqueness is site-wide and a tombstone
 * keeps its path, so the listing hides rows the unique index still enforces.
 * Root and descendants are checked together — a free root says nothing about
 * the paths beneath it.
 */
async function findFreeSuffix(
  siteId: string,
  sourcePath: string,
  descendantPaths: readonly string[],
): Promise<{ n: number; paths: string[] }> {
  for (let n = 2; n < 2 + MAX_PATH_ATTEMPTS; n++) {
    const base = suffixedPath(sourcePath, n);
    const paths = [base, ...descendantPaths.map((d) => base + d.slice(sourcePath.length))];
    for (const path of paths) {
      validatePath(path);
      if (path.length > MAX_PATH_LENGTH) {
        throw new InvalidDocumentPathError(path);
      }
    }

    // sql.param keeps the path list one array parameter rather than a row
    // constructor, which ANY cannot read.
    const taken = await db().execute(sql`
      SELECT id FROM app.documents
       WHERE site_id = ${siteId} AND archived_at IS NULL
         AND path = ANY(${sql.param(paths)}::text[])
       LIMIT 1`);

    if (taken.length === 0) return { n, paths };
  }

  throw new PathAllocationExhaustedError(sourcePath);
}

/**
 * Retitles a cloned snapshot in place. A template's name lives in its metadata
 * and its URL pattern is cleared — two templates claiming one pattern would
 * both capture the same override pages.
 */
function retitle(snapshot: Record<string, unknown>, isTemplate: boolean, n: number): void {
  if (isTemplate) {
    retitleTemplate(snapshot, n);
    return;
  }

  const root = snapshot.root as { props?: Record<string, unknown> } | undefined;
  if (root?.props !== undefined && typeof root.props.title === 'string') {
    root.props.title = suffixedTitle(root.props.title, n);
    return;
  }
  if (typeof snapshot.title === 'string') {
    snapshot.title = suffixedTitle(snapshot.title, n);
  }
}

/**
 * Templates carry metadata two ways — root.props._template on content-shaped
 * snapshots, top-level fields on pre-backfill manifests. Both are handled;
 * missing the legacy shape ships a copy that keeps the original's URL pattern.
 */
function retitleTemplate(snapshot: Record<string, unknown>, n: number): void {
  const root = snapshot.root as
    | { props?: { _template?: Record<string, unknown> } }
    | undefined;
  const meta = root?.props?._template;

  const target: Record<string, unknown> = meta ?? snapshot;
  if (typeof target.label === 'string') {
    target.label = suffixedTitle(target.label, n);
  }
  delete target.defaultUrlPattern;
}

async function cloneSnapshot(
  documentId: string,
  params: DuplicateDocumentParams,
): Promise<Record<string, unknown>> {
  // Branch-local reads return null for a copy-on-write document, which is most
  // of the tree on a fresh workstream, so main is offered as the fallback.
  const clone = await cloneLatestSnapshot(
    documentId,
    params.branchId,
    params.mainBranchId ?? params.branchId,
  );
  if (clone === null) {
    throw new DocumentNotFoundError(documentId);
  }

  return clone.snapshot;
}

async function insertCopy(
  params: DuplicateDocumentParams,
  path: string,
  snapshot: Record<string, unknown>,
  source: { templateId?: string; templateVersion?: number; locale?: string },
): Promise<Document> {
  const { row } = await insertDocumentWithVersion({
    siteId: params.siteId,
    path,
    locale: source.locale,
    branchId: params.branchId,
    snapshot,
    createdById: params.createdById,
    createdByType: params.createdByType,
  });

  const document = mapRowToDocument(row);

  // Without this the copy falls out of its template group and out of sync.
  if (source.templateId !== undefined) {
    await db().execute(sql`
      INSERT INTO app.document_relations
         (source_document_id, target_document_id, relation_type, synced_version)
       VALUES (${row.id}, ${source.templateId}, 'template', ${source.templateVersion ?? null})`);
    document.templateId = source.templateId;
    if (source.templateVersion !== undefined) {
      document.templateVersion = source.templateVersion;
    }
  }

  return document;
}

export async function duplicateDocument(
  params: DuplicateDocumentParams,
): Promise<DuplicateDocumentResult> {
  const source = await getDocument(params.documentId);
  if (source?.siteId !== params.siteId) {
    throw new DocumentNotFoundError(params.documentId);
  }

  // getDocument returns the raw documents.path; the listing returns the
  // branch-effective one. They differ for a page moved on this branch, and
  // every prefix comparison below has to use the effective form.
  const rawPath = normalizePath(source.path);
  const siblings = await listDocumentsOnBranch(params.branchId, {
    pathPrefix: rawPath,
    mainBranchId: params.mainBranchId,
  });
  const onBranch = siblings.find((doc) => doc.id === source.id);
  const sourcePath = normalizePath(onBranch?.path ?? rawPath);
  const isTemplate = sourcePath.startsWith(TEMPLATES_PREFIX);

  // The prefix cannot carry a trailing slash — the listing normalises it away
  // (document-types.ts:455) — so the query comes back with the source and
  // same-prefix siblings in it, and the real subtree is cut out here.
  const descendants: DocumentOnBranch[] = params.includeChildren
    ? siblings.filter((doc) => normalizePath(doc.path).startsWith(`${sourcePath}/`))
    : [];

  if (descendants.length > MAX_DUPLICATE_DESCENDANTS) {
    throw new DuplicateSubtreeTooLargeError(descendants.length, MAX_DUPLICATE_DESCENDANTS);
  }

  const [rootClone, ...childClones] = await Promise.all(
    [source, ...descendants].map((doc) => cloneSnapshot(doc.id, params)),
  ) as [Record<string, unknown>, ...Record<string, unknown>[]];

  return transaction(async () => {
    const descendantPaths = descendants.map((d) => normalizePath(d.path));
    const { n, paths } = await findFreeSuffix(params.siteId, sourcePath, descendantPaths);

    // findFreeSuffix guarantees paths has at least one entry — the root.
    const [rootPath, ...childPaths] = paths as [string, ...string[]];
    retitle(rootClone, isTemplate, n);

    const documents: Document[] = [
      await insertCopy(params, rootPath, rootClone, source),
    ];

    // Descendant titles are left alone — they stay unique under the new parent.
    for (const [i, child] of descendants.entries()) {
      documents.push(
        await insertCopy(
          params,
          // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
          childPaths[i] as string,
          // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
          childClones[i] as Record<string, unknown>,
          child,
        ),
      );
    }

    return { documents };
  });
}
