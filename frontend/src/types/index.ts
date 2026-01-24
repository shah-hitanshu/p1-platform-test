/**
 * Frontend type definitions for the Collaborative State System API Explorer
 */

// User types
export interface User {
  id: string;
  email: string;
  name: string;
  siteRoles: Record<string, string>;
}

export interface Agent {
  id: string;
  name: string;
  siteRoles: Record<string, string>;
}

// Auth response types
export interface LoginResponse {
  token: string;
  user: User;
}

export interface UsersResponse {
  users: User[];
  agents: Agent[];
}

// Site types
export interface Site {
  id: string;
  pantheonSiteId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Branch types
export interface Branch {
  id: string;
  siteId: string;
  name: string;
  parentBranchId: string | null;
  status: 'active' | 'merged' | 'abandoned' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// Document types
export interface Document {
  id: string;
  siteId: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

// Checkpoint types
export interface Checkpoint {
  id: string;
  branchId: string;
  name: string;
  type: 'manual' | 'auto' | 'merge';
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
}

// Merge Request types
export interface MergeRequest {
  id: string;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  title: string;
  description: string | null;
  status: 'open' | 'merged' | 'closed' | 'conflict';
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
}

// Health check types
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  environment: string;
  timestamp: string;
  database?: {
    connected: boolean;
    latencyMs?: number;
    error?: string;
  };
}

// API error response
export interface ApiError {
  error: string;
  details?: unknown;
}

// Grant types
export interface Grant {
  id: string;
  branchId: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: string;
  grantedById: string;
  grantedByType: 'user' | 'agent';
  reason: string | null;
  grantedAt: string;
}

// Structure types
export interface Structure {
  id: string;
  siteId: string;
  name: string;
  slug: string;
  description: string | null;
  structureType: 'hierarchy' | 'collection';
  metadataSchema: Record<string, unknown> | null;
  schemaEnforcement: 'strict' | 'warn' | 'none';
  createdAt: string;
  updatedAt: string;
}

// Node types
export interface StructureNode {
  id: string;
  structureId: string;
  parentNodeId: string | null;
  name: string;
  slug: string;
  nodeType: 'section' | 'document' | 'external';
  documentId: string | null;
  externalUrl: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}
