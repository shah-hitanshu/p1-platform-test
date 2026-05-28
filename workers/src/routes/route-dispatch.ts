/**
 * Route Dispatch
 *
 * Maps parsed route handlers to their corresponding route handler functions.
 * Extracted from index.ts to reduce file size and improve maintainability.
 */

import type { AuthenticatedPrincipal } from '../types';
import type { Env } from '../index';
import type { RouteParams } from './route-parser';
import type { MASClient } from '../services/mas-client';

// Route handlers
import { handleSiteRoutes } from './site-api';
import { handleSiteScreenshotRoutes } from './site-screenshot-api';
import { handleBranchRoutes } from './branch-api';
import { handleDocumentRoutes } from './document-api';
import { handleCheckpointRoutes } from './checkpoint-api';
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
import { getMainBranch } from '../services/branch-service';
import { errorResponse } from '../utils/http-helpers';

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
): Promise<Response> {
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
      return await handleSiteImportRoute(request, {
        siteId: route.params.siteId,
        principal,
      }, { CONFIG_KV: env.CONFIG_KV });

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

    case 'presence':
      return await handlePresenceRoutes(request, {
        siteId: route.params.siteId,
        branchId: route.params.branchId,
        documentPath: route.params.documentPath,
        organizationId: route.params.organizationId,
        agentId: route.params.agentId,
        principal,
      }, env);

    case 'agent-keys':
      return await handleAgentKeyRoutes(request, {
        agentId: route.params.agentId,
        keyId: route.params.keyId,
        principal,
      });

    case 'agents':
      return await handleAgentRoutes(request, {
        organizationId: route.params.organizationId,
        agentId: route.params.agentId,
        subResource: route.params.subResource,
        principal,
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

    default:
      return errorResponse('Handler not implemented', 501);
  }
}
