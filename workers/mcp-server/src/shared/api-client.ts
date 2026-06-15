/**
 * MCP API Client for Collaborative State System
 *
 * HTTP client for the Worker API that interfaces with
 * the Agent Politeness workflow endpoints.
 * Adapted from examples/collaborative-state-mcp/src/api-client.ts
 * with acting-user header support for the remote MCP server.
 */

import type { McpApiClientConfig, ActingUser } from './types.js';
import { getBackendBreaker } from '../circuit-breaker.js';
import type { ComponentSchema } from '@pantheon-systems/p1-content-validator';
import { snapshotToComponentSchema } from '@pantheon-systems/p1-content-validator';

// =============================================================================
// Types
// =============================================================================

export interface SiteInfo {
  id: string;
  pantheonSiteId: string;
  name: string;
  createdAt: string;
}

export interface ListSitesResponse {
  sites: SiteInfo[];
  total: number;
}

export interface BranchInfo {
  id: string;
  siteId: string;
  name: string;
  status: string;
  isMain: boolean;
  createdAt: string;
}

export interface ListBranchesResponse {
  branches: BranchInfo[];
  total: number;
}

export interface Branch {
  id: string;
  siteId: string;
  name: string;
  description?: string;
  status: string;
  isMain: boolean;
  sourceBranchId?: string;
  sourceCheckpointId?: string;
  createdById: string;
  createdByType: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentInfo {
  id: string;
  path: string;
  createdAt: string;
}

export interface ListDocumentsResponse {
  documents: DocumentInfo[];
}

export interface DocumentVersionLatest {
  id: string;
  documentId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
}

export interface CreateDocumentResult {
  documentId: string;
  documentPath: string;
  versionId: string;
}

export interface DocumentSnapshot {
  snapshot: Record<string, unknown>;
  version?: number;
}

export interface CanAgentEditRequest {
  siteId: string;
  branchId: string;
  documentPath: string;
  intent: string;
  targetRegions: string[];
  trigger: 'human_requested' | 'autonomous';
  requestedById?: string;
  operationType?: string;
}

export interface CanAgentEditResponse {
  canEdit: boolean;
  editSessionId?: string | null;
  reason?: string;
  message?: string;
  conflictingRegions?: string[];
}

export interface StartAgentEditRequest {
  siteId: string;
  branchId: string;
  documentPath: string;
  intent: string;
  targetRegions: string[];
  trigger: 'human_requested' | 'autonomous';
  requestedById?: string;
  operationType?: string;
}

export interface StartAgentEditResponse {
  editSessionId: string;
  checkpointId: string;
  expiresAt: string;
  reservedRegions: string[];
}

export interface EditOperation {
  type: 'add' | 'remove' | 'replace' | 'move' | 'reorder';
  path: string;
  content?: unknown;
  index?: number;
  fromIndex?: number;
  toIndex?: number;
}

export interface ApplyEditsRequest {
  siteId: string;
  branchId: string;
  documentPath: string;
  editSessionId: string;
  operations: EditOperation[];
}

export interface ApplyEditsResponse {
  success: boolean;
  version?: number;
}

export interface CompleteAgentEditRequest {
  siteId: string;
  branchId: string;
  documentPath: string;
  editSessionId: string;
}

export interface CompleteAgentEditResponse {
  success: boolean;
  checkpointId: string;
}

export interface AbortAgentEditRequest {
  siteId: string;
  branchId: string;
  documentPath: string;
  editSessionId: string;
  reason?: string;
}

export interface AbortAgentEditResponse {
  success: boolean;
  rolledBack: boolean;
}

export interface ApiError {
  error: string;
  reason?: string;
}

// =============================================================================
// Presence Types
// =============================================================================

export interface ActorPresence {
  id: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: 'agent' | 'human';
  name: string;
  avatar?: string;
  state: 'active' | 'idle' | 'inactive' | 'editing';
  intent?: string;
  focusRegions?: string[];
  lastActivityAt: string;
  joinedAt: string;
}

export interface DocumentPresence {
  documentId: string;
  documentPath: string;
  actors: ActorPresence[];
  actorCount: number;
  hasActiveEditors: boolean;
}

export interface BranchPresenceResponse {
  siteId: string;
  branchId: string;
  documents: DocumentPresence[];
  totalActors: number;
  totalDocuments: number;
}

export interface DocumentPresenceResponse {
  presences: ActorPresence[];
}

// =============================================================================
// Registry schema cache (module-level — survives across requests in an isolate)
// =============================================================================

interface RegistryCacheEntry {
  cachedAt: number;
  schemas: Record<string, ComponentSchema>;
}

const registryCache = new Map<string, RegistryCacheEntry>();
const REGISTRY_TTL_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// API Client
// =============================================================================

export class McpApiClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly agentApiKey: string;
  private readonly actingUser?: ActingUser;
  private readonly fetcher?: Fetcher;
  readonly validationEnabled: boolean;

