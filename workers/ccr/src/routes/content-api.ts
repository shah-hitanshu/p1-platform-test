/**
 * Content Delivery API Routes
 *
 * Read-only endpoints for delivering published content.
 * Designed for service principals (sat_ tokens).
 * Auth is handled at the index.ts level.
 *
 * GET /api/sites/:siteId/content/:documentPath  - Get document content
 * GET /api/sites/:siteId/content-pages           - List pages on branch
 */

import type { AuthenticatedPrincipal } from '../types';
import {
  getMainBranch,
  getBranch,
  getBranchByName,
  getDocumentByPath,
  getLatestDocumentVersion,
  getLatestPublishedDocumentVersion,
  getLatestDocumentVersionWithFallback,
  hasTombstoneAfterVersion,
  listDocumentsOnBranch,
  replayVersionChain,
  getDocumentVersionByNumber,
  VersionReconstructionError,
  buildPageMetadata,
  getSite,
} from '../services';
import {
  getSiteSettings,
  getEffectiveCacheTtl,
} from '../services/site-settings-service';
import { contentCacheTags, listingCacheTags, notFoundCacheControl } from '../cache/content-cache';
import { getLogger } from '@pantheon-systems/p1-telemetry';

/**
 * Route context for content delivery endpoints
 */
export interface ContentRouteContext {
  siteId: string;
  documentPath?: string;
  action: 'content' | 'content-pages';
  principal: AuthenticatedPrincipal;
}

function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}

/**
 * A miss costs three serialized Postgres queries and the dead-path space is
 * effectively unbounded, so misses are cached — briefly, since a path that
 * 404s today may be published tomorrow.
 *
 * Site tag only: a miss has no document, and every publish purge is anchored
 * on the site, so this is what lets publishing a page clear the 404 cached at
 * its path instead of waiting out the TTL.
 */
function notFoundResponse(error: string, siteId: string): Response {
  return jsonResponse({ error }, 404, {
    'Cache-Control': notFoundCacheControl(),
    'Cache-Tag': contentCacheTags({ siteId }).join(','),
  });
}

import { UUID_RE } from '../utils/branch-ref';
import type { PageContent } from '../types/page-metadata';
import type { DocumentVersion } from '../types';
import type { VersionReplay } from '../services';

/**
 * Resolve the branch from query param or default to main branch.
 * Accepts either a branch UUID or a branch name.
 *
 * Exported so the per-member branch gate in index.ts (PCC-3676) resolves a
 * `?branch=` ref exactly as this handler does — one implementation, called on
 * both the gate and serve sides, so the two never diverge.
 */
export async function resolveBranch(
  request: Request,
  siteId: string,
): Promise<{ id: string; name: string; isMain: boolean } | null> {
  const url = new URL(request.url);
  const branchRef = url.searchParams.get('branch');

  if (branchRef !== null && branchRef !== '') {
    const branch = UUID_RE.test(branchRef)
      ? await getBranch(branchRef)
      : await getBranchByName(siteId, branchRef);
    if (branch?.siteId !== siteId) return null;
    return { id: branch.id, name: branch.name, isMain: branch.isMain };
  }

  const mainBranch = await getMainBranch(siteId);
  if (mainBranch === null) return null;
  return { id: mainBranch.id, name: mainBranch.name, isMain: mainBranch.isMain };
}

/**
 * Cache-Control for content responses. Non-main content is member-only
 * [PCC-3676]; it must never be stored by a shared cache in FRONT of this worker
 * (CDN / ISR / browser) — those are keyed on the bare URL and never see the
 * per-member gate in index.ts, so a `public` copy would be served to anyone.
 * Only published main content is shareable. (The worker-internal cached
 * entrypoint sits behind the gate, so this does not weaken that layer.)
 */
function contentCacheControl(isMain: boolean, ttl: number): string {
  return isMain
    ? `public, s-maxage=${String(ttl)}, stale-while-revalidate=${String(ttl * 5)}`
    : 'private, no-store';
}

