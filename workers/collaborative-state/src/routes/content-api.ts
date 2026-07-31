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
  listDocumentsOnBranch,
  reconstructVersionSnapshot,
  VersionReconstructionError,
  buildPageMetadata,
  getSite,
} from '../services';
import {
  getSiteSettings,
  getEffectiveCacheTtl,
} from '../services/site-settings-service';

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

import { UUID_RE } from '../utils/branch-ref';
import type { PageContent } from '../types/page-metadata';

/**
 * Resolve the branch from query param or default to main branch.
 * Accepts either a branch UUID or a branch name.
 */
async function resolveBranch(
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
    console.error('Content API error:', error);
    return errorResponse('Internal server error', 500);
  }
}

async function handleGetContent(
  request: Request,
  context: ContentRouteContext,
): Promise<Response> {
  const { siteId, documentPath } = context;

  // Resolve branch
  const branch = await resolveBranch(request, siteId);
  if (branch === null) {
    return errorResponse('Branch not found', 404);
  }

  // Get document by path
  const document = await getDocumentByPath(siteId, documentPath ?? '/');
  if (document === null) {
    return errorResponse('Document not found', 404);
  }

  // Main branch: serve only published (checkpoint-captured) content.
  // Non-main branches: serve the latest saved version with fallback to main.
  let version;
  let inherited = false;

  if (branch.isMain) {
    version = await getLatestPublishedDocumentVersion(document.id, branch.id);
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
    return errorResponse('Document not found', 404);
  }

  // Tombstone check
  if (version.isTombstone === true) {
    return errorResponse('Document has been deleted', 404);
  }

  const [settings, site] = await Promise.all([
    getSiteSettings(siteId),
    getSite(siteId),
  ]);
  const ttl = getEffectiveCacheTtl(settings, branch.isMain);

  // ETag covers the version and the site's last update, since the payload
  // carries site-derived metadata that changes without a version bump
  const etag = site === null
    ? `"v-${version.id}"`
    : `"v-${version.id}-s-${String(new Date(site.updatedAt).getTime())}"`;

  const ifNoneMatch = request.headers.get('If-None-Match');

  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': `public, s-maxage=${String(ttl)}, stale-while-revalidate=${String(ttl * 5)}`,
        'Vary': 'Accept-Encoding',
      },
    });
  }

  // If snapshot is null (diff-only version), reconstruct from baseline + patches
  let snapshotData = version.snapshot ?? null;
  if (snapshotData === null) {
    try {
      snapshotData = await reconstructVersionSnapshot(
        document.id,
        branch.id,
        version.versionNumber,
      );
    } catch (error) {
      if (!(error instanceof VersionReconstructionError)) throw error;
      // The route is public, so the response stays generic; the identifiers
      // that pin down which version broke go to the log.
      console.error('[content-api] Version reconstruction failed', {
        documentId: error.documentId,
        branchId: error.branchId,
        requestedVersion: error.requestedVersion,
        brokenVersion: error.brokenVersion,
      });
      return errorResponse('Internal server error', 500);
    }
  }

  const responseBody: PageContent = {
    documentId: document.id,
    metadata: buildPageMetadata(site),
    path: document.path,
    data: snapshotData,
    branchId: branch.id,
    branchName: branch.name,
    isMainBranch: branch.isMain,
    versionNumber: version.versionNumber,
    versionCreatedAt: version.createdAt,
    etag,
  };

  if (!branch.isMain) {
    responseBody.inherited = inherited;
  }

  return jsonResponse(
    responseBody,
    200,
    {
      'Cache-Control': `public, s-maxage=${String(ttl)}, stale-while-revalidate=${String(ttl * 5)}`,
      'ETag': etag,
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
    return errorResponse('Branch not found', 404);
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
      'Cache-Control': `public, s-maxage=${String(listTtl)}, stale-while-revalidate=${String(listTtl * 5)}`,
      'Vary': 'Accept-Encoding',
    },
  );
}
