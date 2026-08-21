/**
 * Templates Endpoint
 *
 * API operations for content type templates.
 */

import type {
  Template,
  TemplateSummary,
  CreateTemplateParams,
  UpdateTemplateParams,
  MigrationJob,
  MigrationPreview,
} from '../types.js';
import { requirePathParams } from '../utils.js';
import type { BaseEndpoint } from './base.js';

export class TemplatesEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * List all templates on a branch. Returns metadata summaries without
   * component data; use get() for a template's full snapshot.
   */
  async list(siteId: string, branchId: string): Promise<TemplateSummary[]> {
    requirePathParams({ siteId, branchId }, 'templates.list');

    const response = await this.base.request<{ templates: TemplateSummary[] }>(
      `/api/sites/${siteId}/branches/${branchId}/templates`,
      { method: 'GET' }
    );

    return response.templates;
  }

  /**
   * Get a template by ID.
   */
  async get(siteId: string, branchId: string, templateId: string): Promise<Template> {
    requirePathParams({ siteId, branchId, templateId }, 'templates.get');

    return this.base.request<Template>(`/api/sites/${siteId}/branches/${branchId}/templates/${templateId}`, {
      method: 'GET',
    });
  }

  /**
   * Create a new template on a branch.
   */
  async create(
    siteId: string,
    branchId: string,
    params: CreateTemplateParams
  ): Promise<Template> {
    requirePathParams({ siteId, branchId }, 'templates.create');

    return this.base.request<Template>(
      `/api/sites/${siteId}/branches/${branchId}/templates`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
  }

  /**
   * Update an existing template.
   */
  async update(
    siteId: string,
    branchId: string,
    templateId: string,
    params: UpdateTemplateParams
  ): Promise<Template> {
    requirePathParams({ siteId, branchId, templateId }, 'templates.update');

    return this.base.request<Template>(
      `/api/sites/${siteId}/branches/${branchId}/templates/${templateId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(params),
      }
    );
  }

  /**
   * Delete a template from a branch.
   */
  async delete(siteId: string, branchId: string, templateId: string): Promise<void> {
    requirePathParams({ siteId, branchId, templateId }, 'templates.delete');

    await this.base.request<void>(
      `/api/sites/${siteId}/branches/${branchId}/templates/${templateId}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Deprecate a template (soft-disable for new document creation).
   * Existing documents bound to this template continue to function.
   */
  async deprecate(siteId: string, branchId: string, templateId: string): Promise<Template> {
    requirePathParams({ siteId, branchId, templateId }, 'templates.deprecate');

    return this.base.request<Template>(
      `/api/sites/${siteId}/branches/${branchId}/templates/${templateId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ deprecated: true }),
      }
    );
  }

  /**
   * Reactivate a deprecated template.
   */
  async reactivate(siteId: string, branchId: string, templateId: string): Promise<Template> {
    requirePathParams({ siteId, branchId, templateId }, 'templates.reactivate');

    return this.base.request<Template>(
      `/api/sites/${siteId}/branches/${branchId}/templates/${templateId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ deprecated: false }),
      }
    );
  }

  /**
   * Trigger a template migration on a branch.
   */
  async migrate(
    siteId: string,
    branchId: string,
    templateId: string,
    params: { fromVersion: number; toVersion: number },
  ): Promise<MigrationJob> {
    requirePathParams({ siteId, branchId, templateId }, 'templates.migrate');

    const response = await this.base.request<{ job: MigrationJob }>(
      `/api/sites/${siteId}/branches/${branchId}/templates/${templateId}/migrate`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
    );
    return response.job;
  }

  /**
   * Preview a migration without executing it (dry-run). Pass detail to
   * include the per-document breakdown in the response.
   */
  async previewMigration(
    siteId: string,
    branchId: string,
    templateId: string,
    params: { fromVersion: number; toVersion: number },
    detail?: boolean,
  ): Promise<MigrationPreview> {
    requirePathParams({ siteId, branchId, templateId }, 'templates.previewMigration');

    const query = detail === true ? '?detail=true' : '';
    return this.base.request<MigrationPreview>(
      `/api/sites/${siteId}/branches/${branchId}/templates/${templateId}/migrate/preview${query}`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
    );
  }

  /**
   * Roll back a completed migration job.
   */
  async rollbackMigration(
    siteId: string,
    branchId: string,
    templateId: string,
    jobId: string,
  ): Promise<{ rolledBackDocuments: number }> {
    requirePathParams({ siteId, branchId, templateId, jobId }, 'templates.rollbackMigration');

    return this.base.request<{ rolledBackDocuments: number }>(
      `/api/sites/${siteId}/branches/${branchId}/templates/${templateId}/rollback`,
      {
        method: 'POST',
        body: JSON.stringify({ jobId }),
      },
    );
  }

  /**
   * Get migration job status.
   */
  async getMigrationJob(siteId: string, branchId: string, jobId: string): Promise<MigrationJob> {
    requirePathParams({ siteId, branchId, jobId }, 'templates.getMigrationJob');

    return this.base.request<MigrationJob>(
      `/api/sites/${siteId}/branches/${branchId}/migrations/${jobId}`,
      { method: 'GET' },
    );
  }

}
