/**
 * Agent API Key Management Routes
 *
 * REST API endpoints for managing agent API keys.
 * Only users can manage agent keys (not agents or service principals).
 *
 * POST   /api/agents/:agentId/keys          - Generate new key
 * GET    /api/agents/:agentId/keys          - List keys
 * DELETE /api/agents/:agentId/keys/:keyId   - Revoke key
 */

import type { AuthenticatedPrincipal } from '../types';
import { generateKey, listKeys, revokeKey } from '../services/agent-api-key-service';

/**
 * Route context for agent key management endpoints
 */
export interface AgentKeyRouteContext {
  agentId?: string;
  keyId?: string;
  principal: AuthenticatedPrincipal;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}

/**
 * Main route handler for agent key operations
 */
export async function handleAgentKeyRoutes(
  request: Request,
  context: AgentKeyRouteContext,
): Promise<Response> {
  const { agentId, keyId, principal } = context;
  const method = request.method;

  // Validate agentId
  if (agentId === undefined || agentId.trim() === '') {
    return errorResponse('Agent ID is required', 400);
  }

  // Only users can manage agent keys (not agents or service principals)
  if (principal.type !== 'user') {
    return errorResponse('Only users can manage agent API keys', 403);
  }

  try {
    // Route to handler
    if (keyId !== undefined && keyId !== '') {
      // Key-specific operations
      if (method === 'DELETE') {
        return await handleRevokeKey(agentId, keyId);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Collection operations
    switch (method) {
      case 'POST':
        return await handleGenerateKey(request, agentId, principal);
      case 'GET':
        return await handleListKeys(agentId);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    console.error('Agent Key API error:', error);
    return errorResponse('Internal server error', 500);
  }
}

interface GenerateKeyBody {
  name?: string;
}

async function handleGenerateKey(
  request: Request,
  agentId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body: unknown = await request.json();
  const { name } = body as GenerateKeyBody;

  if (name === undefined || name.trim() === '') {
    return errorResponse('name is required', 400);
  }

  const result = await generateKey({
    agentId,
    name,
    createdBy: principal.dbUserId ?? principal.id,
  });

  return jsonResponse(result, 201);
}

async function handleListKeys(agentId: string): Promise<Response> {
  const keys = await listKeys(agentId);
  return jsonResponse({ keys });
}

async function handleRevokeKey(
  agentId: string,
  keyId: string,
): Promise<Response> {
  const revoked = await revokeKey(keyId, agentId);

  if (!revoked) {
    return errorResponse('Key not found', 404);
  }

  return new Response(null, { status: 204 });
}