/**
 * Main route handler for content delivery operations
 */
export async function handleContentRoutes(
  request: Request,
  context: ContentRouteContext,
): Promise<Response> {
  const { action } = context;

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    switch (action) {
      case 'content':
        return await handleGetContent(request, context);
      case 'content-pages':
        return await handleGetContentPages(request, context);
      default:
        return errorResponse('Not found', 404);
    }
  } catch (error) {
    getLogger().error('content route failed', error, {
      site_id: context.siteId,
      doc_path: context.documentPath,
      action,
      outcome: 'error',
    });
    return errorResponse('Internal server error', 500);
  }
}

/**
 * The version a broken chain may be degraded to, or null when there is none.
 *
 * The gates above run against the version that was asked for, so a fallback has
 * to clear them on its own account rather than inherit that verdict. On main
 * that means only a published version qualifies — serving an unpublished draft
 * because the publish above it could not be rebuilt would put private content
 * behind a public `Cache-Control`. A deletion recorded after the candidate also
 * rules it out, or a break above a tombstone would resurrect the page as it
 * stood before it was deleted.
 *
 * A deletion below the candidate never means the page is gone: the version the
 * route resolved has already been checked against later tombstones, so one
 * found here belongs to a delete-then-republish cycle the caller has moved
 * past. The page is live and only this candidate is too old to stand in for it.
 *
 * Refusing is the safe answer, and it is always a refusal rather than a 404:
 * the caller reports the break instead, which is the behaviour that existed
 * before degrading was possible at all.
 */
async function resolveDegradedVersion(params: {
  documentId: string;
  branch: { id: string; isMain: boolean };
  replay: VersionReplay;
}): Promise<{ version: DocumentVersion; snapshot: Record<string, unknown> } | null> {
  const { documentId, branch, replay } = params;
  if (replay.brokenVersion === undefined) return null;
  const ceiling = replay.brokenVersion - 1;
  if (ceiling < 1) return null;

  const candidate = branch.isMain
    ? await getLatestPublishedDocumentVersion(documentId, branch.id, ceiling)
    : await getDocumentVersionByNumber(documentId, branch.id, ceiling);

  if (candidate == null || candidate.isTombstone === true) return null;

  if (await hasTombstoneAfterVersion(documentId, branch.id, candidate.versionNumber)) {
    return null;
  }

  // Replay already rebuilt the version below the break, so the common case
  // costs nothing more. A published fallback further down carries its own
  // pinned snapshot, and only an unpinned older publish needs a second pass.
  if (candidate.versionNumber === replay.reachedVersion) {
    return { version: candidate, snapshot: replay.snapshot };
  }
  if (candidate.snapshot != null) {
    return { version: candidate, snapshot: candidate.snapshot };
  }

  const rebuilt = await replayVersionChain(documentId, branch.id, candidate.versionNumber);
  if (rebuilt === null || rebuilt.brokenVersion !== undefined) return null;
  return { version: candidate, snapshot: rebuilt.snapshot };
}

function logReconstructionFailure(fields: {
  siteId: string;
  docPath: string;
  documentId: string;
  branchId: string;
  requestedVersion: number;
  brokenVersion: number | undefined;
}): void {
  getLogger().error(
    'version reconstruction failed',
    new VersionReconstructionError(
      fields.documentId, fields.branchId, fields.requestedVersion, fields.brokenVersion ?? 0,
    ),
    {
      site_id: fields.siteId,
      doc_path: fields.docPath,
      document_id: fields.documentId,
      branch_id: fields.branchId,
      requested_version: fields.requestedVersion,
      broken_version: fields.brokenVersion,
      outcome: 'reconstruction_failed',
    },
  );
}

