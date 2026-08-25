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
import { getRolesForAgent } from '../services/agent-site-role-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { getMainBranch } from '../services';

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

  // Only users can manage agent keys (not agents or service principals).
  if (principal.type !== 'user') {
    return errorResponse('Only users can manage agent API keys', 403);
  }

  try {
    // Key-specific operations (DELETE by keyId)
    if (keyId !== undefined && keyId !== '') {
      if (method === 'DELETE') {
        // Revoking a key only REDUCES access, so it must not be blocked by the
        // all-sites rule that mint/list use — that would stop a site admin from
        // containing a leaked key when the agent also holds a role on a site
        // they don't administer. Require admin on ANY one of the agent's sites
        // (a role-less agent's keys are inert; type===user then suffices).
        await assertCanRevokeAgentKey(principal, agentId);
        return await handleRevokeKey(agentId, keyId);
      }
      return errorResponse('Method not allowed', 405);
    }

    // PCC-3676: minting or listing an agent key exposes/creates material that
    // lets the bearer act AS the agent, inheriting every site role the agent
    // holds (agent-api-key-provider resolves the key to the union of the
    // agent's agent_site_roles). So these must never let a caller reach access
    // they don't already have: require canManageGrants on EVERY site the agent
    // currently holds a role on. This closes the mint-and-reuse variant —
    // minting a key for an agent a site admin already gave admin on site X,
    // then using the key directly — which gating only the grant layer does not
    // stop. A role-less agent has nothing to protect yet; scoping that (and the
    // full key lifecycle) to the agent's owner is the org-account model's job,
    // tracked as follow-up on PCC-3676.
    await assertCanManageAgentKeys(principal, agentId);

    switch (method) {
      case 'POST':
        return await handleGenerateKey(request, agentId, principal);
      case 'GET':
        return await handleListKeys(agentId);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    console.error('Agent Key API error:', error);
    return errorResponse('Internal server error', 500);
  }
}

/**
 * Return the resolvable sites (siteId + main branch id) the agent holds a role
 * on. Orphaned roles whose site no longer resolves are dropped — they protect
 * nothing.
 */
async function agentRoleSiteBranches(
  agentId: string,
): Promise<{ siteId: string; branchId: string }[]> {
  const roles = await getRolesForAgent(agentId);
  const result: { siteId: string; branchId: string }[] = [];
  for (const siteId of Object.keys(roles)) {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch !== null) {
      result.push({ siteId, branchId: mainBranch.id });
    }
  }
  return result;
}

/**
 * Mint/list authorization: the caller must have canManageGrants on EVERY site
 * the agent holds a role on, so a key can never confer access the caller lacks.
 * Throws AuthorizationError on the first site that fails.
 */
async function assertCanManageAgentKeys(
  principal: AuthenticatedPrincipal,
  agentId: string,
): Promise<void> {
  for (const { siteId, branchId } of await agentRoleSiteBranches(agentId)) {
    await assertPermission(principal, siteId, branchId, 'canManageGrants');
  }
}

/**
 * Revoke authorization: canManageGrants on ANY one of the agent's sites is
 * enough (revocation cannot escalate, and containment must stay fast). A
 * role-less agent has no site to check, so the caller-is-user gate stands.
 */
async function assertCanRevokeAgentKey(
  principal: AuthenticatedPrincipal,
  agentId: string,
): Promise<void> {
  const sites = await agentRoleSiteBranches(agentId);
  if (sites.length === 0) {
    return;
  }
  let lastError: AuthorizationError | undefined;
  for (const { siteId, branchId } of sites) {
    try {
      await assertPermission(principal, siteId, branchId, 'canManageGrants');
      return;
    } catch (error) {
      if (error instanceof AuthorizationError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new AuthorizationError(
    'Not authorized to manage this agent\'s keys',
    'canManageGrants',
    'NO_ACCESS',
  );
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
