/**
 * Agent API Key Management Routes
 *
 * REST API endpoints for managing agent API keys.
 * Only users can manage agent keys (not agents or service principals).
 *
 * POST   /api/agents/:agentId/keys          - Generate new key
 * GET    /api/agents/:agentId/keys          - List keys
 * DELETE /api/agents/:agentId/keys/:keyId   - Revoke key
 *
 * The agent id alone addresses these routes, so the organization it belongs to
 * has to be looked up before anything else: minting a key is the same
 * administrative act as registering the agent, so the caller must administer
 * that business account.
 *
 * Administering the account is necessary but not sufficient. A key lets the
 * bearer act AS the agent, inheriting every site role it holds, and an account
 * admin is not automatically an admin of the account's sites — so the per-site
 * checks below still decide.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal } from '../types';
import { generateKey, listKeys, revokeKey } from '../services/agent-api-key-service';
import { getAgentById } from '../services/agent-service';
import { getRolesForAgent } from '../services/agent-site-role-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { getMainBranch } from '../services';
import { isOrgAdmin } from '../utils/org-access';
import { isSuperAdmin } from '../utils/admin-check';
import type { RegisteredAgent } from '../types';

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
    const agent = await getAgentById(agentId);
    if (!agent) {
      return errorResponse('Agent not found', 404);
    }

    // isOrgAdmin already requires an active membership row and passes every
    // superadmin, so it subsumes a separate organization-access check.
    if (!(await isOrgAdmin(principal, agent.organizationId))) {
      return errorResponse('Business account admin access required', 403);
    }

    if (keyId !== undefined && keyId !== '') {
      if (method === 'DELETE') {
        // Revoking only REDUCES access, so it must not be blocked by the
        // all-sites rule mint and list use — that would stop a site admin
        // containing a leaked key on a site they administer when the agent
        // also holds a role elsewhere.
        await assertCanRevokeAgentKey(principal, agentId);
        return await handleRevokeKey(agentId, keyId);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Minting or listing a key creates or exposes material that acts as the
    // agent, so it must never reach access the caller lacks: require
    // canManageGrants on every site the agent currently holds a role on.
    await assertCanManageAgentKeys(principal, agent);

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
    getLogger().error('Agent Key API error', error instanceof Error ? error : new Error(String(error)), {});
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
  agent: RegisteredAgent,
): Promise<void> {
  // A global agent's access is implicit, so it holds no role rows to check and
  // the per-site rule below would pass having checked nothing. Its key reaches
  // every site, so only a superadmin may mint or list one.
  if (agent.isGlobal) {
    if (!(await isSuperAdmin(principal))) {
      throw new AuthorizationError(
        'Superadmin access required to manage keys for a system agent',
        'canManageGrants',
        'NO_ACCESS',
      );
    }
    return;
  }

  for (const { siteId, branchId } of await agentRoleSiteBranches(agent.id)) {
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
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
