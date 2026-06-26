/**
 * Content Type Templates - Core Types
 *
 * TypeScript types and interfaces for the content type templates feature.
 */

import type { Data } from '@puckeditor/core';

/**
 * User role for content editing.
 *
 * - admin: Full access - can create/edit templates, full structural control
 * - editor: Pinned components locked (cannot move/delete), can add/remove non-pinned
 * - junior-editor: View/edit props only, no structural changes
 */
export type ContentRole = 'admin' | 'editor' | 'junior-editor';

/**
 * Template metadata stored in root.props._templateMeta.
 */
export interface TemplateMetadata {
  /** Unique template name (kebab-case identifier) */
  name: string;

  /** Human-readable label */
  label: string;

  /** Optional description */
  description?: string;

  /** Optional default URL pattern for documents created from this template */
  defaultUrlPattern?: string;

  /** Template version number (incremented on each save) */
  version: number;
}

/**
 * A component in the template skeleton with pinned status.
 */
export interface TemplateComponent {
  /** Component type (e.g., "HeadingBlock", "TextBlock") */
  type: string;

  /** Whether this component is pinned (locked position) */
  pinned: boolean;

  /** Default props for this component */
  defaultProps: Record<string, unknown>;
}

/**
 * A complete template definition.
 */
export interface Template {
  /** Unique template ID */
  id: string;

  /** Template name (kebab-case identifier) */
  name: string;

  /** Human-readable label */
  label: string;

  /** Optional description */
  description?: string;

  /** Optional default URL pattern */
  defaultUrlPattern?: string;

  /** Template version number */
  version: number;

  /** Whether this template is deprecated */
  deprecated?: boolean;

  /** Component skeleton */
  components: TemplateComponent[];

  /** Creation timestamp (not returned by all endpoints) */
  createdAt?: string;

  /** Last update timestamp */
  updatedAt: string;
}

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

/**
 * Parameters for creating a template.
 */
export interface CreateTemplateParams {
  /** Template name (kebab-case identifier) */
  name: string;

  /** Human-readable label */
  label: string;

  /** Optional description */
  description?: string;

  /** Optional default URL pattern */
  defaultUrlPattern?: string;

  /** Initial component skeleton */
  components: TemplateComponent[];
}

/**
 * Parameters for updating a template.
 */
export interface UpdateTemplateParams {
  /** Updated label */
  label?: string;

  /** Updated description */
  description?: string;

  /** Updated default URL pattern */
  defaultUrlPattern?: string;

  /** Updated component skeleton */
  components?: TemplateComponent[];
}

/**
 * Template with full Puck data for editing.
 * Used when editing a template document in the editor.
 */
export interface TemplateDocument extends Template {
  /** Full Puck data structure */
  data: Data;
}
