/**
 * API Client for Collaborative State System
 *
 * HTTP client for the Worker API that interfaces with
 * the Agent Politeness workflow endpoints.
 */

// =============================================================================
// Types
// =============================================================================

export interface ApiClientConfig {
  baseUrl: string;
  agentId: string;
  agentApiKey: string;
}

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
// API Client
// =============================================================================

export class ApiClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly agentApiKey: string;

  constructor(config: ApiClientConfig) {
    if (!config.baseUrl) {
      throw new Error('baseUrl is required');
    }
    if (!config.agentId) {
      throw new Error('agentId is required');
    }
    if (!config.agentApiKey) {
      throw new Error('agentApiKey is required');
    }

    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.agentId = config.agentId;
    this.agentApiKey = config.agentApiKey;
  }

  /**
   * Build common headers for API requests
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.agentApiKey,
      'X-Actor-Type': 'agent',
      'X-Actor-Id': this.agentId,
    };
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

    if (requestedById) {
      headers['X-Agent-Requested-By'] = requestedById;
    }
    if (operationType) {
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
    return action ? `${base}/${action}` : base;
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

  /**
   * List all sites accessible to the agent
   */
  async listSites(): Promise<ListSitesResponse> {
    const url = `${this.baseUrl}/api/sites`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    return this.handleResponse<ListSitesResponse>(response);
  }

  /**
   * List branches for a site
   */
  async listBranches(siteId: string): Promise<ListBranchesResponse> {
    const url = `${this.baseUrl}/api/sites/${siteId}/branches`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    return this.handleResponse<ListBranchesResponse>(response);
  }

  /**
   * Create a new branch on a site
   */
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

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    return this.handleResponse<Branch>(response);
  }

  /**
   * List documents for a site and branch
   */
  async listDocuments(siteId: string, branchId: string): Promise<ListDocumentsResponse> {
    const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    return this.handleResponse<ListDocumentsResponse>(response);
  }

  /**
   * Get document content
   */
  async getDocument(
    siteId: string,
    branchId: string,
    documentPath: string,
  ): Promise<DocumentSnapshot> {
    const url = this.buildDocumentUrl(siteId, branchId, documentPath);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    return this.handleResponse<DocumentSnapshot>(response);
  }

  /**
   * Check if agent can edit document
   */
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

    // Send required fields in body (backend reads from body, not headers)
    const response = await fetch(url, {
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

    // Worker returns { allowed, ... } but client expects { canEdit, ... }
    const data = await this.handleResponse<{ allowed: boolean; reason?: string; message?: string; conflictingRegions?: string[] }>(response);
    return {
      canEdit: data.allowed,
      reason: data.reason,
      message: data.message,
      conflictingRegions: data.conflictingRegions,
    };
  }

  /**
   * Start an agent edit session
   */
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

    // Send required fields in body (backend reads from body, not headers)
    const response = await fetch(url, {
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

  /**
   * Apply edit operations to document
   *
   * IMPORTANT: Agents MUST provide a valid editSessionId from start_edit_session.
   * The backend enforces this requirement and will reject requests without a valid session.
   */
  async applyEdits(request: ApplyEditsRequest): Promise<ApplyEditsResponse> {
    const url = this.buildDocumentUrl(
      request.siteId,
      request.branchId,
      request.documentPath,
      'edits',
    );

    const response = await fetch(url, {
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

  /**
   * Complete an agent edit session
   */
  async completeAgentEdit(
    request: CompleteAgentEditRequest,
  ): Promise<CompleteAgentEditResponse> {
    const url = this.buildDocumentUrl(
      request.siteId,
      request.branchId,
      request.documentPath,
      'agent-edit-complete',
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'X-Agent-Id': this.agentId,
      },
      body: JSON.stringify({ editSessionId: request.editSessionId }),
    });

    return this.handleResponse<CompleteAgentEditResponse>(response);
  }

  /**
   * Abort an agent edit session
   */
  async abortAgentEdit(request: AbortAgentEditRequest): Promise<AbortAgentEditResponse> {
    const url = this.buildDocumentUrl(
      request.siteId,
      request.branchId,
      request.documentPath,
      'agent-edit-abort',
    );

    const body: Record<string, string> = { editSessionId: request.editSessionId };
    if (request.reason) {
      body.reason = request.reason;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'X-Agent-Id': this.agentId,
      },
      body: JSON.stringify(body),
    });

    return this.handleResponse<AbortAgentEditResponse>(response);
  }

  // ===========================================================================
  // Presence API Methods
  // ===========================================================================

  /**
   * Get presence information for all documents on a branch
   */
  async getBranchPresence(
    siteId: string,
    branchId: string,
  ): Promise<BranchPresenceResponse> {
    const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/presence`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    return this.handleResponse<BranchPresenceResponse>(response);
  }

  /**
   * Get presence information for a specific document
   */
  async getDocumentPresence(
    siteId: string,
    branchId: string,
    documentPath: string,
  ): Promise<DocumentPresenceResponse> {
    const encodedPath = encodeURIComponent(documentPath);
    const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/presence`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    return this.handleResponse<DocumentPresenceResponse>(response);
  }
}
