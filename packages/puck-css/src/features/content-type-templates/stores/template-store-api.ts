/**
 * API-Backed Template Store
 *
 * Production template store implementation using the backend API.
 */

import type { P1Client } from '@pantheon-systems/css-client';
import type { Template, TemplateSummary, TemplateBinding, CreateTemplateParams, UpdateTemplateParams } from '../types.js';
import type { TemplateStore } from './template-store.js';

/**
 * Create a template store backed by the P1 API.
 *
 * @param client - P1Client instance
 * @param siteId - Site ID
 * @param branchId - Branch ID
 * @returns TemplateStore instance
 */
export function createApiTemplateStore(
  client: P1Client,
  siteId: string,
  branchId: string
): TemplateStore {
  return {
    async create(params: CreateTemplateParams): Promise<Template> {
      const template = await client.templates.create(siteId, branchId, params);
      return template;
    },

    async get(id: string): Promise<Template | undefined> {
      try {
        const template = await client.templates.get(siteId, branchId, id);
        return template;
      } catch (error) {
        // Return undefined for 404s
        if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
          return undefined;
        }
        throw error;
      }
    },

    async list(): Promise<TemplateSummary[]> {
      return await client.templates.list(siteId, branchId);
    },

    async update(id: string, params: UpdateTemplateParams): Promise<Template> {
      return await client.templates.update(siteId, branchId, id, params);
    },

    async delete(id: string): Promise<void> {
      await client.templates.delete(siteId, branchId, id);
    },

    async getBinding(_documentId: string): Promise<TemplateBinding | undefined> {
      return undefined;
    },

    async setBinding(
      _documentId: string,
      _templateId: string,
      _templateVersion: number
    ): Promise<void> {
      throw new Error('Template bindings are managed server-side via document metadata. Use the documents API to set template_id.');
    },

    async listBindings(_templateId: string): Promise<TemplateBinding[]> {
      return [];
    },

    async removeBinding(_documentId: string): Promise<void> {
      throw new Error('Template bindings are managed server-side via document metadata. Use the documents API to update template_id.');
    },
  };
}
