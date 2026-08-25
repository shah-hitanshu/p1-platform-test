/**
 * CCR Client
 *
 * Main client class for interacting with the Collaborative Content Repository API.
 */

import type { AuthProvider } from './auth.js';
import type { Principal } from './types.js';
import type { SdkIdentity } from './telemetry-headers.js';
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
  TemplatesEndpoint,
  MigrationConflictsEndpoint,
  QueriesEndpoint,
} from './endpoints/index.js';

/**
 * Configuration options for P1Client.
 */
export interface P1ClientConfig {
  /**
   * Base URL of the P1 API.
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

  /**
   * Optional token refresher for dynamic token management.
   * Called when a 401 Unauthorized response is received.
   * Should return a fresh token or null if the session cannot be refreshed.
   * If null is returned, or if the retry with the fresh token also returns 401,
   * a SessionExpiredError is thrown.
   */
  tokenRefresher?: () => Promise<string | null>;

  /**
   * Identifies the calling SDK in the `x-p1-sdk` request header. Defaults to this
   * package. A wrapper such as `p1-next-sdk` passes its own name and version so the
   * backend can see which SDK versions are actually in the field.
   */
  sdk?: SdkIdentity;

  /**
   * Optional application identifier, sent as `x-p1-client-id`. Useful for telling your
   * own deployments apart in backend logs. Do not put anything personally identifying
   * here — it is recorded server-side.
   */
  clientId?: string;

  /**
   * Supplies a W3C `traceparent` from an ambient tracer, so a host application already
   * running OpenTelemetry keeps one trace across its own spans and this client's requests.
   * Omit it and each request starts a fresh trace.
   *
   * This client never sends telemetry anywhere itself — it only labels its own requests so
   * the P1 backend can correlate them.
   */
  getTraceparent?: () => string | undefined;
}

/**
 * Internal configuration passed to private constructor.
 */
interface InternalConfig {
  baseEndpoint: BaseEndpoint;
}

/**
 * Client for the Collaborative Content Repository API.
 *
 * @example
 * ```typescript
 * const client = new P1Client({
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
export class P1Client {
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

  /**
   * Content type template operations.
   */
  public readonly templates: TemplatesEndpoint;

  /**
   * Migration conflict operations.
   */
  public readonly migrationConflicts: MigrationConflictsEndpoint;

  /**
   * Query operations (content type queries and results).
   */
  public readonly queries: QueriesEndpoint;

  constructor(config: P1ClientConfig | InternalConfig) {
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
        tokenRefresher: config.tokenRefresher,
        sdk: config.sdk,
        clientId: config.clientId,
        getTraceparent: config.getTraceparent,
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

    // Template endpoints
    this.templates = new TemplatesEndpoint(this.baseEndpoint);
    this.migrationConflicts = new MigrationConflictsEndpoint(this.baseEndpoint);

    // Query endpoints
    this.queries = new QueriesEndpoint(this.baseEndpoint);
  }

  /**
   * Create a new client instance with a different principal.
   * Useful for making requests on behalf of different users.
   *
   * @param principal - The principal to use for requests
   * @returns A new P1Client instance with the updated principal
   */
  withPrincipal(principal: Principal): P1Client {
    const newBaseEndpoint = this.baseEndpoint.withPrincipal(principal);
    return new P1Client({ baseEndpoint: newBaseEndpoint });
  }

  /**
   * Create a new client instance with session ID for agent authorization.
   * The session ID is obtained from startEdit() and enables server-side
   * enforcement of the Agent Politeness Protocol.
   *
   * @param sessionId - The session ID from startEdit()
   * @returns A new P1Client instance with the session ID set
   *
   * @example
   * ```typescript
   * const session = await client.agentEdit.startEdit(siteId, branchId, docPath, context);
   * const authorizedClient = client.withSessionId(session.sessionId);
   * await authorizedClient.versions.create(siteId, params);
   * ```
   */
  withSessionId(sessionId: string): P1Client {
    const newBaseEndpoint = this.baseEndpoint.withSessionId(sessionId);
    return new P1Client({ baseEndpoint: newBaseEndpoint });
  }
}
