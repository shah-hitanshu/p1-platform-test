/**
 * Template API Routes
 *
 * REST API endpoints for template operations.
 * Templates are stored as documents at _registry/templates/:name
 */

import type { AuthenticatedPrincipal } from '../types';
import type { Env } from '../index';
import { runWithConnection } from '../db';
import {
  createDocumentOnBranch,
  getLatestDocumentVersion,
  listDocumentsOnBranch,
  createDocumentVersion,
  getDocument,
  getBranch,
  getBranchByName,
  deleteDocumentOnBranch,
  documentExistsOnBranch,
  DuplicateDocumentPathError,
} from '../services';
import { assertPermission, getEffectiveRole, AuthorizationError } from '../auth/authorization';
import { query } from '../db';
import {
  triggerMigration,
  processMigration,
  rollbackMigration,
  getMigrationStatus,
  previewMigration,
  TemplateNotFoundError,
  InvalidVersionRangeError,
  MigrationJobNotFoundError,
} from '../services/migration-service';

const VALID_ACTOR_TYPES = new Set(['user', 'agent', 'service']);
const VALID_PRINCIPAL_TYPES = new Set(['user', 'agent', 'system', 'service']);

function toActorType(type: string): 'user' | 'agent' | 'service' {
  if (VALID_ACTOR_TYPES.has(type)) return type as 'user' | 'agent' | 'service';
  throw new Error(`Invalid actor type: ${type}`);
}

function toPrincipalType(type: string): 'user' | 'agent' | 'system' | 'service' {
  if (VALID_PRINCIPAL_TYPES.has(type)) return type as 'user' | 'agent' | 'system' | 'service';
  throw new Error(`Invalid principal type: ${type}`);
}

function createDOReloader(env: Env) {
  return async (siteId: string, branchId: string, documentIds: string[]): Promise<void> => {
    await Promise.allSettled(
      documentIds.map(async (docId) => {
        const sessionId = `${siteId}:${docId}:${branchId}`;
        const doId = env.DOCUMENT_STATE.idFromName(sessionId);
        const stub = env.DOCUMENT_STATE.get(doId);
        await stub.fetch(new Request('http://internal/reload', {
          method: 'POST',
          headers: { 'X-Session-Id': sessionId },
        }));
      }),
    );
  };
}

/**
 * Request context for template routes
 */
export interface TemplateRouteContext {
  siteId: string;
  branchId?: string;
  templateId?: string;
  action?: 'migrate' | 'migrate-preview' | 'rollback' | 'migration-status';
  principal: AuthenticatedPrincipal;
  ctx?: ExecutionContext;
  env?: Env;
}

/**
 * Template structure
 */
interface Template {
  name: string;
  label: string;
  description?: string;
  defaultUrlPattern?: string;
  deprecated?: boolean;
  components: {
    type: string;
    pinned: boolean;
    defaultProps: Record<string, unknown>;
  }[];
}

/**
 * Request body for creating/updating a template
 */
interface TemplateBody {
  name: string;
  label: string;
  description?: string;
  defaultUrlPattern?: string;
  deprecated?: boolean;
  components: {
    type: string;
    pinned: boolean;
    defaultProps: Record<string, unknown>;
  }[];
  puckActions?: {
    type: string;
    [key: string]: unknown;
  }[];
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new InvalidBodyError();
  }
  return json as T;
}

class InvalidBodyError extends Error {
  constructor() { super('Request body must be a JSON object'); }
}

/**
 * JSON response helper
 */
function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Error response helper
 */
function errorResponse(
  error: string,
  status: number,
  details?: unknown,
): Response {
  return jsonResponse({ error, details }, status);
}

/**
 * Extract template name from document path
 */
