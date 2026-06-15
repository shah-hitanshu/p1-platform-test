/**
 * CSS Backend API Client
 * Adapted from collaborative-state-system/workers/mcp-server/src/shared/api-client.ts
 */

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

// Operation shape accepted by the CSS backend's /edits endpoint. The agent
// speaks a friendlier vocabulary (add/remove/replace/move); see translateOp
// in tools.ts for the mapping.
export interface EditOperation {
  type: 'set' | 'delete' | 'insert' | 'move' | 'replace';
  path: string;
  value?: unknown;
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

export interface ApiError {
  error: string;
  reason?: string;
}

export interface McpApiClientConfig {
  baseUrl: string;
  agentId: string;
  agentApiKey: string;
  actingUser?: { id: string; email: string; name?: string };
  fetcher?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
}

export class McpApiClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly agentApiKey: string;
  private readonly actingUser?: { id: string; email: string; name?: string };
  private readonly fetcher?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };

  constructor(config: McpApiClientConfig) {
    if (!config.baseUrl) throw new Error('baseUrl is required');
    if (!config.agentId) throw new Error('agentId is required');
    if (!config.agentApiKey) throw new Error('agentApiKey is required');

    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.agentId = config.agentId;
    this.agentApiKey = config.agentApiKey;
    this.actingUser = config.actingUser;
    this.fetcher = config.fetcher;
  }

  private doFetch(url: string, init: RequestInit): Promise<Response> {
    if (this.fetcher) return this.fetcher.fetch(url, init);
    return fetch(url, init);
  }

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
    if (requestedById) headers['X-Agent-Requested-By'] = requestedById;
    if (operationType) headers['X-Agent-Operation-Type'] = operationType;
    return headers;
  }

  private buildDocumentUrl(siteId: string, branchId: string, documentPath: string, action?: string): string {
    const encodedPath = encodeURIComponent(documentPath);
    const base = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}`;
    return action ? `${base}/${action}` : base;
  }

  private normalizePath(documentPath: string): string {
    return documentPath.startsWith('/') ? documentPath.slice(1) : documentPath;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const data = await response.json() as T | ApiError;
    if (!response.ok) {
      const errorData = data as ApiError;
      throw new Error(errorData.error || `API error: ${response.status}`);
    }
    return data as T;
  }

  async listSites(): Promise<ListSitesResponse> {
    const response = await this.doFetch(`${this.baseUrl}/api/sites`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<ListSitesResponse>(response);
  }

  async listBranches(siteId: string): Promise<ListBranchesResponse> {
    const response = await this.doFetch(`${this.baseUrl}/api/sites/${siteId}/branches`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<ListBranchesResponse>(response);
  }

  async listDocuments(siteId: string, branchId: string, options?: { pathPrefix?: string }): Promise<ListDocumentsResponse> {
    const params = options?.pathPrefix ? `?pathPrefix=${encodeURIComponent(options.pathPrefix)}` : '';
    const response = await this.doFetch(`${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<ListDocumentsResponse>(response);
  }

  async getDocumentLatestVersion(siteId: string, branchId: string, documentId: string): Promise<DocumentVersionLatest> {
    const response = await this.doFetch(
      `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions/latest`,
      { method: 'GET', headers: this.getHeaders() },
    );
    return this.handleResponse<DocumentVersionLatest>(response);
  }

  async createDocument(siteId: string, branchId: string, path: string, snapshot: unknown): Promise<CreateDocumentResult> {
    const response = await this.doFetch(`${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path, snapshot }),
    });
    const result = await this.handleResponse<{ document: { id: string; path: string }; version: { id: string } }>(response);
    return { documentId: result.document.id, documentPath: result.document.path, versionId: result.version.id };
  }

  async getDocument(siteId: string, branchId: string, documentPath: string): Promise<DocumentSnapshot> {
    const response = await this.doFetch(this.buildDocumentUrl(siteId, branchId, documentPath), {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<DocumentSnapshot>(response);
  }

  async listComponents(siteId: string, branchId: string): Promise<{ components: unknown[] }> {
    const registryDocs = await this.listDocuments(siteId, branchId, { pathPrefix: '_registry/components/' });
    const versions = await Promise.all(
      registryDocs.documents.map(doc => this.getDocumentLatestVersion(siteId, branchId, doc.id)),
    );
    return { components: versions.map(v => v.snapshot) };
  }

  async listComponentNames(siteId: string, branchId: string): Promise<string[]> {
    const PREFIX = '/_registry/components/';
    const docs = await this.listDocuments(siteId, branchId, { pathPrefix: '_registry/components/' });
    return docs.documents.map(doc =>
      doc.path.startsWith(PREFIX) ? doc.path.slice(PREFIX.length) : doc.path.split('/').pop() ?? doc.path,
    );
  }

  async canAgentEdit(request: CanAgentEditRequest): Promise<CanAgentEditResponse> {
    const docPath = this.normalizePath(request.documentPath);
    const url = `${this.baseUrl}/api/sites/${request.siteId}/branches/${request.branchId}/documents/${docPath}/can-agent-edit`;
    const headers = this.getAgentEditHeaders(request.intent, request.targetRegions, request.trigger, request.requestedById, request.operationType);
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
    const data = await this.handleResponse<{ allowed: boolean; reason?: string; message?: string; conflictingRegions?: string[] }>(response);
    return { canEdit: data.allowed, reason: data.reason, message: data.message, conflictingRegions: data.conflictingRegions };
  }

  async startAgentEdit(request: StartAgentEditRequest): Promise<StartAgentEditResponse> {
    const docPath = this.normalizePath(request.documentPath);
    const url = `${this.baseUrl}/api/sites/${request.siteId}/branches/${request.branchId}/documents/${docPath}/agent-edit-start`;
    const headers = this.getAgentEditHeaders(request.intent, request.targetRegions, request.trigger, request.requestedById, request.operationType);
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
    const docPath = this.normalizePath(request.documentPath);
    const url = `${this.baseUrl}/api/sites/${request.siteId}/branches/${request.branchId}/documents/${docPath}/edits`;
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ operations: request.operations, actorId: this.agentId, editSessionId: request.editSessionId }),
    });
    return this.handleResponse<ApplyEditsResponse>(response);
  }

  async completeAgentEdit(request: CompleteAgentEditRequest): Promise<CompleteAgentEditResponse> {
    const docPath = this.normalizePath(request.documentPath);
    const url = `${this.baseUrl}/api/sites/${request.siteId}/branches/${request.branchId}/documents/${docPath}/agent-edit-complete`;
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'X-Agent-Id': this.agentId },
      body: JSON.stringify({ editSessionId: request.editSessionId }),
    });
    return this.handleResponse<CompleteAgentEditResponse>(response);
  }

  async abortAgentEdit(request: AbortAgentEditRequest): Promise<AbortAgentEditResponse> {
    const docPath = this.normalizePath(request.documentPath);
    const url = `${this.baseUrl}/api/sites/${request.siteId}/branches/${request.branchId}/documents/${docPath}/agent-edit-abort`;
    const body: Record<string, string> = { editSessionId: request.editSessionId };
    if (request.reason) body.reason = request.reason;
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'X-Agent-Id': this.agentId },
      body: JSON.stringify(body),
    });
    return this.handleResponse<AbortAgentEditResponse>(response);
  }

  async getBranchPresence(siteId: string, branchId: string): Promise<BranchPresenceResponse> {
    const response = await this.doFetch(`${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/presence`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<BranchPresenceResponse>(response);
  }

  async getDocumentPresence(siteId: string, branchId: string, documentPath: string): Promise<DocumentPresenceResponse> {
    const encodedPath = encodeURIComponent(documentPath);
    const response = await this.doFetch(
      `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${encodedPath}/presence`,
      { method: 'GET', headers: this.getHeaders() },
    );
    return this.handleResponse<DocumentPresenceResponse>(response);
  }
}
