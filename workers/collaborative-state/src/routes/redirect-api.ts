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
import { getLogger } from '@pantheon-systems/p1-telemetry';
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

  const visible = redirects.filter((r): r is NonNullable<typeof r> => r !== null);

  // [claude] What the dashboard's Redirects panel is actually reading. `count` vs
  // `documents.length` separates "no redirect documents on this branch" from "documents
  // exist but their versions don't parse as redirect snapshots".
  getLogger().info('redirects listed', {
    branch_id: branchId,
    path_prefix: REDIRECTS_PATH_PREFIX,
    count: visible.length,
    outcome: documents.length === visible.length ? 'all_readable' : 'some_unreadable',
    reason:
      documents.length === visible.length
        ? undefined
        : `${String(documents.length)} documents on branch`,
  });

  return jsonResponse({ redirects: visible });
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
    getLogger().warn('redirect create rejected: live page occupies origin', {
      site_id: siteId,
      branch_id: branchId,
      doc_path: originPath,
      from_path: normalizedFromPath,
      outcome: 'rejected',
      reason: 'live_page_occupies',
      'http.response.status_code': 409,
    });
    return errorResponse('A page already exists at this origin path', 409);
  }

  const snapshot: RedirectSnapshot = {
    fromPath: normalizedFromPath,
    destination,
    redirectType,
    parenting,
  };

  const documentPath = `${REDIRECTS_PATH_PREFIX}${originPath}`;
  const result = await createDocumentOnBranch({
    siteId,
    branchId,
    path: documentPath,
    snapshot: { ...snapshot },
    createdById: principal.dbUserId ?? principal.id,
    createdByType: toDocumentActorType(principal.type),
  });

  // [claude] The write half of the puzzle: the exact document path a redirect was
  // stored at, and the branch it landed on. Compare `doc_path` here against the
  // `doc_path` the resolver probes, and `branch_id` here against its `main_branch_id`
  // — a redirect that resolves nowhere is almost always one of those two disagreeing.
  getLogger().info('redirect created', {
    site_id: siteId,
    branch_id: branchId,
    document_id: result.document.id,
    version_id: result.version.id,
    doc_path: documentPath,
    path_prefix: REDIRECTS_PATH_PREFIX,
    from_path: snapshot.fromPath,
    destination: snapshot.destination,
    redirect_type: snapshot.redirectType,
    parenting: snapshot.parenting,
    principal_type: principal.type,
    outcome: 'created',
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
    // [claude] A rename moves the document, so the path the resolver probes changes.
    getLogger().info('redirect path renamed', {
      site_id: siteId,
      branch_id: branchId,
      redirect_id: redirectId,
      doc_path: `${REDIRECTS_PATH_PREFIX}${newFromPath}`,
      reason: 'from_path_changed',
    });
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

  getLogger().info('redirect updated', {
    site_id: siteId,
    branch_id: branchId,
    redirect_id: redirectId,
    document_id: redirectId,
    version_id: version.id,
    doc_path: document.path,
    from_path: updatedSnapshot.fromPath,
    destination: updatedSnapshot.destination,
    redirect_type: updatedSnapshot.redirectType,
    parenting: updatedSnapshot.parenting,
    principal_type: principal.type,
    outcome: 'updated',
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

  // [claude] Deletion only tombstones per branch, so the document row survives. Worth
  // seeing when a redirect looks deleted in the dashboard but still resolves elsewhere.
  getLogger().info('redirect deleted', {
    site_id: siteId,
    branch_id: branchId,
    redirect_id: redirectId,
    document_id: redirectId,
    doc_path: document.path,
    principal_type: principal.type,
    outcome: 'deleted',
  });

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

    // [claude] The heart of it: writes are branch-scoped, but the live site resolves
    // redirects against main only. When `resolved_via` is 'workstream' the redirect will
    // not fire on the live site until the workstream is published.
    // Costs one extra query per redirect API call — temporary, remove with these logs.
    const mainBranchForLog = await getMainBranch(context.siteId);
    getLogger().info('redirect api request', {
      site_id: context.siteId,
      branch_id: branchId,
      main_branch_id: mainBranchForLog?.id,
      redirect_id: context.redirectId,
      principal_type: context.principal.type,
      resolved_via: mainBranchForLog?.id === branchId ? 'main' : 'workstream',
      'http.request.method': method,
      'http.route': '/api/sites/:siteId/branches/:branchId/redirects',
    });

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
