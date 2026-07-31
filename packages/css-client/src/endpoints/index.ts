/**
 * Endpoints barrel export.
 */

export { BaseEndpoint } from './base.js';
export type { BaseEndpointConfig, RequestOptions } from './base.js';
export { SitesEndpoint } from './sites.js';
export { BranchesEndpoint } from './branches.js';
export { DocumentsEndpoint } from './documents.js';
export { VersionsEndpoint } from './versions.js';
export { CheckpointsEndpoint } from './checkpoints.js';

// Agent Politeness endpoints
export { PresenceEndpoint } from './presence.js';
export { AgentRegistryEndpoint } from './agent-registry.js';
export { AgentEditEndpoint } from './agent-edit.js';

// Merge endpoints
export { MergeEndpoint } from './merge.js';

// Content Type Templates endpoints
export { TemplatesEndpoint } from './templates.js';
export { MigrationConflictsEndpoint } from './migration-conflicts.js';

// Query endpoints
export { QueriesEndpoint } from './queries.js';
