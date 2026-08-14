import type { AuthenticatedPrincipal, RedirectSnapshot } from '../types';
import { REDIRECTS_PATH_PREFIX, readRedirectSnapshot } from '../types';
import {
  getMainBranch,
  getDocumentByPath,
  getLatestDocumentVersion,
} from '../services';
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
  const redirectDoc = await getDocumentByPath(siteId, `${REDIRECTS_PATH_PREFIX}${lookupPath}`);
  if (redirectDoc !== null) {
    const version = await getLatestDocumentVersion(redirectDoc.id, mainBranchId);
    const snapshot = readRedirectSnapshot(version?.snapshot);
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

  return results.find((r): r is NonNullable<typeof r> => r !== null) ?? null;
}

export async function handleContentRedirectRoutes(
  request: Request,
  context: ContentRedirectRouteContext,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const mainBranch = await getMainBranch(context.siteId);
    if (mainBranch === null) {
      return errorResponse('Not found', 404);
    }

    const lookupPath = context.documentPath ?? '';
    const result = await resolveRedirect(context.siteId, mainBranch.id, lookupPath);

    if (result === null) {
      return errorResponse('No redirect found', 404);
    }

    const statusCode = result.snapshot.redirectType === 'temporary' ? 302 : 301;

    return jsonResponse({
      fromPath: result.snapshot.fromPath,
      destination: result.computedDestination,
      redirectType: result.snapshot.redirectType,
      parenting: result.snapshot.parenting,
      statusCode,
    });
  } catch (error) {
    console.error('Content redirect API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
