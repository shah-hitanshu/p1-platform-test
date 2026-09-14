/**
 * Snapshot reads for documents and templates.
 *
 * A page's versions live on the branch that authored them. A template's do not: a
 * branch that has never edited a template holds no versions of it and inherits
 * main's. So a template must be read either through
 * {@link resolveTemplateReadBranch}, which picks the branch holding it, or through
 * `getLatestTemplateVersionWithFallback`, which also treats a branch-local deletion
 * as absent. A bare branch-scoped read finds nothing on an inheriting branch, which
 * reads downstream as "the template declares nothing" rather than as a failed read.
 */

import { and, eq } from 'drizzle-orm';
import { documentVersions } from '../db/schema';
import { db } from '../db/scope';
import { getBranch, getMainBranch } from './branch-service';
import { branchInheritsFromMain } from './document-queries';
import {
  getLatestDocumentVersion,
  reconstructVersionSnapshot,
} from './document-version-service';

/**
 * A document's latest snapshot on a branch, rebuilt from the baseline when the
 * latest version stores only a diff. Null when the document has no version on the
 * branch. Branch-strict: resolve the branch first when reading a template.
 */
export async function getLatestSnapshot(
  documentId: string,
  branchId: string,
): Promise<Record<string, unknown> | null> {
  const latest = await getLatestDocumentVersion(documentId, branchId);
  if (latest === null) {
    return null;
  }
  const stored = latest.snapshot as Record<string, unknown> | null | undefined;
  if (stored !== null && stored !== undefined) {
    return stored;
  }
  return reconstructVersionSnapshot(documentId, branchId, latest.versionNumber);
}

/**
 * The main branch of the site a branch belongs to, or undefined when the branch is
 * itself main and so inherits nothing. Callers that already hold a site id should
 * use `getMainBranch` directly.
 */
export async function findMainBranchId(branchId: string): Promise<string | undefined> {
  const branch = await getBranch(branchId);
  if (branch === null || branch.isMain) {
    return undefined;
  }
  const main = await getMainBranch(branch.siteId);
  return main?.id;
}

/**
 * The branch a template's versions must be read from: the given branch when it
 * holds a local version of the template, otherwise `mainBranchId`, which a non-main
 * branch inherits the template from. Returns the given branch unchanged when no
 * distinct main branch is supplied, so callers that have no main branch in hand
 * must resolve one with {@link findMainBranchId} first.
 */
export async function resolveTemplateReadBranch(
  templateId: string,
  branchId: string,
  mainBranchId?: string,
): Promise<string> {
  if (!branchInheritsFromMain(branchId, mainBranchId)) {
    return branchId;
  }

  const [local] = await db()
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, templateId), eq(documentVersions.branchId, branchId)))
    .limit(1);
  return local !== undefined ? branchId : mainBranchId;
}