function extractTemplateName(path: string): string | null {
  const match = /^_registry\/templates\/(.+)$/.exec(path);
  return match?.[1] ?? null;
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/templates - List Templates
 */
async function handleListTemplates(
  branchId: string,
): Promise<Response> {
  const documents = await listDocumentsOnBranch(branchId, {
    pathPrefix: '_registry/templates/',
  });

  const templates = await Promise.all(
    documents.map(async (doc) => {
      const version = await getLatestDocumentVersion(doc.id, branchId);
      const templateName = extractTemplateName(doc.path);

      if (version?.snapshot && templateName !== null) {
        return {
          id: doc.id,
          name: templateName,
          version: version.versionNumber,
          updatedAt: version.createdAt,
          ...version.snapshot as Template,
        };
      }
      return null;
    }),
  );

  return jsonResponse({
    templates: templates.filter((t): t is NonNullable<typeof t> => t !== null),
  });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/templates/{templateId} - Get Template
 */
async function handleGetTemplate(
  templateId: string,
  branchId: string,
): Promise<Response> {
  // Check if template exists
  const document = await getDocument(templateId);
  if (!document) {
    return errorResponse('Template not found', 404);
  }

  // Verify it's actually a template
  if (!document.path.startsWith('_registry/templates/')) {
    return errorResponse('Document is not a template', 400);
  }

  const version = await getLatestDocumentVersion(templateId, branchId);
  if (!version) {
    return errorResponse('Template version not found', 404);
  }

  const templateName = extractTemplateName(document.path);

  return jsonResponse({
    id: document.id,
    name: templateName,
    version: version.versionNumber,
    updatedAt: version.createdAt,
    ...version.snapshot as Template,
  });
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/templates - Create Template
 */
async function handleCreateTemplate(
  request: Request,
  siteId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<TemplateBody>(request);

  // Validate required fields
  if (!body.name || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }
  if (!body.label || body.label.trim() === '') {
    return errorResponse('label is required', 400);
  }
  if (!Array.isArray(body.components)) {
    return errorResponse('components must be an array', 400);
  }

  // Validate template name format (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(body.name)) {
    return errorResponse('Template name must contain only alphanumeric characters, hyphens, and underscores', 400);
  }

  const templatePath = `_registry/templates/${body.name}`;

  // Create template as document
  const result = await createDocumentOnBranch({
    siteId,
    branchId,
    path: templatePath,
    snapshot: body,
    createdById: principal.dbUserId ?? principal.id,
    createdByType: toActorType(principal.type),
  });

  return jsonResponse(
    {
      id: result.document.id,
      name: body.name,
      ...body,
    },
    201,
  );
}

/**
 * Handle PATCH /api/sites/{siteId}/branches/{branchId}/templates/{templateId} - Update Template
 */
async function handleUpdateTemplate(
  request: Request,
  templateId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<Partial<TemplateBody>>(request);

  // Check if template exists
  const exists = await documentExistsOnBranch(templateId, branchId);
  if (!exists) {
    return errorResponse('Template not found', 404);
  }

  const document = await getDocument(templateId);
  if (!document) {
    return errorResponse('Template not found', 404);
  }

  // Verify it's actually a template
  if (!document.path.startsWith('_registry/templates/')) {
    return errorResponse('Document is not a template', 400);
  }

  // Get current version to merge with updates
  const currentVersion = await getLatestDocumentVersion(templateId, branchId);
  if (!currentVersion) {
    return errorResponse('Template version not found', 404);
  }

  const currentTemplate = currentVersion.snapshot as Template;

  // Merge updates with current template
  const updatedTemplate: Template = {
    name: currentTemplate.name, // Name cannot be changed
    label: body.label ?? currentTemplate.label,
    description: body.description ?? currentTemplate.description,
    defaultUrlPattern: body.defaultUrlPattern ?? currentTemplate.defaultUrlPattern,
    deprecated: body.deprecated ?? currentTemplate.deprecated,
    components: body.components ?? currentTemplate.components,
  };

  // Validate components if provided
  if (body.components && !Array.isArray(body.components)) {
    return errorResponse('components must be an array', 400);
  }

  // Create new version
  await createDocumentVersion({
    documentId: templateId,
    branchId,
    snapshot: updatedTemplate,
    source: 'edit',
    createdById: principal.dbUserId ?? principal.id,
    createdByType: toActorType(principal.type),
    puckActions: body.puckActions,
  });

  return jsonResponse({
    id: templateId,
    name: updatedTemplate.name,
    ...updatedTemplate,
  });
}

/**
 * Handle DELETE /api/sites/{siteId}/branches/{branchId}/templates/{templateId} - Delete Template
 */
async function handleDeleteTemplate(
  templateId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  // Check if template exists
  const exists = await documentExistsOnBranch(templateId, branchId);
  if (!exists) {
    return errorResponse('Template not found', 404);
  }

  const document = await getDocument(templateId);
  if (!document) {
    return errorResponse('Template not found', 404);
  }

  // Verify it's actually a template
  if (!document.path.startsWith('_registry/templates/')) {
    return errorResponse('Document is not a template', 400);
  }

  // Check if any documents reference this template
  const refs = await query(
    `SELECT COUNT(*) as count
     FROM app.documents
     WHERE template_id = $1 AND archived_at IS NULL`,
    [templateId],
  );

  const refCount = parseInt(refs.rows[0].count as string, 10);
  if (refCount > 0) {
    return errorResponse(
      'Cannot delete template: ' + String(refCount) + ' document(s) still reference it',
      409,
    );
  }

  await deleteDocumentOnBranch({
    documentId: templateId,
    branchId,
    deletedById: principal.dbUserId ?? principal.id,
    deletedByType: toActorType(principal.type),
  });

  return new Response(null, { status: 204 });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migration-status
 */
async function handleMigrationStatus(
  templateId: string,
  branchId: string,
): Promise<Response> {
  const status = await getMigrationStatus(templateId, branchId);
  return jsonResponse(status);
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migrate/preview
 */
async function handleMigratePreview(
  request: Request,
  siteId: string,
  branchId: string,
  templateId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const detail = url.searchParams.get('detail') === 'true';

  const body = await parseJsonBody<{ fromVersion?: number; toVersion?: number }>(request);

  let toVersion = body.toVersion;
  if (toVersion === undefined) {
    const latest = await getLatestDocumentVersion(templateId, branchId);
    if (!latest) {
      return errorResponse('Template version not found', 404);
    }
    toVersion = latest.versionNumber;
  }

  const fromVersion = body.fromVersion ?? Math.max(toVersion - 1, 0);

  const preview = await previewMigration(siteId, branchId, templateId, fromVersion, toVersion, detail);
  return jsonResponse(preview);
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migrate
 */
async function handleMigrateTemplate(
  request: Request,
  siteId: string,
  branchId: string,
  templateId: string,
  principal: AuthenticatedPrincipal,
  ctx?: ExecutionContext,
  env?: Env,
): Promise<Response> {
  const body = await parseJsonBody<{ fromVersion?: number; toVersion?: number }>(request);

  let toVersion = body.toVersion;
  if (toVersion === undefined) {
    const latest = await getLatestDocumentVersion(templateId, branchId);
    if (!latest) {
      return errorResponse('Template version not found', 404);
    }
    toVersion = latest.versionNumber;
  }

  const fromVersion = body.fromVersion ?? Math.max(toVersion - 1, 0);

  const migrationPrincipal = {
    id: principal.dbUserId ?? principal.id,
    type: toPrincipalType(principal.type),
  };

  const job = await triggerMigration(siteId, branchId, templateId, fromVersion, toVersion, migrationPrincipal);

  // Process migration asynchronously — return the job immediately so the
  // HTTP request doesn't timeout for large document sets.
  // Must wrap in its own runWithConnection because ctx.waitUntil runs after
  // the request's database connection scope has closed.
  const reloadDOs = env ? createDOReloader(env) : undefined;

  if (ctx && env) {
    const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_CONNECTION_STRING ?? '';
    ctx.waitUntil(
      runWithConnection(connectionString, { isHyperdrive: env.HYPERDRIVE !== undefined }, () =>
        processMigration(job.id, reloadDOs),
      ).catch(async (err: unknown) => {
        console.error('Background migration failed:', err);
        try {
          await runWithConnection(connectionString, { isHyperdrive: env.HYPERDRIVE !== undefined }, () =>
            query('UPDATE app.migration_jobs SET status = \'failed\' WHERE id = $1', [job.id]),
          );
        } catch (updateErr: unknown) {
          console.error('Failed to update job status after background failure:', updateErr);
        }
      }),
    );
    return jsonResponse({ job, status: 'processing' }, 202);
  }

  // Fallback for environments without ExecutionContext (tests, local dev without wrangler)
  const result = await processMigration(job.id, reloadDOs);
  return jsonResponse({ job, ...result });
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/rollback
 */
async function handleRollbackTemplate(
  request: Request,
  siteId: string,
  templateId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<{ jobId: string }>(request);

  const migrationPrincipal = {
    id: principal.dbUserId ?? principal.id,
    type: toPrincipalType(principal.type),
  };

  const result = await rollbackMigration(body.jobId, migrationPrincipal, {
    siteId,
    branchId,
    templateId,
  });

  return jsonResponse(result);
}

/**
 * Main route handler for template operations
 */
export async function handleTemplateRequest(
  request: Request,
  context: TemplateRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    if (context.branchId === undefined || context.branchId === '') {
      return errorResponse('Branch ID is required', 400);
    }

    // Resolve branch by UUID or name
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const branch = uuidPattern.test(context.branchId)
      ? await getBranch(context.branchId)
      : await getBranchByName(context.siteId, context.branchId);
    if (branch?.siteId !== context.siteId) {
      return errorResponse('Branch not found', 404);
    }

    const branchId = branch.id;

    // Handle migration-status action
    if (context.action === 'migration-status' && context.templateId !== undefined && context.templateId !== '') {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      await assertPermission(context.principal, context.siteId, branchId, 'canView');
      return await handleMigrationStatus(context.templateId, branchId);
    }

    // Handle migrate-preview action
    if (context.action === 'migrate-preview' && context.templateId !== undefined && context.templateId !== '') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
      if (roleName !== 'ADMIN') {
        throw new AuthorizationError('Template migration preview requires ADMIN role', 'canEditDocuments', roleName);
      }
      return await handleMigratePreview(request, context.siteId, branchId, context.templateId);
    }

    // Handle migrate action
    if (context.action === 'migrate' && context.templateId !== undefined && context.templateId !== '') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      // Check ADMIN role for migration
      const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
      if (roleName !== 'ADMIN') {
        throw new AuthorizationError('Template migration requires ADMIN role', 'canEditDocuments', roleName);
      }
      return await handleMigrateTemplate(
        request, context.siteId, branchId, context.templateId,
        context.principal, context.ctx, context.env,
      );
    }

    // Handle rollback action
    if (context.action === 'rollback' && context.templateId !== undefined && context.templateId !== '') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      // Check ADMIN role for rollback
      const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
      if (roleName !== 'ADMIN') {
        throw new AuthorizationError('Template rollback requires ADMIN role', 'canEditDocuments', roleName);
      }
      return await handleRollbackTemplate(request, context.siteId, context.templateId, branchId, context.principal);
    }

    // Authorization for standard CRUD operations
    if (method === 'GET') {
      await assertPermission(context.principal, context.siteId, branchId, 'canView');
    } else if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      if (context.principal.type === 'service') {
        await assertPermission(context.principal, context.siteId, branchId, 'canEditDocuments');
      } else {
        const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
        if (roleName !== 'ADMIN') {
          throw new AuthorizationError('Template write operations require ADMIN role', 'canEditDocuments', roleName);
        }
      }
    }

    // Routes with templateId
    if (context.templateId !== undefined && context.templateId !== '') {
      switch (method) {
        case 'GET':
          return await handleGetTemplate(context.templateId, branchId);
        case 'PATCH':
          return await handleUpdateTemplate(request, context.templateId, branchId, context.principal);
        case 'DELETE':
          return await handleDeleteTemplate(context.templateId, branchId, context.principal);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Collection routes
    switch (method) {
      case 'GET':
        return await handleListTemplates(branchId);
      case 'POST':
        return await handleCreateTemplate(request, context.siteId, branchId, context.principal);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof InvalidBodyError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    if (error instanceof InvalidVersionRangeError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof TemplateNotFoundError) {
      return errorResponse(error.message, 404);
    }
    if (error instanceof MigrationJobNotFoundError) {
      return errorResponse(error.message, 404);
    }
    if (error instanceof DuplicateDocumentPathError) {
      return errorResponse('Template already exists at this path', 409);
    }

    if (error instanceof SyntaxError) {
      return errorResponse('Invalid JSON in request body', 400);
    }

    // Log and return generic error for unknown errors
    console.error('Template API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