  constructor(config: McpApiClientConfig) {
    if (!config.baseUrl) {
      throw new Error('baseUrl is required');
    }
    if (!config.agentId) {
      throw new Error('agentId is required');
    }
    if (!config.agentApiKey) {
      throw new Error('agentApiKey is required');
    }

    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.agentId = config.agentId;
    this.agentApiKey = config.agentApiKey;
    this.actingUser = config.actingUser;
    this.fetcher = config.fetcher;
    this.validationEnabled = config.enableValidation ?? false;
  }

  /**
   * Fetch wrapper that uses the service binding when available,
   * falling back to global fetch for local development.
   *
   * Wrapped in the per-isolate circuit breaker (PCC-3192). Sustained 5xx
   * from the backend trips the breaker and subsequent calls fast-fail with
   * a clear error before hitting the upstream — preventing the cascade
   * documented in docs/handoff-sbx1-500-errors.md (Hyperdrive connection
   * exhaustion under load).
   */
  private async doFetch(url: string, init: RequestInit): Promise<Response> {
    const breaker = getBackendBreaker();
    return breaker.execute(() => {
      if (this.fetcher) {
        return this.fetcher.fetch(url, init);
      }
      return fetch(url, init);
    });
    // CircuitOpenError propagates as-is. Its message already includes the
    // retry hint and is consumed by the existing tool-handler catch path
    // (handleResponse → formatError) which turns Error instances into
    // LLM-facing text. Re-throwing as a plain Error here would discard
    // both the discriminator type and the `retryAfterMs` field, blocking
    // any future programmatic backoff path. Caught in pre-merge review.
  }

  /**
   * Build common headers for API requests.
   * Includes acting-user headers when actingUser is set.
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.agentApiKey,
      'X-Actor-Type': 'agent',
      'X-Actor-Id': this.agentId,
    };

    if (this.actingUser) {
      headers['X-Acting-User-Id'] = this.actingUser.id;
      headers['X-Acting-User-Email'] = this.actingUser.email;
      if (this.actingUser.name !== undefined) {
        const safeName = this.actingUser.name.replace(/[\r\n]/g, ' ').trim().slice(0, 256);
        if (safeName) headers['X-Acting-User-Name'] = safeName;
      }
    }

    return headers;
  }

  /**
   * Build agent context headers for edit operations
   */
  private getAgentEditHeaders(
    intent: string,
    targetRegions: string[],
    trigger: 'human_requested' | 'autonomous',
    requestedById?: string,
    operationType?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.getHeaders(),
      'X-Agent-Id': this.agentId,
      'X-Agent-Trigger': trigger,
      'X-Agent-Intent': intent,
      'X-Agent-Target-Regions': targetRegions.join(', '),
    };

    if (requestedById !== undefined && requestedById !== '') {
      headers['X-Agent-Requested-By'] = requestedById;
    }
    if (operationType !== undefined && operationType !== '') {
      headers['X-Agent-Operation-Type'] = operationType;
    }

