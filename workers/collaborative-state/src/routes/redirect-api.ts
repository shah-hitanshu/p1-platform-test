import type { AuthenticatedPrincipal, RedirectSnapshot, RedirectType } from '../types';
import {
  REDIRECTS_PATH_PREFIX,
  isRedirectBody,
  isValidRedirectType,
  readRedirectSnapshot,
  toDocumentActorType,
} from '../types';
import {
  createDocumentOnBranch,
  listDocumentsOnBranch,
  getDocument,
  getMainBranch,
  getLatestDocumentVersion,
  createDocumentVersion,
  deleteDocumentOnBranch,
  getDocumentByPath,
  updateDocumentPath,
  DuplicateDocumentPathError,
} from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

function stripTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end--;
  return end === 0 ? '/' : path.slice(0, end);
}

const MAX_REDIRECT_PATH_LENGTH = 1024;

/**
 * True when a page still renders at `pagePath` on this branch, so a redirect
 * from it would shadow reachable content.
 *
 * Two reasons the app.documents row alone can't answer this: deleting a page
 * only tombstones it per branch and leaves the row behind — rejecting on the row
 * would refuse a redirect for exactly the page most redirects are written for —
 * and a page untouched on a workstream has no version there at all, yet still
 * renders inherited from main. Registry documents never count: they aren't routable.
 */
async function livePageOccupies(
  siteId: string,
  branchId: string,
  pagePath: string,
): Promise<boolean> {
  const existing = await getDocumentByPath(siteId, pagePath);
  if (existing === null) return false;
  if (existing.path.startsWith('_registry/')) return false;

  const local = await getLatestDocumentVersion(existing.id, branchId);
  if (local !== null) return local.isTombstone !== true;

  // Main's latest version, not its latest published one: an unpublished page
  // would otherwise read as absent, and the redirect written over it would
  // shadow the page the moment it went live.
  const mainBranch = await getMainBranch(siteId);
  if (mainBranch === null || mainBranch.id === branchId) return false;
  const inherited = await getLatestDocumentVersion(existing.id, mainBranch.id);
  return inherited !== null && inherited.isTombstone !== true;
}

export interface RedirectRouteContext {
  siteId: string;
  branchId?: string;
  redirectId?: string;
  principal: AuthenticatedPrincipal;
}

interface InvalidParam {
  name: string;
  message: string;
}

function validationErrorResponse(invalidParams: InvalidParam[]): Response {
  return jsonResponse({ error: 'Validation failed', invalidParams }, 400);
}

async function handleListRedirects(branchId: string): Promise<Response> {
  const documents = await listDocumentsOnBranch(branchId, {
    pathPrefix: REDIRECTS_PATH_PREFIX,
  });

  const redirects = await Promise.all(
    documents.map(async (doc) => {
      const version = await getLatestDocumentVersion(doc.id, branchId);
      if (!version) return null;
      const snapshot = readRedirectSnapshot(version.snapshot);
      if (snapshot === null) return null;
      return {
        id: doc.id,
        fromPath: snapshot.fromPath,
        destination: snapshot.destination,
        redirectType: snapshot.redirectType,
        parenting: snapshot.parenting,
        updatedAt: version.createdAt,
      };
    }),
  );

  return jsonResponse({
    redirects: redirects.filter((r): r is NonNullable<typeof r> => r !== null),
  });
}

async function handleGetRedirect(
  redirectId: string,
  branchId: string,
  siteId: string,
): Promise<Response> {
  const document = await getDocument(redirectId);
  if (!document) {
    return errorResponse('Redirect not found', 404);
  }

  if (document.siteId !== siteId) {
    return errorResponse('Redirect not found', 404);
  }

  if (!document.path.startsWith(REDIRECTS_PATH_PREFIX)) {
    return errorResponse('Document is not a redirect', 400);
  }

  const version = await getLatestDocumentVersion(redirectId, branchId);
  if (!version) {
    return errorResponse('Redirect version not found', 404);
  }

  const snapshot = readRedirectSnapshot(version.snapshot);
  if (snapshot === null) {
    return errorResponse('Redirect version not found', 404);
  }
  return jsonResponse({
    id: document.id,
    fromPath: snapshot.fromPath,
    destination: snapshot.destination,
    redirectType: snapshot.redirectType,
    parenting: snapshot.parenting,
    updatedAt: version.createdAt,
  });
}

