/**
 * Template Store Interface
 *
 * Defines the contract for template storage and retrieval.
 * Implementations can use localStorage, CSS documents, or backend API.
 */

import type {
  Template,
  TemplateBinding,
  CreateTemplateParams,
  UpdateTemplateParams,
} from '../types.js';

/**
 * Template store interface for CRUD operations and bindings.
 */
export interface TemplateStore {
  /**
   * Create a new template.
   */
  create(params: CreateTemplateParams): Promise<Template>;

  /**
   * Get a template by ID.
   */
  get(id: string): Promise<Template | undefined>;

  /**
   * List all templates.
   */
  list(): Promise<Template[]>;

  /**
   * Update an existing template.
   * Increments the version number.
   */
  update(id: string, params: UpdateTemplateParams): Promise<Template>;

  /**
   * Delete a template.
   */
  delete(id: string): Promise<void>;

  /**
   * Get the template binding for a document.
   */
  getBinding(documentId: string): Promise<TemplateBinding | undefined>;

  /**
   * Set a template binding for a document.
   */
  setBinding(documentId: string, templateId: string, templateVersion: number): Promise<void>;

  /**
   * List all document bindings for a template.
   */
  listBindings(templateId: string): Promise<TemplateBinding[]>;

  /**
   * Remove a template binding for a document.
   */
  removeBinding(documentId: string): Promise<void>;
}

/**
 * Generate a unique template ID.
 */
function generateId(): string {
  return `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create an in-memory template store for testing and development.
 */
export function createInMemoryTemplateStore(): TemplateStore {
  const templates = new Map<string, Template>();
  const bindings = new Map<string, TemplateBinding>();

  return {
    async create(params: CreateTemplateParams): Promise<Template> {
      const now = new Date().toISOString();
      const template: Template = {
        id: generateId(),
        name: params.name,
        label: params.label,
        description: params.description,
        defaultUrlPattern: params.defaultUrlPattern,
        version: 1,
        components: params.components,
        createdAt: now,
        updatedAt: now,
      };

      templates.set(template.id, template);
      return template;
    },

    async get(id: string): Promise<Template | undefined> {
      return templates.get(id);
    },

    async list(): Promise<Template[]> {
      return Array.from(templates.values());
    },

    async update(id: string, params: UpdateTemplateParams): Promise<Template> {
      const existing = templates.get(id);
      if (!existing) {
        throw new Error('Template not found');
      }

      const updated: Template = {
        ...existing,
        label: params.label ?? existing.label,
        description: params.description ?? existing.description,
        defaultUrlPattern: params.defaultUrlPattern ?? existing.defaultUrlPattern,
        components: params.components ?? existing.components,
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      };

      templates.set(id, updated);
      return updated;
    },

    async delete(id: string): Promise<void> {
      templates.delete(id);
    },

    async getBinding(documentId: string): Promise<TemplateBinding | undefined> {
      return bindings.get(documentId);
    },

    async setBinding(
      documentId: string,
      templateId: string,
      templateVersion: number
    ): Promise<void> {
      bindings.set(documentId, {
        documentId,
        templateId,
        templateVersion,
      });
    },

    async listBindings(templateId: string): Promise<TemplateBinding[]> {
      return Array.from(bindings.values()).filter((b) => b.templateId === templateId);
    },

    async removeBinding(documentId: string): Promise<void> {
      bindings.delete(documentId);
    },
  };
}
