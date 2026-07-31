/**
 * Route Dispatch
 *
 * Maps parsed route handlers to their corresponding route handler functions.
 * Extracted from index.ts to reduce file size and improve maintainability.
 */

import type { AuthenticatedPrincipal } from '../types';
import type { Env } from '../env';
import type { RouteParams } from './route-parser';
import type { MASClient } from '../services/mas-client';

// Route handlers
import { handleSiteRoutes } from './site-api';
import { handleSiteScreenshotRoutes } from './site-screenshot-api';
import { handleBranchRoutes } from './branch-api';
import { handleDocumentRoutes } from './document-api';
import { handleCheckpointRoutes } from './checkpoint-api';
import { handleTemplateRequest } from './template-api';
import { handleRedirectRoutes } from './redirect-api';
import { handleContentRedirectRoutes } from './redirect-content-api';
import { handleMigrationRoutes } from './migration-api';
import { handleMergeRoutes } from './merge-api';
import { handleGrantRoutes } from './grant-api';
import { handleCollaboratorRoutes } from './collaborator-api';
import { handleUsersRoutes } from './users-api';
import { handleStructureRoutes } from './structure-api';
import { handleNodeRoutes } from './node-api';
import { handleMetadataRoutes } from './metadata-api';
import { handleRealtimeRoutes } from './realtime-api';
import { handlePresenceRoutes } from './presence-api';
import { handleSiteTokenRoutes } from './site-token-api';
import { handleAgentKeyRoutes } from './agent-key-api';
import { handleAgentRoutes } from './agent-api';
import { handleAgentRoleRoutes } from './agent-role-api';
import { handleSiteAgentRoleRoutes } from './site-agent-role-api';
import { handleSiteSettingsRoutes } from './site-settings-api';
import { handleContentRoutes } from './content-api';
import { handleSiteExportRoute } from './site-export-api';
import { handleSiteImportRoute } from './site-import-api';
import { handleDatasourceRoutes } from './datasource-api';
import { handleQueryRoutes } from './query-api';
import { handleBackfillDatasources } from './backfill-datasources-api';
import { getMainBranch } from '../services/branch-service';
import { errorResponse } from '../utils/http-helpers';
import { resolveBranchRef } from '../utils/branch-ref';

/**
 * Dispatch a parsed route to the appropriate handler.
 * Contains the switch-case logic that maps route handler names to
 * their corresponding route handler functions.
 */