async function handleCreateRedirect(
  request: Request,
  siteId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body: unknown = await request.json();

  if (!isRedirectBody(body)) {
    return errorResponse('Invalid request body shape', 400);
  }

  const errors: InvalidParam[] = [];

  if (body.fromPath === undefined || body.fromPath === '') {
    errors.push({ name: 'fromPath', message: 'fromPath is required' });
  } else {
    if (body.fromPath.length > MAX_REDIRECT_PATH_LENGTH) {
      errors.push({ name: 'fromPath', message: 'fromPath exceeds maximum length' });
    }
    if (body.fromPath.trim() === '') {
      errors.push({ name: 'fromPath', message: 'fromPath must not be blank' });
    }
    if (!body.fromPath.startsWith('/')) {
      errors.push({ name: 'fromPath', message: 'fromPath must start with /' });
    }
  }

  if (body.destination === undefined || body.destination.trim() === '') {
    errors.push({ name: 'destination', message: 'destination is required' });
  }

  if (body.redirectType !== undefined && !isValidRedirectType(body.redirectType)) {
    errors.push({ name: 'redirectType', message: 'redirectType must be permanent or temporary' });
  }

  if (errors.length > 0) {
    return validationErrorResponse(errors);
  }

  // Both are guaranteed present by the checks above; re-reading them through a
  // guard narrows the types without an assertion.
  const { fromPath, destination } = body;
  if (fromPath === undefined || destination === undefined) {
    return errorResponse('Invalid request body shape', 400);
  }

  const normalizedFromPath = stripTrailingSlashes(fromPath) || '/';
  if (normalizedFromPath === '/') {
    return validationErrorResponse([{ name: 'fromPath', message: 'fromPath must not be the root path' }]);
  }

  // Validated above, so anything not a known type here is absent, not invalid.
  const redirectType: RedirectType = isValidRedirectType(body.redirectType)
    ? body.redirectType
    : 'permanent';
  const parenting = body.parenting ?? false;
  const originPath = normalizedFromPath.slice(1);

  if (await livePageOccupies(siteId, branchId, originPath)) {
    return errorResponse('A page already exists at this origin path', 409);
  }

  const snapshot: RedirectSnapshot = {
    fromPath: normalizedFromPath,
    destination,
    redirectType,
    parenting,
  };

  const result = await createDocumentOnBranch({
    siteId,
    branchId,
    path: `${REDIRECTS_PATH_PREFIX}${originPath}`,
    snapshot: { ...snapshot },
    createdById: principal.dbUserId ?? principal.id,
    createdByType: toDocumentActorType(principal.type),
  });

  return jsonResponse(
    {
      id: result.document.id,
      fromPath: snapshot.fromPath,
      destination: snapshot.destination,
      redirectType: snapshot.redirectType,
      parenting: snapshot.parenting,
      updatedAt: result.version.createdAt,
    },
    201,
  );
}

