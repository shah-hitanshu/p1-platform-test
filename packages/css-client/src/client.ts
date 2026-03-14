/**
 * CSS Client
 *
 * Main client class for interacting with the Collaborative State System API.
 */

import type { AuthProvider } from './auth.js';
import type { Principal } from './types.js';
import {
  BaseEndpoint,
  SitesEndpoint,
  BranchesEndpoint,
  DocumentsEndpoint,
  VersionsEndpoint,
  CheckpointsEndpoint,
  PresenceEndpoint,
  AgentRegistryEndpoint,
  AgentEditEndpoint,
  MergeEndpoint,
} from './endpoints/index.js';

/**
 * Configuration options for CSSClient.
 */
export interface CSSClientConfig {
  /**
   * Base URL of the CSS API.
   * Example: "https://api.example.com" or "http://localhost:8787"
   */
  baseUrl: string;

  /**
   * Optional API key for authentication.
   * If provided, will be used as Bearer token.
   */
  apiKey?: string;

  /**
   * Optional custom authentication provider.
   * Takes precedence over apiKey if both are provided.
   */
  authProvider?: AuthProvider;

  /**
   * Optional default principal for API requests.
   * Can be overridden per-request using withPrincipal().
   */
  principal?: Principal;
}

/**
 * Internal configuration passed to private constructor.
 */
interface InternalConfig {
  baseEndpoint: BaseEndpoint;
}

/**
 * Client for the Collaborative State System API.
 *
 * @example
 * ```typescript
 * const client = new CSSClient({
 *   baseUrl: 'http://localhost:8787',
 *   apiKey: 'your-api-key',
 *   principal: { id: 'user-123', type: 'user' },
 * });
 *
 * // List sites
 * const sites = await client.sites.list();
 *
 * // Get branches for a site
 * const branches = await client.branches.list(siteId);
 *
 * // Create a document version
 * const version = await client.versions.create(siteId, {
 *   documentId: 'doc-123',
 *   branchId: 'branch-456',
 *   snapshot: { content: [], root: {} },
 * });
 * ```
 */
export class CSSClient {
  private readonly baseEndpoint: BaseEndpoint;

  /**
   * Site operations.
   */
  public readonly sites: SitesEndpoint;

  /**
   * Branch operations.
   */
  public readonly branches: BranchesEndpoint;

  /**
   * Document operations.
   */
  public readonly documents: DocumentsEndpoint;

  /**
   * Document version operations.
   */
  public readonly versions: VersionsEndpoint;

  /**
   * Checkpoint operations.
   */
  public readonly checkpoints: CheckpointsEndpoint;

  /**
   * Presence queries for sites, branches, and agents.
   */
  public readonly presence: PresenceEndpoint;

  /**
   * Agent registry operations.
   */
  public readonly agentRegistry: AgentRegistryEndpoint;

  /**
   * Agent edit workflow operations.
   */
  public readonly agentEdit: AgentEditEndpoint;

  /**
   * Merge operations (checks, previews, execution, merge requests).
   */
  public readonly merge: MergeEndpoint;

  constructor(config: CSSClientConfig | InternalConfig) {
    // Check if this is an internal config (has baseEndpoint)
    if ('baseEndpoint' in config) {
      this.baseEndpoint = config.baseEndpoint;
    } else {
      // Create auth provider from API key if provided
      // Use "ApiKey " prefix to signal X-API-Key header should be used
      const authProvider =
        config.authProvider ?? (config.apiKey ? async () => `ApiKey ${config.apiKey}` : undefined);

      this.baseEndpoint = new BaseEndpoint({
        baseUrl: config.baseUrl,
        authProvider,
        principal: config.principal,
      });
    }

    // Initialize endpoint instances
    this.sites = new SitesEndpoint(this.baseEndpoint);
    this.branches = new BranchesEndpoint(this.baseEndpoint);
    this.documents = new DocumentsEndpoint(this.baseEndpoint);
    this.versions = new VersionsEndpoint(this.baseEndpoint);
    this.checkpoints = new CheckpointsEndpoint(this.baseEndpoint);

    // Agent Politeness endpoints
    this.presence = new PresenceEndpoint(this.baseEndpoint);
    this.agentRegistry = new AgentRegistryEndpoint(this.baseEndpoint);
    this.agentEdit = new AgentEditEndpoint(this.baseEndpoint);

    // Merge endpoints
    this.merge = new MergeEndpoint(this.baseEndpoint);
  }

  /**
   * Create a new client instance with a different principal.
   * Useful for making requests on behalf of different users.
   *
   * @param principal - The principal to use for requests
   * @returns A new CSSClient instance with the updated principal
   */
  withPrincipal(principal: Principal): CSSClient {
    const newBaseEndpoint = this.baseEndpoint.withPrincipal(principal);
    return new CSSClient({ baseEndpoint: newBaseEndpoint });
  }

  /**
   * Create a new client instance with session ID for agent authorization.
   * The session ID is obtained from startEdit() and enables server-side
   * enforcement of the Agent Politeness Protocol.
   *
   * @param sessionId - The session ID from startEdit()
   * @returns A new CSSClient instance with the session ID set
   *
   * @example
   * ```typescript
   * const session = await client.agentEdit.startEdit(siteId, branchId, docPath, context);
   * const authorizedClient = client.withSessionId(session.sessionId);
   * await authorizedClient.versions.create(siteId, params);
   * ```
   */
  withSessionId(sessionId: string): CSSClient {
    const newBaseEndpoint = this.baseEndpoint.withSessionId(sessionId);
    return new CSSClient({ baseEndpoint: newBaseEndpoint });
  }
}
