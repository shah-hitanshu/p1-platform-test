/**
 * Phase 8: Presence Rollup Service
 *
 * Aggregates presence data across documents, branches, and sites.
 * Uses a fan-out query pattern to query DocumentSession DOs in parallel.
 *
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import type {
  ActorPresence,
  BranchPresence,
  BranchPresenceSummary,
  DocumentPresenceSummary,
  PresenceSummary,
  SitePresence,
  AgentPresenceLocation,
  AgentGlobalPresence,
} from '../types';

import { listDocumentsOnBranch } from './document-service';
import { listBranches, getBranch } from './branch-service';
import { getSite } from './site-service';
import { getSitesByOrganization } from './organization-service';
import { getAgentById } from './agent-service';

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when a branch is not found during presence rollup.
 */
export class BranchNotFoundError extends Error {
  public readonly name = 'BranchNotFoundError';

  constructor(public readonly branchId: string) {
    super(`Branch with ID "${branchId}" not found.`);
    Object.setPrototypeOf(this, BranchNotFoundError.prototype);
  }
}

/**
 * Error thrown when a site is not found during presence rollup.
 */
export class SiteNotFoundError extends Error {
  public readonly name = 'SiteNotFoundError';

  constructor(public readonly siteId: string) {
    super(`Site with ID "${siteId}" not found.`);
    Object.setPrototypeOf(this, SiteNotFoundError.prototype);
  }
}

/**
 * Error thrown when an agent is not found during presence rollup.
 */
export class AgentNotFoundError extends Error {
  public readonly name = 'AgentNotFoundError';

