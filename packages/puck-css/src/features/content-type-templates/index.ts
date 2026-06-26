/**
 * Content Type Templates Feature
 *
 * Enables site admins to define structural templates for documents
 * and enforce structural conformance via role-based permissions.
 *
 * Feature-gated via enableContentTypeTemplates flag (default: true).
 */

export type {
  ContentRole,
  TemplateMetadata,
  TemplateComponent,
  Template,
  TemplateBinding,
  CreateTemplateParams,
  UpdateTemplateParams,
  TemplateDocument,
} from './types.js';

export type { TemplateStore } from './stores/index.js';
export { createInMemoryTemplateStore, createApiTemplateStore } from './stores/index.js';

export type { ComponentPermissions } from './permissions/role-permissions.js';
export {
  getPermissionsForRole,
  canPerformStructuralAction,
  canEditProps,
  canOverrideUrl,
  mergePermissions,
} from './permissions/role-permissions.js';
export type { UseContentRoleReturn } from './permissions/useContentRole.js';
export { useContentRole } from './permissions/useContentRole.js';
export type { UseResolveContentRoleOptions, UseResolveContentRoleReturn } from './permissions/useResolveContentRole.js';
export { useResolveContentRole, mapCssRoleToContentRole } from './permissions/useResolveContentRole.js';
