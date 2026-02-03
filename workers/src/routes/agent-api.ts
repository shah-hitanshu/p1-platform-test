/**
 * Agent Politeness System - Phase 1.5: Agent API Routes
 *
 * REST API endpoints for agent operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import type { AgentSettings, AgentStatus } from '../types';
import {
  createAgent,
  getAgentById,
  updateAgent,
  updateAgentStatus,
  deleteAgent,
  getAgentsByOrganization,
  InvalidAgentParamsError,
  DuplicateAgentNameError,
  AgentOrganizationNotFoundError,
} from '../services';

/**
 * Request context for agent routes
 */
export interface AgentRouteContext {
  organizationId: string;
  agentId?: string;
  subResource?: 'status';
  principal: {
    id: string;
    type: 'user' | 'agent';
  };
}

/**
 * Valid agent status values
 */
const VALID_STATUSES: AgentStatus[] = ['active', 'suspended', 'disabled'];

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

/**
 * Request body for creating an agent
 */
interface CreateAgentBody {
  name?: string;
  description?: string;
  capabilities?: string[];
  settings?: Partial<AgentSettings>;
}

/**
 * Request body for updating an agent
 */
interface UpdateAgentBody {
  name?: string;
  description?: string;
  capabilities?: string[];
  settings?: Partial<AgentSettings>;
}

/**
 * Request body for updating agent status
 */
interface UpdateStatusBody {
  status?: string;
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
 * Handle POST /api/organizations/{orgId}/agents - Create Agent
 */
async function handleCreateAgent(
  request: Request,
  context: AgentRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<CreateAgentBody>(request);

  // Validate required fields
  if (body.name === undefined || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }

  const agent = await createAgent({
    organizationId: context.organizationId,
    name: body.name,
    description: body.description,
    capabilities: body.capabilities,
    settings: body.settings,
  });

  return jsonResponse(agent, 201);
}

/**
 * Handle GET /api/organizations/{orgId}/agents - List Agents
 */
async function handleListAgents(
  request: Request,
  context: AgentRouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');

  const options: { status?: AgentStatus } = {};
  if (statusParam !== null && VALID_STATUSES.includes(statusParam as AgentStatus)) {
    options.status = statusParam as AgentStatus;
  }

  const agents = await getAgentsByOrganization(context.organizationId, options);

  return jsonResponse({ agents });
}

/**
 * Handle GET /api/organizations/{orgId}/agents/{agentId} - Get Agent
 */
async function handleGetAgent(context: AgentRouteContext): Promise<Response> {
  if (context.agentId === undefined) {
    return errorResponse('Agent ID is required', 400);
  }

  const agent = await getAgentById(context.agentId);

  if (agent === null) {
    return errorResponse('Agent not found', 404);
  }

  // Verify agent belongs to the organization in the URL
  if (agent.organizationId !== context.organizationId) {
    return errorResponse('Agent does not belong to this organization', 403);
  }

  return jsonResponse(agent);
}

/**
 * Handle PATCH /api/organizations/{orgId}/agents/{agentId} - Update Agent
 */
async function handleUpdateAgent(
  request: Request,
  context: AgentRouteContext,
): Promise<Response> {
  if (context.agentId === undefined) {
    return errorResponse('Agent ID is required', 400);
  }

  // First check if agent exists and belongs to organization
  const existingAgent = await getAgentById(context.agentId);
  if (existingAgent === null) {
    return errorResponse('Agent not found', 404);
  }
  if (existingAgent.organizationId !== context.organizationId) {
    return errorResponse('Agent does not belong to this organization', 403);
  }

  const body = await parseJsonBody<UpdateAgentBody>(request);

  const updatedAgent = await updateAgent(context.agentId, {
    name: body.name,
    description: body.description,
    capabilities: body.capabilities,
    settings: body.settings,
  });

  if (updatedAgent === null) {
    return errorResponse('Agent not found', 404);
  }

  return jsonResponse(updatedAgent);
}

/**
 * Handle PUT /api/organizations/{orgId}/agents/{agentId}/status - Update Agent Status
 */
async function handleUpdateAgentStatus(
  request: Request,
  context: AgentRouteContext,
): Promise<Response> {
  if (context.agentId === undefined) {
    return errorResponse('Agent ID is required', 400);
  }

  // First check if agent exists and belongs to organization
  const existingAgent = await getAgentById(context.agentId);
  if (existingAgent === null) {
    return errorResponse('Agent not found', 404);
  }
  if (existingAgent.organizationId !== context.organizationId) {
    return errorResponse('Agent does not belong to this organization', 403);
  }

  const body = await parseJsonBody<UpdateStatusBody>(request);

  // Validate status
  if (body.status === undefined || !VALID_STATUSES.includes(body.status as AgentStatus)) {
    return errorResponse(
      `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      400,
    );
  }

  const updatedAgent = await updateAgentStatus(context.agentId, body.status as AgentStatus);

  if (updatedAgent === null) {
    return errorResponse('Agent not found', 404);
  }

  return jsonResponse(updatedAgent);
}

/**
 * Handle DELETE /api/organizations/{orgId}/agents/{agentId} - Delete Agent
 */
async function handleDeleteAgent(context: AgentRouteContext): Promise<Response> {
  if (context.agentId === undefined) {
    return errorResponse('Agent ID is required', 400);
  }

  // First check if agent exists and belongs to organization
  const existingAgent = await getAgentById(context.agentId);
  if (existingAgent === null) {
    return errorResponse('Agent not found', 404);
  }
  if (existingAgent.organizationId !== context.organizationId) {
    return errorResponse('Agent does not belong to this organization', 403);
  }

  await deleteAgent(context.agentId);

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for agent operations
 */
export async function handleAgentRoutes(
  request: Request,
  context: AgentRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // Handle sub-resource routes (status)
    if (context.subResource === 'status') {
      switch (method) {
        case 'PUT':
          return await handleUpdateAgentStatus(request, context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes with agentId (single agent operations)
    if (context.agentId !== undefined) {
      switch (method) {
        case 'GET':
          return await handleGetAgent(context);
        case 'PATCH':
          return await handleUpdateAgent(request, context);
        case 'DELETE':
          return await handleDeleteAgent(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without agentId (collection operations)
    switch (method) {
      case 'GET':
        return await handleListAgents(request, context);
      case 'POST':
        return await handleCreateAgent(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof InvalidAgentParamsError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof DuplicateAgentNameError) {
      return errorResponse('An agent with this name already exists in the organization', 409);
    }
    if (error instanceof AgentOrganizationNotFoundError) {
      return errorResponse('Organization not found', 404);
    }

    // Log and return generic error for unknown errors
    console.error('Agent API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
