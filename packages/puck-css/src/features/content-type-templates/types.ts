/**
 * Content Type Templates - Core Types
 *
 * TypeScript types and interfaces for the content type templates feature.
 */

/**
 * User role for content editing.
 *
 * - admin: Full access - can create/edit templates, full structural control
 * - editor: Pinned components locked (cannot move/delete), can add/remove non-pinned
 * - junior-editor: View/edit props only, no structural changes
 */
export type ContentRole = 'admin' | 'editor' | 'junior-editor';

export type {
  Template,
  TemplateSummary,
  TemplateMetadata,
  TemplateContentItem,
  TemplateRootProps,
  CreateTemplateParams,
  UpdateTemplateParams,
} from '@pantheon-systems/css-client';

/**
 * Document-to-template binding.
 * Stored in documents table columns (template_id, template_version).
 */
export interface TemplateBinding {
  /** Document ID */
  documentId: string;

  /** Template ID this document is bound to */
  templateId: string;

  /** Template version this document was created from or migrated to */
  templateVersion: number;
}