async function handleUpdateRedirect(
  request: Request,
  redirectId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
  siteId: string,
): Promise<Response> {
  const [document, currentVersion] = await Promise.all([
    getDocument(redirectId),
    getLatestDocumentVersion(redirectId, branchId),
  ]);

  if (!document) {
    return errorResponse('Redirect not found', 404);
  }

  if (document.siteId !== siteId) {
    return errorResponse('Redirect not found', 404);
  }

  if (!document.path.startsWith(REDIRECTS_PATH_PREFIX)) {
    return errorResponse('Document is not a redirect', 400);
  }

  if (!currentVersion) {
    return errorResponse('Redirect version not found', 404);
  }

  const currentSnapshot = readRedirectSnapshot(currentVersion.snapshot);
  if (currentSnapshot === null) {
    return errorResponse('Redirect version not found', 404);
  }
  const body: unknown = await request.json();

  if (!isRedirectBody(body)) {
    return errorResponse('Invalid request body shape', 400);
  }

  const errors: InvalidParam[] = [];

  if (body.fromPath !== undefined) {
    if (body.fromPath.length > MAX_REDIRECT_PATH_LENGTH) {
      errors.push({ name: 'fromPath', message: 'fromPath exceeds maximum length' });
    }
    if (body.fromPath.trim() === '') {
      errors.push({ name: 'fromPath', message: 'fromPath must not be empty' });
    }
    if (!body.fromPath.startsWith('/')) {
      errors.push({ name: 'fromPath', message: 'fromPath must start with /' });
    }
  }

  if (body.destination?.trim() === '') {
    errors.push({ name: 'destination', message: 'destination must not be empty' });
  }

  if (body.redirectType !== undefined && !isValidRedirectType(body.redirectType)) {
    errors.push({ name: 'redirectType', message: 'redirectType must be permanent or temporary' });
  }

  if (errors.length > 0) {
    return validationErrorResponse(errors);
  }

  let normalizedFromPath: string | undefined;
  let newFromPath: string | undefined;
  if (body.fromPath !== undefined) {
    normalizedFromPath = stripTrailingSlashes(body.fromPath) || '/';
    if (normalizedFromPath === '/') {
      return validationErrorResponse([{ name: 'fromPath', message: 'fromPath must not be the root path' }]);
    }

    newFromPath = normalizedFromPath.slice(1);
    if (await livePageOccupies(siteId, branchId, newFromPath)) {
      return errorResponse('A page already exists at this path', 409);
    }
  }

  const resolvedRedirectType: RedirectType = isValidRedirectType(body.redirectType)
    ? body.redirectType
    : currentSnapshot.redirectType;
  const updatedSnapshot: RedirectSnapshot = {
    fromPath: normalizedFromPath ?? currentSnapshot.fromPath,
    destination: body.destination ?? currentSnapshot.destination,
    redirectType: resolvedRedirectType,
    parenting: body.parenting ?? currentSnapshot.parenting,
  };

  if (newFromPath !== undefined) {
    await updateDocumentPath(redirectId, `${REDIRECTS_PATH_PREFIX}${newFromPath}`);
  }

  const version = await createDocumentVersion({
    documentId: redirectId,
    branchId,
    snapshot: { ...updatedSnapshot },
    source: 'edit',
    createdById: principal.dbUserId ?? principal.id,
    createdByType: toDocumentActorType(principal.type),
  });

  return jsonResponse({
    id: redirectId,
    fromPath: updatedSnapshot.fromPath,
    destination: updatedSnapshot.destination,
    redirectType: updatedSnapshot.redirectType,
    parenting: updatedSnapshot.parenting,
    updatedAt: version.createdAt,
  });
}

async function handleDeleteRedirect(
  redirectId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
  siteId: string,
): Promise<Response> {
  const document = await getDocument(redirectId);
  if (!document) {
    return errorResponse('Redirect not found', 404);
  }

  if (document.siteId !== siteId) {
    return errorResponse('Redirect not found', 404);
  }

  if (!document.path.startsWith(REDIRECTS_PATH_PREFIX)) {
    return errorResponse('Document is not a redirect', 400);
  }

  await deleteDocumentOnBranch({
    documentId: redirectId,
    branchId,
    deletedById: principal.dbUserId ?? principal.id,
    deletedByType: toDocumentActorType(principal.type),
  });

  return new Response(null, { status: 204 });
}

export async function handleRedirectRoutes(
  request: Request,
  context: RedirectRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    if (context.branchId === undefined || context.branchId === '') {
      return errorResponse('Branch ID is required', 400);
    }

    const branchId = context.branchId;

    if (method === 'GET') {
      await assertPermission(context.principal, context.siteId, branchId, 'canView');
    } else if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      await assertPermission(context.principal, context.siteId, branchId, 'canEdit');
    } else {
      return errorResponse('Method not allowed', 405);
    }

    if (context.redirectId !== undefined) {
      switch (method) {
        case 'GET':
          return await handleGetRedirect(context.redirectId, branchId, context.siteId);
        case 'PATCH':
          return await handleUpdateRedirect(request, context.redirectId, branchId, context.principal, context.siteId);
        case 'DELETE':
          return await handleDeleteRedirect(context.redirectId, branchId, context.principal, context.siteId);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    switch (method) {
      case 'GET':
        return await handleListRedirects(branchId);
      case 'POST':
        return await handleCreateRedirect(request, context.siteId, branchId, context.principal);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    if (error instanceof DuplicateDocumentPathError) {
      return errorResponse('A redirect already exists for this fromPath', 409);
    }
    if (error instanceof SyntaxError) {
      return errorResponse('Invalid JSON in request body', 400);
    }
    console.error('Redirect API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