    return headers;
  }

  /**
   * Build document URL with proper encoding
   */
  private buildDocumentUrl(
    siteId: string,
    branchId: string,
    documentPath: string,
    action?: string,
  ): string {
    const encodedPath = encodeURIComponent(documentPath);
    const base = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}`;
    return action !== undefined && action !== '' ? `${base}/${action}` : base;
  }

  /**
   * Handle API response and throw on errors
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    const data = (await response.json()) as T | ApiError;

    if (!response.ok) {
      const errorData = data as ApiError;
      throw new Error(errorData.error || `API error: ${String(response.status)}`);
    }

    return data as T;
  }

  async listSites(): Promise<ListSitesResponse> {
    const url = `${this.baseUrl}/api/sites`;
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<ListSitesResponse>(response);
  }

  async listBranches(siteId: string): Promise<ListBranchesResponse> {
    const url = `${this.baseUrl}/api/sites/${siteId}/branches`;
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<ListBranchesResponse>(response);
  }

  async createBranch(
    siteId: string,
    request: { name: string; description?: string; parentBranchId?: string },
  ): Promise<Branch> {
    const url = `${this.baseUrl}/api/sites/${siteId}/branches`;
    const body: Record<string, string> = { name: request.name };
    if (request.description !== undefined) {
      body.description = request.description;
    }
    if (request.parentBranchId !== undefined) {
      body.parentBranchId = request.parentBranchId;
    }
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return this.handleResponse<Branch>(response);
  }

  async listDocuments(
    siteId: string,
    branchId: string,
    options?: { pathPrefix?: string },
  ): Promise<ListDocumentsResponse> {
    const params =
      options?.pathPrefix !== undefined && options.pathPrefix !== ''
        ? `?pathPrefix=${encodeURIComponent(options.pathPrefix)}`
        : '';
    const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents${params}`;
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<ListDocumentsResponse>(response);
  }

  /**
   * Get the latest version snapshot for a document by its UUID.
   *
   * IMPORTANT: documentId must be a UUID (from listDocuments response doc.id),
   * NOT an encoded document path. The backend route uses [^/]+ to capture this
   * segment and performs a UUID-based DB lookup — passing an encoded path
   * would produce a 404 or wrong result.
   */
  async getDocumentLatestVersion(
    siteId: string,
    branchId: string,
    documentId: string,
  ): Promise<DocumentVersionLatest> {
    const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions/latest`;
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<DocumentVersionLatest>(response);
  }

  /**
   * Create a new document and its first version atomically.
   *
   * The CSS backend accepts an optional `snapshot` in the POST body alongside
   * `path` and creates both document and version in a single transaction.
   * This is preferred over separate create-then-version calls.
   *
   * Used by create_page — bypasses agent edit workflow since the doc is new
   * (no checkpoint is needed before writing a first version).
   */
  async createDocument(
    siteId: string,
    branchId: string,
    path: string,
    snapshot: unknown,
  ): Promise<CreateDocumentResult> {
    const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents`;
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path, snapshot }),
    });
    const result = await this.handleResponse<{
      document: { id: string; path: string };
      version: { id: string };
    }>(response);

    return {
      documentId: result.document.id,
      documentPath: result.document.path,
      versionId: result.version.id,
    };
  }

  async getDocument(
    siteId: string,
    branchId: string,
    documentPath: string,
  ): Promise<DocumentSnapshot> {
    const url = this.buildDocumentUrl(siteId, branchId, documentPath);
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<DocumentSnapshot>(response);
  }

  async canAgentEdit(request: CanAgentEditRequest): Promise<CanAgentEditResponse> {
    const url = this.buildDocumentUrl(
      request.siteId,
      request.branchId,
      request.documentPath,
      'can-agent-edit',
    );
    const headers = this.getAgentEditHeaders(
      request.intent,
      request.targetRegions,
      request.trigger,
      request.requestedById,
      request.operationType,
    );
    const response = await this.doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agentId: this.agentId,
        trigger: request.trigger,
        intent: request.intent,
        targetRegions: request.targetRegions,
        requestedById: request.requestedById,
        operationType: request.operationType,
      }),
    });
    const data = await this.handleResponse<{
      allowed: boolean;
      reason?: string;
      message?: string;
      conflictingRegions?: string[];
    }>(response);
    return {
      canEdit: data.allowed,
      reason: data.reason,
      message: data.message,
      conflictingRegions: data.conflictingRegions,
    };
  }

  async startAgentEdit(request: StartAgentEditRequest): Promise<StartAgentEditResponse> {
    const url = this.buildDocumentUrl(
      request.siteId,
      request.branchId,
      request.documentPath,
      'agent-edit-start',
    );
    const headers = this.getAgentEditHeaders(
      request.intent,
      request.targetRegions,
      request.trigger,
      request.requestedById,
      request.operationType,
    );
    const response = await this.doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agentId: this.agentId,
        trigger: request.trigger,
        intent: request.intent,
        targetRegions: request.targetRegions,
        requestedById: request.requestedById,
        operationType: request.operationType,
      }),
    });
    return this.handleResponse<StartAgentEditResponse>(response);
  }

  async applyEdits(request: ApplyEditsRequest): Promise<ApplyEditsResponse> {
    const url = this.buildDocumentUrl(
      request.siteId,
      request.branchId,
      request.documentPath,
      'edits',
    );
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        operations: request.operations,
        actorId: this.agentId,
        editSessionId: request.editSessionId,
      }),
    });
    return this.handleResponse<ApplyEditsResponse>(response);
  }

  async completeAgentEdit(
    request: CompleteAgentEditRequest,
  ): Promise<CompleteAgentEditResponse> {
    const url = this.buildDocumentUrl(
      request.siteId,
      request.branchId,
      request.documentPath,
      'agent-edit-complete',
    );
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'X-Agent-Id': this.agentId,
      },
      body: JSON.stringify({ editSessionId: request.editSessionId }),
    });
    return this.handleResponse<CompleteAgentEditResponse>(response);
  }

  async abortAgentEdit(request: AbortAgentEditRequest): Promise<AbortAgentEditResponse> {
    const url = this.buildDocumentUrl(
      request.siteId,
      request.branchId,
      request.documentPath,
      'agent-edit-abort',
    );
    const body: Record<string, string> = { editSessionId: request.editSessionId };
    if (request.reason !== undefined && request.reason !== '') {
      body.reason = request.reason;
    }
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'X-Agent-Id': this.agentId,
      },
      body: JSON.stringify(body),
    });
    return this.handleResponse<AbortAgentEditResponse>(response);
  }

  async getBranchPresence(
    siteId: string,
    branchId: string,
  ): Promise<BranchPresenceResponse> {
    const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/presence`;
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<BranchPresenceResponse>(response);
  }

  async getDocumentPresence(
    siteId: string,
    branchId: string,
    documentPath: string,
  ): Promise<DocumentPresenceResponse> {
    const encodedPath = encodeURIComponent(documentPath);
    const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/presence`;
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<DocumentPresenceResponse>(response);
  }

  /**
   * Fetch component schemas from the CSS registry, with a 5-minute TTL cache.
   *
   * Uses listDocuments + getDocumentLatestVersion (both already go through the
   * circuit breaker). Returns an empty object when no components are registered
   * yet. Callers should treat an empty result as "skip validation" rather than
   * "reject everything" — the registry is only populated after the editor opens.
   *
   * Cache is keyed by (siteId, branchId) at module level so it survives across
   * requests within a Workers isolate. Registry documents only change when
   * component code ships, so 5-minute staleness is acceptable.
   */
  async fetchRegistrySchemas(
    siteId: string,
    branchId: string,
  ): Promise<Record<string, ComponentSchema>> {
    const cacheKey = `${siteId}:${branchId}`;
    const cached = registryCache.get(cacheKey);
    if (cached !== undefined && Date.now() - cached.cachedAt < REGISTRY_TTL_MS) {
      return cached.schemas;
    }

    const docs = await this.listDocuments(siteId, branchId, {
      pathPrefix: '_registry/components/',
    });

    if (docs.documents.length === 0) {
      // Cache the empty result so we don't re-hit listDocuments on every call
      registryCache.set(cacheKey, { cachedAt: Date.now(), schemas: {} });
      return {};
    }

    const schemas: Record<string, ComponentSchema> = {};

    await Promise.all(
      docs.documents.map(async (doc) => {
        const name = doc.path.slice('_registry/components/'.length);
        try {
          const version = await this.getDocumentLatestVersion(siteId, branchId, doc.id);
          schemas[name] = snapshotToComponentSchema(name, version.snapshot);
        } catch {
          // Skip components that fail to fetch — don't block other schemas
        }
      }),
    );

    registryCache.set(cacheKey, { cachedAt: Date.now(), schemas });
    return schemas;
  }
}
