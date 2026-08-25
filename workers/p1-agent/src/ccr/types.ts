import type { TemplateSnapshot } from '@pantheon-systems/p1-content-validator';

export interface DocumentInfo {
  id: string;
  path: string;
  createdAt: string;
}

export interface ListDocumentsResponse {
  documents: DocumentInfo[];
}

/**
 * Document record from the by-path lookup. Carries the template linkage used
 * for structural conformance validation (absent on documents with no template).
 */
export interface DocumentInfoWithTemplate extends DocumentInfo {
  templateId?: string;
  templateVersion?: number;
}

/**
 * A template's version snapshot: Puck data (identical in shape to a page, so it
 * satisfies the validator's {@link TemplateSnapshot} contract directly), plus
 * identity fields, spread flat rather than wrapped under `.snapshot`.
 * `root.props._pinMap` maps a component id to its pinned flag.
 */
export type TemplateDetail = TemplateSnapshot & {
  id: string;
  name?: string;
  version?: number;
};

/**
 * A page template as the picker sees it. The component tree is deliberately absent: which
 * template fits a brief is decided from what the template is *for*, and sending layouts would
 * cost tokens without improving the answer.
 */
export interface TemplateSummaryInfo {
  id: string;
  name: string;
  label?: string;
  description?: string;
  /** Route shape, e.g. `/blog/:slug`, used to build the new page's path. */
  defaultUrlPattern?: string;
  deprecated?: boolean;
}

export interface ListTemplatesResponse {
  templates: TemplateSummaryInfo[];
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

// Operation shape accepted by the CCR backend's /edits endpoint. The agent
// speaks a friendlier vocabulary (add/remove/replace/move); see translateOp
// in tools/execute-tool.ts for the mapping.
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
