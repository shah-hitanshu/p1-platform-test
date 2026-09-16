/**
 * Content Type Templates Feature
 *
 * Enables site admins to define structural templates for documents
 * and enforce structural conformance via backend permissions.
 *
 * Feature-gated via enableContentTypeTemplates flag (default: true).
 */

export type {
  TemplateMetadata,
  TemplateContentItem,
  TemplateRootProps,
  Template,
  TemplateSummary,
  TemplateBinding,
  CreateTemplateParams,
  UpdateTemplateParams,
} from './types.js';

export type { TemplateStore } from './stores/index.js';
export { createInMemoryTemplateStore, createApiTemplateStore } from './stores/index.js';

export type { PermissionsOutcome, UseResolvePermissionsOptions, UseResolvePermissionsReturn } from './permissions/useResolvePermissions.js';
export { useResolvePermissions } from './permissions/useResolvePermissions.js';
