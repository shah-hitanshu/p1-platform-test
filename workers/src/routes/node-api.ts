/**
 * Phase 7.1.1b: Node API Routes
 *
 * REST API endpoints for structure node operations.
 * Nodes are associated with structures, which are branch-scoped.
 */

import {
  createNode,
  getNode,
  listNodes,
  updateNode,
  deleteNode,
  moveNode,
  reorderNodes,
  buildNavigationTree,
  getBranchStructure,
  StructureNotFoundError,
  NodeNotFoundError,
  DuplicateNodeSlugError,
  CircularReferenceError,
} from '../services';

/**
 * Request context for node routes
 */
export interface NodeRouteContext {
  siteId: string;
  branchId: string;
  structureId: string;
  nodeId?: string;
  action?: 'move' | 'reorder' | 'navigation';
  principal: {
    id: string;
    type: 'user' | 'agent';
  };
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

/**
 * Request body for creating a node
 */
interface CreateNodeBody {
  parentNodeId?: string | null;
  name?: string;
  slug?: string;
  nodeType?: string;
  documentId?: string;
  externalUrl?: string;
  position?: number;
}

/**
 * Request body for updating a node
 */
interface UpdateNodeBody {
  name?: string;
  slug?: string;
  position?: number;
}

/**
 * Request body for moving a node
 */
interface MoveNodeBody {
  newParentId?: string | null;
  newPosition?: number;
}

/**
 * Request body for reordering nodes
 */
interface ReorderNodesBody {
  parentNodeId?: string | null;
  nodeOrder?: string[];
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
 * Handle POST - Create Node
 */
async function handleCreateNode(
  request: Request,
  context: NodeRouteContext,
): Promise<Response> {
  // Verify structure exists on branch
  const structure = await getBranchStructure(context.branchId, context.structureId);
  if (structure === null) {
    return errorResponse('Structure not found on branch', 404);
  }

  const body = await parseJsonBody<CreateNodeBody>(request);

  // Validate required fields
  if (body.name === undefined || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }
  if (body.slug === undefined || body.slug.trim() === '') {
    return errorResponse('slug is required', 400);
  }
  if (body.nodeType === undefined || body.nodeType.trim() === '') {
    return errorResponse('nodeType is required', 400);
  }
  if (body.position === undefined) {
    return errorResponse('position is required', 400);
  }

  const node = await createNode({
    structureId: context.structureId,
    parentNodeId: body.parentNodeId ?? null,
    name: body.name,
    slug: body.slug,
    nodeType: body.nodeType as 'section' | 'document' | 'external',
    documentId: body.documentId,
    externalUrl: body.externalUrl,
    position: body.position,
  });

  return jsonResponse(node, 201);
}

/**
 * Handle GET - List Nodes
 */
async function handleListNodes(
  request: Request,
  context: NodeRouteContext,
): Promise<Response> {
  // Verify structure exists on branch
  const structure = await getBranchStructure(context.branchId, context.structureId);
  if (structure === null) {
    return errorResponse('Structure not found on branch', 404);
  }

  const url = new URL(request.url);
  const parentId = url.searchParams.get('parentId');

  const nodes = await listNodes({
    structureId: context.structureId,
    parentNodeId: parentId === 'null' ? null : parentId ?? undefined,
  });

  return jsonResponse({ nodes });
}

/**
 * Handle GET - Get Node
 */
async function handleGetNode(context: NodeRouteContext): Promise<Response> {
  if (context.nodeId === undefined) {
    return errorResponse('Node ID is required', 400);
  }

  const node = await getNode(context.nodeId);

  if (node === null) {
    return errorResponse('Node not found', 404);
  }

  return jsonResponse(node);
}

/**
 * Handle PATCH - Update Node
 */
async function handleUpdateNode(
  request: Request,
  context: NodeRouteContext,
): Promise<Response> {
  if (context.nodeId === undefined) {
    return errorResponse('Node ID is required', 400);
  }

  const body = await parseJsonBody<UpdateNodeBody>(request);

  const updatedNode = await updateNode(context.nodeId, {
    name: body.name,
    slug: body.slug,
    position: body.position,
  });

  return jsonResponse(updatedNode);
}

/**
 * Handle DELETE - Delete Node
 */
async function handleDeleteNode(context: NodeRouteContext): Promise<Response> {
  if (context.nodeId === undefined) {
    return errorResponse('Node ID is required', 400);
  }

  await deleteNode(context.nodeId);

  return new Response(null, { status: 204 });
}

/**
 * Handle POST - Move Node
 */
async function handleMoveNode(
  request: Request,
  context: NodeRouteContext,
): Promise<Response> {
  if (context.nodeId === undefined) {
    return errorResponse('Node ID is required', 400);
  }

  const body = await parseJsonBody<MoveNodeBody>(request);

  const movedNode = await moveNode({
    nodeId: context.nodeId,
    newParentId: body.newParentId ?? null,
    newPosition: body.newPosition ?? 0,
  });

  return jsonResponse(movedNode);
}

/**
 * Handle POST - Reorder Nodes
 */
async function handleReorderNodes(
  request: Request,
  context: NodeRouteContext,
): Promise<Response> {
  // Verify structure exists on branch
  const structure = await getBranchStructure(context.branchId, context.structureId);
  if (structure === null) {
    return errorResponse('Structure not found on branch', 404);
  }

  const body = await parseJsonBody<ReorderNodesBody>(request);

  if (body.nodeOrder === undefined || !Array.isArray(body.nodeOrder)) {
    return errorResponse('nodeOrder array is required', 400);
  }

  await reorderNodes(
    context.structureId,
    body.parentNodeId ?? null,
    body.nodeOrder,
  );

  return jsonResponse({
    success: true,
    reorderedCount: body.nodeOrder.length,
  });
}

/**
 * Handle GET - Navigation Tree
 */
async function handleGetNavigationTree(context: NodeRouteContext): Promise<Response> {
  // Verify structure exists on branch and get its details
  const structure = await getBranchStructure(context.branchId, context.structureId);
  if (structure === null) {
    return errorResponse('Structure not found on branch', 404);
  }

  const tree = await buildNavigationTree(context.structureId);

  return jsonResponse({
    structureId: context.structureId,
    structureName: structure.name,
    tree,
  });
}

/**
 * Main route handler for node operations
 */
export async function handleNodeRoutes(
  request: Request,
  context: NodeRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Handle special actions
    if (context.action === 'move') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleMoveNode(request, context);
    }

    if (context.action === 'reorder') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleReorderNodes(request, context);
    }

    if (context.action === 'navigation') {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleGetNavigationTree(context);
    }

    // Routes with nodeId (single node operations)
    if (context.nodeId !== undefined) {
      switch (method) {
        case 'GET':
          return await handleGetNode(context);
        case 'PATCH':
          return await handleUpdateNode(request, context);
        case 'DELETE':
          return await handleDeleteNode(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without nodeId (collection operations)
    switch (method) {
      case 'GET':
        return await handleListNodes(request, context);
      case 'POST':
        return await handleCreateNode(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof StructureNotFoundError) {
      return errorResponse('Structure not found', 404);
    }
    if (error instanceof NodeNotFoundError) {
      return errorResponse('Node not found', 404);
    }
    if (error instanceof DuplicateNodeSlugError) {
      return errorResponse('Node with this slug already exists', 409);
    }
    if (error instanceof CircularReferenceError) {
      return errorResponse('Move would create circular reference', 400);
    }

    // Log and return generic error for unknown errors
    console.error('Node API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