async function handleGetContent(
  request: Request,
  context: ContentRouteContext,
): Promise<Response> {
  const { siteId, documentPath } = context;

  // Resolve branch
  const branch = await resolveBranch(request, siteId);
  if (branch === null) {
    return notFoundResponse('Branch not found', siteId);
  }

  // Get document by path
  const document = await getDocumentByPath(siteId, documentPath ?? '/', branch.id);
  if (document === null) {
    return notFoundResponse('Document not found', siteId);
  }

  // Main branch: serve only published (checkpoint-captured) content.
  // Non-main branches: serve the latest saved version with fallback to main.
  let version;
  let inherited = false;

  if (branch.isMain) {
    version = await getLatestPublishedDocumentVersion(document.id, branch.id);
    // A deletion supersedes every earlier publish [PCC-3669]. The publish
    // pointer survives deletion (nothing can publish a tombstone), so without
    // this a deleted page stays live forever — and a deleted-then-recreated
    // page would silently resurrect its pre-deletion published content. The
    // page returns only via a fresh publish that postdates the deletion.
    // Deletions arriving on main via merge are covered the same way.
    if (
      version != null
      && await hasTombstoneAfterVersion(document.id, branch.id, version.versionNumber)
    ) {
      return notFoundResponse('Document has been deleted', siteId);
    }
  } else {
    const mainBranch = await getMainBranch(siteId);
    const fallbackResult = mainBranch != null
      ? await getLatestDocumentVersionWithFallback(
        document.id, branch.id, mainBranch.id,
      )
      : null;
    if (fallbackResult != null) {
      version = fallbackResult.version;
      inherited = fallbackResult.inherited;
    } else {
      version = await getLatestDocumentVersion(document.id, branch.id);
    }
  }

  if (version == null) {
    return notFoundResponse('Document not found', siteId);
  }

  // Tombstone check
  if (version.isTombstone === true) {
    return notFoundResponse('Document has been deleted', siteId);
  }

  const [settings, site] = await Promise.all([
    getSiteSettings(siteId),
    getSite(siteId),
  ]);
  const ttl = getEffectiveCacheTtl(settings, branch.isMain);

  // ETag covers the version and the site's last update, since the payload
  // carries site-derived metadata that changes without a version bump
  const etagFor = (versionId: string): string => site === null
    ? `"v-${versionId}"`
    : `"v-${versionId}-s-${String(new Date(site.updatedAt).getTime())}"`;

  const etag = etagFor(version.id);

  const ifNoneMatch = request.headers.get('If-None-Match');
  const cacheTag = contentCacheTags({
    siteId,
    branchId: branch.id,
    documentId: document.id,
  }).join(',');

  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': contentCacheControl(branch.isMain, ttl),
        'Cache-Tag': cacheTag,
        'Vary': 'Accept-Encoding',
      },
    });
  }

  // If snapshot is null (diff-only version), reconstruct from baseline + patches
  let snapshotData = version.snapshot ?? null;
  let servedVersion = version;
  let servedEtag = etag;

  if (snapshotData === null) {
    const replay = await replayVersionChain(document.id, branch.id, version.versionNumber);
    const brokenVersion = replay?.brokenVersion;

    if (replay !== null && brokenVersion === undefined) {
      snapshotData = replay.snapshot;
    } else if (replay !== null && brokenVersion !== undefined) {
      const degraded = await resolveDegradedVersion({
        documentId: document.id,
        branch,
        replay,
      });

      if (degraded === null) {
        // Nothing below the break may be served: it is unpublished, deleted
        // since, or there is no earlier version at all. The route is public, so
        // the response stays generic; the identifiers go to the log.
        logReconstructionFailure({
          siteId,
          docPath: document.path,
          documentId: document.id,
          branchId: branch.id,
          requestedVersion: version.versionNumber,
          brokenVersion,
        });
        return errorResponse('Internal server error', 500);
      }

      snapshotData = degraded.snapshot;
      servedVersion = degraded.version;
      servedEtag = etagFor(degraded.version.id);

      // Serving behind is the degraded outcome, not the failure one: the page
      // stays up and the log carries the row that needs repair.
      getLogger().error(
        'version reconstruction degraded to an earlier version',
        new VersionReconstructionError(
          document.id, branch.id, version.versionNumber, brokenVersion,
        ),
        {
          site_id: siteId,
          doc_path: document.path,
          document_id: document.id,
          branch_id: branch.id,
          requested_version: version.versionNumber,
          broken_version: brokenVersion,
          served_version: degraded.version.versionNumber,
          outcome: 'reconstruction_degraded',
        },
      );

      // The first request taught the client this ETag; without a second
      // comparison it could never validate, because the check above ran
      // against the version that could not be rebuilt.
      if (ifNoneMatch === servedEtag) {
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': servedEtag,
            'Cache-Control': contentCacheControl(branch.isMain, ttl),
            'Cache-Tag': cacheTag,
            'Vary': 'Accept-Encoding',
          },
        });
      }
    }
  }

  const responseBody: PageContent = {
    documentId: document.id,
    metadata: buildPageMetadata(site, settings),
    path: document.path,
    data: snapshotData,
    branchId: branch.id,
    branchName: branch.name,
    isMainBranch: branch.isMain,
    versionNumber: servedVersion.versionNumber,
    versionCreatedAt: servedVersion.createdAt,
    etag: servedEtag,
  };

  if (!branch.isMain) {
    responseBody.inherited = inherited;
  }

  return jsonResponse(
    responseBody,
    200,
    {
      'Cache-Control': contentCacheControl(branch.isMain, ttl),
      'Cache-Tag': cacheTag,
      'ETag': servedEtag,
      'Vary': 'Accept-Encoding',
    },
  );
}

