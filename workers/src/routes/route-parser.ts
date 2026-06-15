/**
 * Route Parser
 *
 * Parses URL paths into route handler names and extracted parameters.
 * Contains the regex-based router that maps paths to handler identifiers.
 * Extracted from index.ts.
 */

/**
 * Route parameters extracted from URL paths.
 */
export interface RouteParams {
  siteId?: string;
  branchId?: string;
  documentId?: string;
  documentPath?: string;
  checkpointId?: string;
  structureId?: string;
  nodeId?: string;
  grantId?: string;
  userId?: string;
  mergeRequestId?: string;
  action?: string;
  versionsPath?: string;
  versionAction?: string;
  versionId?: string;
  organizationId?: string;
  agentId?: string;
  tokenId?: string;
  keyId?: string;
  subResource?: string;
  roleId?: string;
}

/**
 * Parse route parameters from path.
 */
export function parseRoute(path: string): { handler: string; params: RouteParams } | null {
  // Remove trailing slash
  const normalizedPath = path.replace(/\/$/, '');

  // Auth routes (no authentication required)
  if (normalizedPath.startsWith('/api/auth')) {
    return { handler: 'auth', params: {} };
  }

  // Admin users routes
  const adminUsersMatch = /^\/api\/admin\/users(?:\/([^/]+))?$/.exec(normalizedPath);
  if (adminUsersMatch) {
    return {
      handler: 'admin-users',
      params: { userId: adminUsersMatch[1] },
    };
  }

  // Site export route (must be before generic site routes)
  const siteExportMatch = /^\/api\/admin\/sites\/([^/]+)\/export$/.exec(normalizedPath);
  if (siteExportMatch) {
    return { handler: 'site-export', params: { siteId: siteExportMatch[1] } };
  }

  // Site import route (must be before generic site routes)
  const siteImportMatch = /^\/api\/admin\/sites\/([^/]+)\/import$/.exec(normalizedPath);
  if (siteImportMatch) {
    return { handler: 'site-import', params: { siteId: siteImportMatch[1] } };
  }

  // Site settings routes (must come before generic site routes)
  const siteSettingsMatch = /^\/api\/sites\/([^/]+)\/settings$/.exec(normalizedPath);
  if (siteSettingsMatch) {
    return {
      handler: 'site-settings',
      params: { siteId: siteSettingsMatch[1] },
    };
  }

  // Content pages route (must come before content route)
  const contentPagesMatch = /^\/api\/sites\/([^/]+)\/content-pages$/.exec(normalizedPath);
  if (contentPagesMatch) {
    return {
      handler: 'content',
      params: { siteId: contentPagesMatch[1], action: 'content-pages' },
    };
  }

  // Content delivery route (documentPath may contain slashes)
  const contentMatch = /^\/api\/sites\/([^/]+)\/content\/(.+)$/.exec(normalizedPath);
  if (contentMatch) {
    return {
      handler: 'content',
      params: { siteId: contentMatch[1], documentPath: contentMatch[2], action: 'content' },
    };
  }

  // Site screenshot route (must come before generic site routes)
  const siteScreenshotMatch = /^\/api\/sites\/([^/]+)\/screenshot$/.exec(normalizedPath);
  if (siteScreenshotMatch) {
    return {
      handler: 'site-screenshot',
      params: { siteId: siteScreenshotMatch[1] },
    };
  }

  // Site token routes (must come before generic site routes)
  const siteTokenMatch = /^\/api\/sites\/([^/]+)\/tokens(?:\/([^/]+))?$/.exec(normalizedPath);
  if (siteTokenMatch) {
    return {
      handler: 'site-tokens',
      params: { siteId: siteTokenMatch[1], tokenId: siteTokenMatch[2] },
    };
  }

  // /api/sites/{siteId}/restore
  const siteRestoreMatch = /^\/api\/sites\/([^/]+)\/restore$/.exec(normalizedPath);
  if (siteRestoreMatch) {
    return {
      handler: 'sites',
      params: { siteId: siteRestoreMatch[1], action: 'restore' },
    };
  }

  // Site routes
  const siteMatch = /^\/api\/sites(?:\/([^/]+))?$/.exec(normalizedPath);
  if (siteMatch) {
    return {
      handler: 'sites',
      params: { siteId: siteMatch[1] },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/publish
  const publishRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/([^/]+)\/publish$/;
  const publishMatch = publishRe.exec(normalizedPath);
  if (publishMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: publishMatch[1],
        branchId: publishMatch[2],
        documentId: publishMatch[3],
        action: 'publish',
      },
    };
  }

  // Document version routes (must come before branch-scoped document routes)
  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/latest
  const versionLatestRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/([^/]+)\/versions\/latest$/;
  const versionLatestMatch = versionLatestRe.exec(normalizedPath);
  if (versionLatestMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: versionLatestMatch[1],
        branchId: versionLatestMatch[2],
        documentId: versionLatestMatch[3],
        versionsPath: 'true',
        versionAction: 'latest',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/{versionId}
  // Uses UUID pattern [0-9a-f-]{36} to avoid matching 'latest'
  const versionByIdRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/([^/]+)\/versions\/([0-9a-f-]{36})$/;
  const versionByIdMatch = versionByIdRe.exec(normalizedPath);
  if (versionByIdMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: versionByIdMatch[1],
        branchId: versionByIdMatch[2],
        documentId: versionByIdMatch[3],
        versionId: versionByIdMatch[4],
        versionsPath: 'true',
        versionAction: 'by-id',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions
  const versionsRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/([^/]+)\/versions$/;
  const versionsMatch = versionsRe.exec(normalizedPath);
  if (versionsMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: versionsMatch[1],
        branchId: versionsMatch[2],
        documentId: versionsMatch[3],
        versionsPath: 'true',
      },
    };
  }

  // Realtime routes (must come before document routes)
  // /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}[/action]
  // Note: These routes handle WebSocket connections, real-time document access, and agent edit workflows
  // Actions: edits, connect, can-agent-edit, agent-edit-start,
  // agent-edit-complete, agent-edit-abort, agent-stop, focus-regions
  const realtimeActions = 'edits|connect|can-agent-edit|agent-edit-start|agent-edit-complete|agent-edit-abort|agent-stop|focus-regions';
  const realtimeRe = new RegExp(
    `^/api/sites/([^/]+)/branches/([^/]+)/documents/(.+?)/(${realtimeActions})$`,
  );
  const realtimeConnectMatch = realtimeRe.exec(normalizedPath);
  if (realtimeConnectMatch) {
    const docPath = realtimeConnectMatch[3] ?? '';
    const action = realtimeConnectMatch[4] ?? '';
    return {
      handler: 'realtime',
      params: {
        siteId: realtimeConnectMatch[1],
        branchId: realtimeConnectMatch[2],
        documentPath: `${docPath}/${action}`,
      },
    };
  }

  // Branch-scoped document routes (must come before site-scoped document routes)
  // /api/sites/{siteId}/branches/{branchId}/documents/{documentIdOrPath}?
  // If the parameter looks like a UUID, route to document handler
  // Otherwise, treat it as a document path and route to realtime handler
  const branchDocMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents(?:\/([^/]+))?$/.exec(normalizedPath);
  if (branchDocMatch) {
    const docIdOrPath = branchDocMatch[3];
    // UUID pattern: 8-4-4-4-12 hex characters
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = docIdOrPath !== undefined && uuidPattern.test(docIdOrPath);

    if (docIdOrPath === undefined || isUuid) {
      // No doc specified, or it's a UUID - use document handler
      return {
        handler: 'documents',
        params: {
          siteId: branchDocMatch[1],
          branchId: branchDocMatch[2],
          documentId: branchDocMatch[3],
        },
      };
    } else {
      // It's a document path - use realtime handler for document state
      return {
        handler: 'realtime',
        params: {
          siteId: branchDocMatch[1],
          branchId: branchDocMatch[2],
          documentPath: docIdOrPath,
        },
      };
    }
  }

  // Document routes
  // /api/sites/{siteId}/documents/{documentId}/restore
  const docRestoreMatch = /^\/api\/sites\/([^/]+)\/documents\/([^/]+)\/restore$/.exec(normalizedPath);
  if (docRestoreMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: docRestoreMatch[1],
        documentId: docRestoreMatch[2],
        action: 'restore',
      },
    };
  }

  // /api/sites/{siteId}/documents/by-path[/{documentPath}]
  // Note: documentPath may contain encoded slashes (%2F) for nested paths like "products/rsq8"
  // The trailing slash and path are optional to handle root path "/"
  // After parseRoute removes trailing slashes, "/by-path/" becomes "/by-path"
  const docByPathMatch = /^\/api\/sites\/([^/]+)\/documents\/by-path(?:\/(.*))?$/.exec(normalizedPath);
  if (docByPathMatch) {
    try {
      const rawPath = decodeURIComponent(docByPathMatch[2] ?? '');
      const documentPath = rawPath === '' ? '/' : rawPath;
      return {
        handler: 'documents',
        params: {
          siteId: docByPathMatch[1],
          documentPath,
        },
      };
    } catch {
      // Invalid URL encoding - route doesn't match
      return null;
    }
  }

  // /api/sites/{siteId}/documents/{documentId}?
  const docMatch = /^\/api\/sites\/([^/]+)\/documents(?:\/([^/]+))?$/.exec(normalizedPath);
  if (docMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: docMatch[1],
        documentId: docMatch[2],
      },
    };
  }

  // Checkpoint routes
  // /api/sites/{siteId}/branches/{branchId}/checkpoints/{checkpointId}/revert
  const checkpointRevertRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/checkpoints\/([^/]+)\/revert$/;
  const checkpointRevertMatch = checkpointRevertRe.exec(normalizedPath);
  if (checkpointRevertMatch) {
    return {
      handler: 'checkpoints',
      params: {
        siteId: checkpointRevertMatch[1],
        branchId: checkpointRevertMatch[2],
        checkpointId: checkpointRevertMatch[3],
        action: 'revert',
      },
    };
  }

  // /api/sites/{siteId}/checkpoints/{checkpointId}/documents
  const checkpointDocsMatch = /^\/api\/sites\/([^/]+)\/checkpoints\/([^/]+)\/documents$/.exec(normalizedPath);
  if (checkpointDocsMatch) {
    return {
      handler: 'checkpoints',
      params: {
        siteId: checkpointDocsMatch[1],
        checkpointId: checkpointDocsMatch[2],
        action: 'documents',
      },
    };
  }

  // /api/sites/{siteId}/checkpoints/{checkpointId}/structures/{structureId}
  const checkpointStructRe =
    /^\/api\/sites\/([^/]+)\/checkpoints\/([^/]+)\/structures\/([^/]+)$/;
  const checkpointStructureMatch = checkpointStructRe.exec(normalizedPath);
  if (checkpointStructureMatch) {
    return {
      handler: 'structures',
      params: {
        siteId: checkpointStructureMatch[1],
        checkpointId: checkpointStructureMatch[2],
        structureId: checkpointStructureMatch[3],
      },
    };
  }

  // /api/sites/{siteId}/checkpoints/{checkpointId}
  const singleCheckpointMatch = /^\/api\/sites\/([^/]+)\/checkpoints\/([^/]+)$/.exec(normalizedPath);
  if (singleCheckpointMatch) {
    return {
      handler: 'checkpoints',
      params: {
        siteId: singleCheckpointMatch[1],
        checkpointId: singleCheckpointMatch[2],
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/checkpoints
  const branchCheckpointsMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/checkpoints$/.exec(normalizedPath);
  if (branchCheckpointsMatch) {
    return {
      handler: 'checkpoints',
      params: {
        siteId: branchCheckpointsMatch[1],
        branchId: branchCheckpointsMatch[2],
      },
    };
  }

  // Metadata routes (must come before node routes)
  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/state
  const structureStateRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/state$/;
  const structureStateMatch = structureStateRe.exec(normalizedPath);
  if (structureStateMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: structureStateMatch[1],
        branchId: structureStateMatch[2],
        structureId: structureStateMatch[3],
        action: 'state',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/schema
  const schemaRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/schema$/;
  const schemaMatch = schemaRe.exec(normalizedPath);
  if (schemaMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: schemaMatch[1],
        branchId: schemaMatch[2],
        structureId: schemaMatch[3],
        action: 'schema',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/validate
  const validateRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/validate$/;
  const validateMatch = validateRe.exec(normalizedPath);
  if (validateMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: validateMatch[1],
        branchId: validateMatch[2],
        structureId: validateMatch[3],
        action: 'validate',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/metadata
  const listMetaRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/metadata$/;
  const listMetadataMatch = listMetaRe.exec(normalizedPath);
  if (listMetadataMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: listMetadataMatch[1],
        branchId: listMetadataMatch[2],
        structureId: listMetadataMatch[3],
        action: 'list',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/documents/{docId}/metadata
  const docMetaRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/documents\/([^/]+)\/metadata$/;
  const docMetadataMatch = docMetaRe.exec(normalizedPath);
  if (docMetadataMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: docMetadataMatch[1],
        branchId: docMetadataMatch[2],
        structureId: docMetadataMatch[3],
        documentId: docMetadataMatch[4],
      },
    };
  }

  // Node routes
  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/navigation
  const navRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/navigation$/;
  const navigationMatch = navRe.exec(normalizedPath);
  if (navigationMatch) {
    return {
      handler: 'nodes',
      params: {
        siteId: navigationMatch[1],
        branchId: navigationMatch[2],
        structureId: navigationMatch[3],
        action: 'navigation',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}/move
  const nodeMoveRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/nodes\/([^/]+)\/move$/;
  const nodeMoveMatch = nodeMoveRe.exec(normalizedPath);
  if (nodeMoveMatch) {
    return {
      handler: 'nodes',
      params: {
        siteId: nodeMoveMatch[1],
        branchId: nodeMoveMatch[2],
        structureId: nodeMoveMatch[3],
        nodeId: nodeMoveMatch[4],
        action: 'move',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/reorder
  const reorderRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/nodes\/reorder$/;
  const reorderMatch = reorderRe.exec(normalizedPath);
  if (reorderMatch) {
    return {
      handler: 'nodes',
      params: {
        siteId: reorderMatch[1],
        branchId: reorderMatch[2],
        structureId: reorderMatch[3],
        action: 'reorder',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}?
  const nodeRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/nodes(?:\/([^/]+))?$/;
  const nodeMatch = nodeRe.exec(normalizedPath);
  if (nodeMatch) {
    return {
      handler: 'nodes',
      params: {
        siteId: nodeMatch[1],
        branchId: nodeMatch[2],
        structureId: nodeMatch[3],
        nodeId: nodeMatch[4],
      },
    };
  }

  // Structure routes
  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}?
  const structureMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures(?:\/([^/]+))?$/.exec(normalizedPath);
  if (structureMatch) {
    return {
      handler: 'structures',
      params: {
        siteId: structureMatch[1],
        branchId: structureMatch[2],
        structureId: structureMatch[3],
      },
    };
  }

  // Grant routes
  // /api/sites/{siteId}/branches/{branchId}/grants/{grantId}?
  const grantMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/grants(?:\/([^/]+))?$/.exec(normalizedPath);
  if (grantMatch) {
    return {
      handler: 'grants',
      params: {
        siteId: grantMatch[1],
        branchId: grantMatch[2],
        grantId: grantMatch[3],
      },
    };
  }

  // Collaborator routes
  // /api/sites/{siteId}/collaborators/{userId}?
  const collaboratorMatch = /^\/api\/sites\/([^/]+)\/collaborators(?:\/([^/]+))?$/.exec(normalizedPath);
  if (collaboratorMatch) {
    return {
      handler: 'collaborators',
      params: {
        siteId: collaboratorMatch[1],
        userId: collaboratorMatch[2],
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/restore
  const branchRestoreMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/restore$/.exec(normalizedPath);
  if (branchRestoreMatch) {
    return {
      handler: 'branches',
      params: { siteId: branchRestoreMatch[1], branchId: branchRestoreMatch[2], action: 'restore' },
    };
  }

  // Branch routes
  // /api/sites/{siteId}/branches/{branchId}?
  const branchMatch = /^\/api\/sites\/([^/]+)\/branches(?:\/([^/]+))?$/.exec(normalizedPath);
  if (branchMatch) {
    return {
      handler: 'branches',
      params: {
        siteId: branchMatch[1],
        branchId: branchMatch[2],
      },
    };
  }

  // Merge routes
  // /api/sites/{siteId}/merge/{operation}
  const mergeOpMatch = /^\/api\/sites\/([^/]+)\/merge\/(check|execute|preview)$/.exec(normalizedPath);
  if (mergeOpMatch) {
    return {
      handler: 'merge',
      params: {
        siteId: mergeOpMatch[1],
        action: mergeOpMatch[2],
      },
    };
  }

  // /api/sites/{siteId}/merge-requests/{requestId}/execute
  const mergeRequestExecuteMatch = /^\/api\/sites\/([^/]+)\/merge-requests\/([^/]+)\/execute$/.exec(normalizedPath);
  if (mergeRequestExecuteMatch) {
    return {
      handler: 'merge',
      params: {
        siteId: mergeRequestExecuteMatch[1],
        mergeRequestId: mergeRequestExecuteMatch[2],
        action: 'execute-request',
      },
    };
  }

  // /api/sites/{siteId}/merge-requests/{requestId}?
  const mergeRequestMatch = /^\/api\/sites\/([^/]+)\/merge-requests(?:\/([^/]+))?$/.exec(normalizedPath);
  if (mergeRequestMatch) {
    return {
      handler: 'merge',
      params: {
        siteId: mergeRequestMatch[1],
        mergeRequestId: mergeRequestMatch[2],
        action: 'requests',
      },
    };
  }

  // Presence routes (Phase 8)
  // Site presence: /api/sites/{siteId}/presence
  const sitePresenceMatch = /^\/api\/sites\/([^/]+)\/presence$/.exec(normalizedPath);
  if (sitePresenceMatch) {
    return {
      handler: 'presence',
      params: { siteId: sitePresenceMatch[1] },
    };
  }

  // Document presence: /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/presence
  // Must come before branch presence to avoid the shorter pattern matching first
  const docPresenceMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/(.+)\/presence$/.exec(normalizedPath);
  if (docPresenceMatch) {
    return {
      handler: 'presence',
      params: {
        siteId: docPresenceMatch[1],
        branchId: docPresenceMatch[2],
        documentPath: docPresenceMatch[3],
      },
    };
  }

  // Branch presence: /api/sites/{siteId}/branches/{branchId}/presence
  const branchPresenceMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/presence$/.exec(normalizedPath);
  if (branchPresenceMatch) {
    return {
      handler: 'presence',
      params: { siteId: branchPresenceMatch[1], branchId: branchPresenceMatch[2] },
    };
  }

  // Agent key routes: /api/agents/{agentId}/keys(/{keyId})
  const agentKeyMatch = /^\/api\/agents\/([^/]+)\/keys(?:\/([^/]+))?$/.exec(normalizedPath);
  if (agentKeyMatch) {
    return {
      handler: 'agent-keys',
      params: { agentId: agentKeyMatch[1], keyId: agentKeyMatch[2] },
    };
  }

  // Agent CRUD: /api/organizations/{orgId}/agents(/{agentId}(/status))
  const agentCrudMatch = /^\/api\/organizations\/([^/]+)\/agents(?:\/([^/]+?)(?:\/(status))?)?$/.exec(normalizedPath);
  if (agentCrudMatch) {
    return {
      handler: 'agents',
      params: {
        organizationId: agentCrudMatch[1],
        agentId: agentCrudMatch[2],
        subResource: agentCrudMatch[3] as 'status' | undefined,
      },
    };
  }

  // Agent role routes: /api/agents/{agentId}/roles(/{roleId})
  const agentRoleMatch = /^\/api\/agents\/([^/]+)\/roles(?:\/([^/]+))?$/.exec(normalizedPath);
  if (agentRoleMatch) {
    return {
      handler: 'agent-roles',
      params: { agentId: agentRoleMatch[1], roleId: agentRoleMatch[2] },
    };
  }

  // Site agent role routes: /api/sites/{siteId}/agent-roles(/{roleId})
  const siteAgentRoleMatch = /^\/api\/sites\/([^/]+)\/agent-roles(?:\/([^/]+))?$/.exec(normalizedPath);
  if (siteAgentRoleMatch) {
    return {
      handler: 'site-agent-roles',
      params: { siteId: siteAgentRoleMatch[1], roleId: siteAgentRoleMatch[2] },
    };
  }

  // Agent presence: /api/organizations/{orgId}/agents/{agentId}/presence
  const agentPresenceMatch = /^\/api\/organizations\/([^/]+)\/agents\/([^/]+)\/presence$/.exec(normalizedPath);
  if (agentPresenceMatch) {
    return {
      handler: 'presence',
      params: { organizationId: agentPresenceMatch[1], agentId: agentPresenceMatch[2] },
    };
  }

  return null;
}