  constructor(public readonly agentId: string) {
    super(`Agent with ID "${agentId}" not found.`);
    Object.setPrototypeOf(this, AgentNotFoundError.prototype);
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Environment interface for accessing Durable Objects
 */
interface PresenceRollupEnv {
  DOCUMENT_STATE: DurableObjectNamespace;
}

/**
 * Response from DocumentSession /presences endpoint
 */
interface PresencesResponse {
  presences: ActorPresence[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build session ID for DocumentSession DO.
 * Format: {siteId}:{documentId}:{branchId}
 */
function buildSessionId(siteId: string, documentId: string, branchId: string): string {
  return `${siteId}:${documentId}:${branchId}`;
}

/**
 * Calculate presence summary from a list of actors.
 */
function calculateSummary(actors: ActorPresence[]): PresenceSummary {
  const uniqueActors = new Map<string, ActorPresence>();
  for (const actor of actors) {
    if (!uniqueActors.has(actor.actorId)) {
      uniqueActors.set(actor.actorId, actor);
    }
  }

  const uniqueList = Array.from(uniqueActors.values());

  return {
    totalActors: uniqueList.length,
    humanCount: uniqueList.filter((a) => a.role === 'human').length,
    agentCount: uniqueList.filter((a) => a.role === 'agent').length,
    editingCount: uniqueList.filter((a) => a.state === 'editing').length,
  };
}

/**
 * Deduplicate actors by actorId, keeping the most recent entry.
 */
function deduplicateActors(actors: ActorPresence[]): ActorPresence[] {
  const actorMap = new Map<string, ActorPresence>();

  for (const actor of actors) {
    const existing = actorMap.get(actor.actorId);
    if (existing === undefined) {
      actorMap.set(actor.actorId, actor);
    } else {
      // Keep the most recently active one
      const existingTime = new Date(existing.lastActivityAt).getTime();
      const currentTime = new Date(actor.lastActivityAt).getTime();
      if (currentTime > existingTime) {
        actorMap.set(actor.actorId, actor);
      }
    }
  }

  return Array.from(actorMap.values());
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Query a single document's presence from its Durable Object.
 *
 * @param env - Environment with DOCUMENT_STATE binding
 * @param siteId - Site identifier
 * @param documentId - Document identifier
 * @param branchId - Branch identifier
 * @returns Array of actor presences (empty on failure)
 */
export async function queryDocumentPresence(
  env: unknown,
  siteId: string,
  documentId: string,
  branchId: string,
): Promise<ActorPresence[]> {
  try {
    const typedEnv = env as Partial<PresenceRollupEnv>;
    const documentState = typedEnv.DOCUMENT_STATE;

    if (documentState === undefined) {
      console.warn('DOCUMENT_STATE binding not available');
      return [];
    }

    const sessionId = buildSessionId(siteId, documentId, branchId);
    const doId = documentState.idFromName(sessionId);
    const stub = documentState.get(doId);

    const response = await stub.fetch(new Request('http://internal/presences', {
      method: 'GET',
      headers: {
        'X-Session-Id': sessionId,
      },
    }));

    if (!response.ok) {
      console.warn(`Failed to fetch presence for ${sessionId}: ${String(response.status)}`);
      return [];
    }

    const rawData: unknown = await response.json();
    const data = rawData as PresencesResponse;
    return Array.isArray(data.presences) ? data.presences : [];
  } catch (error) {
    console.error(`Error querying presence for document ${documentId}:`, error);
    return [];
  }
}

/**
 * Get branch-level presence aggregation.
 *
 * Queries all documents on the branch in parallel and aggregates presence data.
 *
 * @param env - Environment with bindings
 * @param siteId - Site identifier
 * @param branchId - Branch identifier
 * @returns Branch presence aggregation
 * @throws {BranchNotFoundError} If branch doesn't exist
 */
export async function getBranchPresence(
  env: unknown,
  siteId: string,
  branchId: string,
): Promise<BranchPresence> {
  // Validate branch exists
  const branch = await getBranch(branchId);
  if (branch === null) {
    throw new BranchNotFoundError(branchId);
  }

  // Get all documents on the branch
  const documents = await listDocumentsOnBranch(branchId);

  // Query presence from each document in parallel
  const presencePromises = documents.map(async (doc) => {
    const presences = await queryDocumentPresence(env, siteId, doc.id, branchId);
    return {
      documentId: doc.id,
      documentPath: doc.path,
      presences,
    };
  });

  const results = await Promise.allSettled(presencePromises);

  // Aggregate results
  const allActors: ActorPresence[] = [];
  const documentSummary: DocumentPresenceSummary[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.presences.length > 0) {
      const { documentId, documentPath, presences } = result.value;

      allActors.push(...presences);

      documentSummary.push({
        documentId,
        documentPath,
        actorCount: presences.length,
        hasHumans: presences.some((p) => p.role === 'human'),
        hasAgents: presences.some((p) => p.role === 'agent'),
      });
    }
  }

  const deduplicatedActors = deduplicateActors(allActors);
  const summary = calculateSummary(deduplicatedActors);

  return {
    branchId,
    branchName: branch.name,
    siteId,
    summary,
    actors: deduplicatedActors,
    documentSummary,
  };
}

/**
 * Get site-level presence aggregation.
 *
 * Queries all branches and aggregates presence across the site.
 *
 * @param env - Environment with bindings
 * @param siteId - Site identifier
 * @returns Site presence aggregation
 * @throws {SiteNotFoundError} If site doesn't exist
 */
export async function getSitePresence(
  env: unknown,
  siteId: string,
): Promise<SitePresence> {
  // Validate site exists
  const site = await getSite(siteId);
  if (site === null) {
    throw new SiteNotFoundError(siteId);
  }

  // Get all active branches
  const branches = await listBranches(siteId, {
    status: 'active',
  });

  // Query presence from each branch in parallel
  const branchPromises = branches.map(async (branch) => {
    const presence = await getBranchPresence(env, siteId, branch.id);
    return presence;
  });

  const results = await Promise.allSettled(branchPromises);

  // Aggregate results
  const allActors: ActorPresence[] = [];
  const branchSummaries: BranchPresenceSummary[] = [];
  let activeBranches = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const branchPresence = result.value;

      if (branchPresence.actors.length > 0) {
        activeBranches++;
      }

      allActors.push(...branchPresence.actors);

      branchSummaries.push({
        branchId: branchPresence.branchId,
        branchName: branchPresence.branchName,
        actorCount: branchPresence.summary.totalActors,
        hasHumans: branchPresence.summary.humanCount > 0,
        hasAgents: branchPresence.summary.agentCount > 0,
      });
    }
  }

  const deduplicatedActors = deduplicateActors(allActors);

  return {
    siteId,
    siteName: site.name,
    summary: {
      totalActors: deduplicatedActors.length,
      humanCount: deduplicatedActors.filter((a) => a.role === 'human').length,
      agentCount: deduplicatedActors.filter((a) => a.role === 'agent').length,
      activeBranches,
    },
    branches: branchSummaries,
  };
}

/**
 * Get an agent's presence across all sites in an organization.
 *
 * Searches all sites, branches, and documents to find where the agent is active.
 *
 * @param env - Environment with bindings
 * @param organizationId - Organization identifier
 * @param agentId - Agent identifier
 * @returns Agent's global presence with all locations
 * @throws {AgentNotFoundError} If agent doesn't exist
 */
export async function getAgentPresence(
  env: unknown,
  organizationId: string,
  agentId: string,
): Promise<AgentGlobalPresence> {
  // Validate agent exists
  const agent = await getAgentById(agentId);
  if (agent === null) {
    throw new AgentNotFoundError(agentId);
  }

  // Get all sites in the organization
  const sites = await getSitesByOrganization(organizationId);

  const locations: AgentPresenceLocation[] = [];

  // Search each site for the agent's presence
  for (const site of sites) {
    const branches = await listBranches(site.id, { status: 'active' });

    for (const branch of branches) {
      const documents = await listDocumentsOnBranch(branch.id);

      const presencePromises = documents.map(async (doc) => {
        const presences = await queryDocumentPresence(env, site.id, doc.id, branch.id);
        const agentPresence = presences.find((p) => p.actorId === agentId);

        if (agentPresence !== undefined) {
          return {
            siteId: site.id,
            siteName: site.name,
            branchId: branch.id,
            branchName: branch.name,
            documentId: doc.id,
            documentPath: doc.path,
            presence: agentPresence,
          };
        }
        return null;
      });

      const results = await Promise.allSettled(presencePromises);

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value !== null) {
          locations.push(result.value);
        }
      }
    }
  }

  return {
    agentId,
    agentName: agent.name,
    organizationId,
    locations,
  };
}