async function handleGetContentPages(
  request: Request,
  context: ContentRouteContext,
): Promise<Response> {
  const { siteId } = context;

  // Resolve branch
  const branch = await resolveBranch(request, siteId);
  if (branch === null) {
    return notFoundResponse('Branch not found', siteId);
  }

  // List documents on this branch
  // For non-main branches, pass mainBranchId to enable copy-on-write fallback
  const mainBranch = branch.isMain ? null : await getMainBranch(siteId);
  const documents = await listDocumentsOnBranch(
    branch.id,
    branch.isMain ? {} : { mainBranchId: mainBranch?.id },
  );

  // Main branch: only include documents with published versions.
  // Non-main branches: include all documents with any saved version.
  const getVersion = branch.isMain
    ? getLatestPublishedDocumentVersion
    : getLatestDocumentVersion;

  const pagesWithVersions = await Promise.all(
    documents.map(async (doc) => {
      const version = await getVersion(doc.id, branch.id);
      if (version === null) return null;
      if (version.isTombstone === true) return null;
      // Main only: a deletion supersedes every earlier publish [PCC-3669] —
      // the same rule the single-page route applies, so this list never
      // links to a path that route would 404.
      if (
        branch.isMain
        && await hasTombstoneAfterVersion(doc.id, branch.id, version.versionNumber)
      ) {
        return null;
      }
      return {
        path: doc.path,
        documentId: doc.id,
        lastModifiedAt: version.createdAt,
      };
    }),
  );

  const pages = pagesWithVersions.filter(
    (p): p is NonNullable<typeof p> => p !== null,
  );

  // Cache TTL: double the page TTL, capped at 300s
  const settings = await getSiteSettings(siteId);
  const pageTtl = getEffectiveCacheTtl(settings, branch.isMain);
  const listTtl = Math.min(pageTtl * 2, 300);

  return jsonResponse(
    {
      pages,
      branchId: branch.id,
      branchName: branch.name,
      isMainBranch: branch.isMain,
    },
    200,
    {
      'Cache-Control': contentCacheControl(branch.isMain, listTtl),
      // No doc tag: publishing any document changes this list, so no single
      // document's tag could invalidate it. list:<siteId> is the listing's
      // dedicated invalidation handle (delete-class purges use it narrowly);
      // the publish purge is still site-wide, which also reaches this.
      'Cache-Tag': listingCacheTags({ siteId, branchId: branch.id }).join(','),
      'Vary': 'Accept-Encoding',
    },
  );
}
