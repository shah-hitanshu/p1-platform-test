import type { AuthenticatedPrincipal, RedirectSnapshot } from '../types';
import { REDIRECTS_PATH_PREFIX, readRedirectSnapshot } from '../types';
import {
  getMainBranch,
  getDocumentByPath,
  getLatestDocumentVersion,
} from '../services';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

export interface ContentRedirectRouteContext {
  siteId: string;
  documentPath?: string;
  principal: AuthenticatedPrincipal;
}

async function resolveRedirect(
  siteId: string,
  mainBranchId: string,
  lookupPath: string,
): Promise<{ snapshot: RedirectSnapshot; computedDestination: string } | null> {
  const docPath = `${REDIRECTS_PATH_PREFIX}${lookupPath}`;
  const redirectDoc = await getDocumentByPath(siteId, docPath);

  // [claude] The single most useful line here: it separates "no redirect document at
  // this path at all" (wrong prefix / migration 053 never ran / wrong site) from
  // "document exists but carries no readable version on main" (never merged).
  getLogger().info('redirect lookup: exact-path probe', {
    site_id: siteId,
    lookup_path: lookupPath,
    doc_path: docPath,
    path_prefix: REDIRECTS_PATH_PREFIX,
    main_branch_id: mainBranchId,
    outcome: redirectDoc === null ? 'no_document' : 'document_found',
    document_id: redirectDoc?.id,
  });

  if (redirectDoc !== null) {
    const version = await getLatestDocumentVersion(redirectDoc.id, mainBranchId);
    const snapshot = readRedirectSnapshot(version?.snapshot);

    getLogger().info('redirect lookup: exact-path version read', {
      site_id: siteId,
      doc_path: docPath,
      document_id: redirectDoc.id,
      main_branch_id: mainBranchId,
      version_id: version?.id,
      outcome:
        version === null
          ? 'no_version_on_main'
          : snapshot === null
            ? 'version_not_a_redirect_snapshot'
            : 'resolved',
      from_path: snapshot?.fromPath,
      destination: snapshot?.destination,
      redirect_type: snapshot?.redirectType,
      parenting: snapshot?.parenting,
    });

    if (snapshot !== null) {
      return { snapshot, computedDestination: snapshot.destination };
    }
    return null;
  }

  const segments = lookupPath.split('/');
  const ancestors: { parentPath: string; childSuffix: string }[] = [];
  for (let i = segments.length - 1; i >= 1; i--) {
    ancestors.push({
      parentPath: segments.slice(0, i).join('/'),
      childSuffix: segments.slice(i).join('/'),
    });
  }

  const results = await Promise.all(
    ancestors.map(async ({ parentPath, childSuffix }) => {
      const parentDoc = await getDocumentByPath(siteId, `${REDIRECTS_PATH_PREFIX}${parentPath}`);
      if (parentDoc === null) return null;
      const parentVersion = await getLatestDocumentVersion(parentDoc.id, mainBranchId);
      const parentSnapshot = readRedirectSnapshot(parentVersion?.snapshot);
      if (parentSnapshot?.parenting !== true) return null;
      const dest = parentSnapshot.destination.replace(/\/+$/, '');
      return { snapshot: parentSnapshot, computedDestination: `${dest}/${childSuffix}` };
    }),
  );

  const match = results.find((r): r is NonNullable<typeof r> => r !== null) ?? null;

  // [claude] Ancestor (parenting) fallback. `count` is how many ancestor paths were
  // probed — zero means the lookup path had no parent segments to walk.
  getLogger().info('redirect lookup: ancestor fallback', {
    site_id: siteId,
    lookup_path: lookupPath,
    main_branch_id: mainBranchId,
    count: ancestors.length,
    outcome: match === null ? 'no_match' : 'resolved',
    destination: match?.computedDestination,
  });

  return match;
}

export async function handleContentRedirectRoutes(
  request: Request,
  context: ContentRedirectRouteContext,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  // [claude] Entry line. Proves the request reached this worker at all, and with which
  // site — a mismatch here means the site is pointed somewhere unexpected.
  getLogger().info('content-redirect request', {
    site_id: context.siteId,
    lookup_path: context.documentPath ?? '',
    principal_type: context.principal.type,
    'http.request.method': request.method,
    'http.route': '/api/sites/:siteId/content-redirects/:path',
  });

  try {
    const mainBranch = await getMainBranch(context.siteId);
    if (mainBranch === null) {
      getLogger().warn('content-redirect: site has no main branch', {
        site_id: context.siteId,
        outcome: 'no_main_branch',
        'http.response.status_code': 404,
      });
      return errorResponse('Not found', 404);
    }

    const lookupPath = context.documentPath ?? '';
    const result = await resolveRedirect(context.siteId, mainBranch.id, lookupPath);

    if (result === null) {
      getLogger().info('content-redirect: no redirect', {
        site_id: context.siteId,
        lookup_path: lookupPath,
        main_branch_id: mainBranch.id,
        outcome: 'no_redirect',
        'http.response.status_code': 404,
      });
      return errorResponse('No redirect found', 404);
    }

    const statusCode = result.snapshot.redirectType === 'temporary' ? 302 : 301;

    getLogger().info('content-redirect: resolved', {
      site_id: context.siteId,
      lookup_path: lookupPath,
      main_branch_id: mainBranch.id,
      from_path: result.snapshot.fromPath,
      destination: result.computedDestination,
      redirect_type: result.snapshot.redirectType,
      parenting: result.snapshot.parenting,
      outcome: 'resolved',
      'http.response.status_code': 200,
    });

    return jsonResponse({
      fromPath: result.snapshot.fromPath,
      destination: result.computedDestination,
      redirectType: result.snapshot.redirectType,
      parenting: result.snapshot.parenting,
      statusCode,
    });
  } catch (error) {
    getLogger().error('content-redirect: unhandled error', error, {
      site_id: context.siteId,
      lookup_path: context.documentPath ?? '',
      outcome: 'error',
      'http.response.status_code': 500,
    });
    console.error('Content redirect API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