export async function dispatchRoute(
  request: Request,
  route: { handler: string; params: RouteParams },
  principal: AuthenticatedPrincipal,
  env: Env,
  masClient: MASClient | undefined,
  ctx?: ExecutionContext,
): Promise<Response> {
  // Resolve branch name → UUID before dispatching to handlers.
  // Content handler manages its own resolution via query param.
  if (route.params.branchId !== undefined && route.handler !== 'content') {
    const siteId = route.params.siteId ?? '';
    const result = await resolveBranchRef(siteId, route.params.branchId);
    if (!result.resolved) {
      return errorResponse(result.error, 404);
    }
    route.params.branchId = result.branchId;
  }

  switch (route.handler) {
    case 'site-settings':
      return await handleSiteSettingsRoutes(request, {
        siteId: route.params.siteId,
        principal,
      });

    case 'content':
      return await handleContentRoutes(request, {
        siteId: route.params.siteId ?? '',
        documentPath: route.params.documentPath,
        action: route.params.action as 'content' | 'content-pages',
        principal,
      });

    case 'site-tokens':
      return await handleSiteTokenRoutes(request, {
        siteId: route.params.siteId,
        tokenId: route.params.tokenId,
        principal,
      });

    case 'sites':
      return await handleSiteRoutes(request, {
        siteId: route.params.siteId,
        action: route.params.action,
        principal,
      }, env);

    case 'site-export':
      return await handleSiteExportRoute(request, {
        siteId: route.params.siteId,
        principal,
      }, env);

    case 'site-import':
      if (env.INTERNAL_SECRET === undefined || env.INTERNAL_SECRET === '') {
        return errorResponse('Bundle signature verification is not available on this server', 503);
      }
      return await handleSiteImportRoute(request, {
        siteId: route.params.siteId,
        principal,
      }, { CONFIG_KV: env.CONFIG_KV, INTERNAL_SECRET: env.INTERNAL_SECRET });

    case 'site-screenshot':
      return await handleSiteScreenshotRoutes(request, {
        siteId: route.params.siteId,
        principal,
      }, env);

    case 'branches':
      return await handleBranchRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        action: route.params.action,
        principal,
      });

    case 'documents': {
      const response = await handleDocumentRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        documentId: route.params.documentId,
        documentPath: route.params.documentPath,
        action: route.params.action as 'restore' | 'publish' | undefined,
        versionsPath: route.params.versionsPath === 'true',
        versionAction: route.params.versionAction as 'latest' | 'by-id' | undefined,
        versionId: route.params.versionId,
        principal,
      });

      // After a successful publish, notify the main branch DO to reload
      if (
        route.params.action === 'publish' &&
        response.status === 200 &&
        route.params.documentId !== undefined &&
        route.params.siteId !== undefined
      ) {
        try {
          const mainBranch = await getMainBranch(route.params.siteId);
          if (mainBranch !== null) {
            const sessionId = `${route.params.siteId}:${route.params.documentId}:${mainBranch.id}`;
            const doId = env.DOCUMENT_STATE.idFromName(sessionId);
            const stub = env.DOCUMENT_STATE.get(doId);
            await stub.fetch(new Request('http://internal/reload', {
              method: 'POST',
              headers: { 'X-Session-Id': sessionId },
            }));
          }
        } catch (reloadError) {
          console.error('Failed to reload DO after publish:', reloadError);
        }
      }
      return response;
    }

    case 'migrations':
      return await handleMigrationRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        jobId: route.params.migrationJobId,
        conflictId: route.params.conflictId,
        action: route.params.action as 'conflicts' | 'resolve' | undefined,
        principal,
      });

    case 'templates':
      return await handleTemplateRequest(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        templateId: route.params.templateId,
        action: route.params.action as 'migrate' | 'rollback' | undefined,
        principal,
        ctx,
        env,
      });

    case 'redirects':
      return await handleRedirectRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        redirectId: route.params.redirectId,
        principal,
      });

    case 'content-redirects':
      return await handleContentRedirectRoutes(request, {
        siteId: route.params.siteId ?? '',
        documentPath: route.params.documentPath,
        principal,
      });

    case 'checkpoints':
      return await handleCheckpointRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        checkpointId: route.params.checkpointId,
        documentsPath: route.params.action === 'documents',
        revert: route.params.action === 'revert',
        principal,
      });

    case 'merge':
      return await handleMergeRoutes(request, {
        siteId: route.params.siteId ?? '',
        operation: ['check', 'execute', 'preview'].includes(route.params.action ?? '')
          ? (route.params.action as 'check' | 'execute' | 'preview')
          : undefined,
        mergeRequests: route.params.action === 'requests',
        executeRequest: route.params.action === 'execute-request',
        mergeRequestId: route.params.mergeRequestId,
        principal,
        configKV: env.CONFIG_KV,
        documentStateBinding: env.DOCUMENT_STATE,
      });

    case 'grants':
      return await handleGrantRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId ?? '',
        grantId: route.params.grantId,
        principal,
      });

    case 'admin-users':
      return await handleUsersRoutes(request, {
        userId: route.params.userId,
        principal,
      });

    case 'admin-backfill-datasources':
      return await handleBackfillDatasources(request, principal);

    case 'collaborators':
      return await handleCollaboratorRoutes(request, {
        siteId: route.params.siteId ?? '',
        userId: route.params.userId,
        principal,
        masClient,
      });

    case 'structures':
      return await handleStructureRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        checkpointId: route.params.checkpointId,
        structureId: route.params.structureId,
        principal,
      });

    case 'nodes':
      return await handleNodeRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId ?? '',
        structureId: route.params.structureId ?? '',
        nodeId: route.params.nodeId,
        action: route.params.action as 'move' | 'reorder' | 'navigation' | undefined,
        principal,
      });

    case 'metadata':
      return await handleMetadataRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId ?? '',
        structureId: route.params.structureId ?? '',
        documentId: route.params.documentId,
        action: route.params.action as 'state' | 'schema' | 'validate' | 'list' | undefined,
        principal,
      });

    case 'realtime':
      return await handleRealtimeRoutes(request, env, {
        principal,
      }) ?? errorResponse('Not found', 404);

    case 'presence': {
      const presencePrincipal: import('./presence-api').PresencePrincipal = {
        id: principal.id,
        type: principal.type === 'service' ? 'user' : principal.type,
        pantheonSiteRoles: principal.pantheonSiteRoles,
        organizationId: principal.organizationId,
        dbUserId: principal.dbUserId,
        systemRole: principal.systemRole,
        tokenExpiry: principal.tokenExpiry,
        authProvider: principal.authProvider,
        email: principal.email,
        name: principal.name,
        avatarUrl: principal.avatarUrl,
        providerSubjectId: principal.providerSubjectId,
      };
      return await handlePresenceRoutes(request, {
        siteId: route.params.siteId,
        branchId: route.params.branchId,
        documentPath: route.params.documentPath,
        organizationId: route.params.organizationId,
        agentId: route.params.agentId,
        principal: presencePrincipal,
      }, env);
    }

    case 'agent-keys':
      return await handleAgentKeyRoutes(request, {
        agentId: route.params.agentId,
        keyId: route.params.keyId,
        principal,
      });

    case 'agents':
      return await handleAgentRoutes(request, {
        organizationId: route.params.organizationId ?? '',
        agentId: route.params.agentId,
        subResource: route.params.subResource as 'status' | undefined,
        principal: {
          id: principal.id,
          type: principal.type === 'service' ? 'user' : principal.type,
        },
      });

    case 'agent-roles':
      return await handleAgentRoleRoutes(request, {
        agentId: route.params.agentId,
        roleId: route.params.roleId,
        principal,
      });

    case 'site-agent-roles':
      return await handleSiteAgentRoleRoutes(request, {
        siteId: route.params.siteId,
        roleId: route.params.roleId,
        principal,
      });

    case 'datasources':
      return await handleDatasourceRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        datasourceName: route.params.datasourceName,
        principal,
      });

    case 'queries':
      return await handleQueryRoutes(request, {
        siteId: route.params.siteId ?? '',
        branchId: route.params.branchId,
        queryName: route.params.queryName,
        action: route.params.action,
        principal,
      });

    default:
      return errorResponse('Handler not implemented', 501);
  }
}
