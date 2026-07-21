/**
 * Versions Endpoint
 *
 * API operations for document versions.
 */

import type { DocumentVersion, CreateDocumentVersionParams, PaginationOptions } from '../types.js';
import type { BaseEndpoint } from './base.js';

export class VersionsEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Get the latest version of a document on a branch.
   */
  async getLatest(siteId: string, branchId: string, documentId: string): Promise<DocumentVersion> {
    return this.base.request<DocumentVersion>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions/latest`,
      { method: 'GET' }
    );
  }

  /**
   * Get a specific version by ID.
   */
  async get(siteId: string, branchId: string, documentId: string, versionId: string): Promise<DocumentVersion> {
    return this.base.request<DocumentVersion>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions/${versionId}`,
      { method: 'GET' }
    );
  }

  /**
   * List all versions of a document on a branch.
   */
  async list(
    siteId: string,
    branchId: string,
    documentId: string,
    options?: PaginationOptions
  ): Promise<DocumentVersion[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }

    const query = params.toString();
    const path = query
      ? `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions?${query}`
      : `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions`;

    const response = await this.base.request<{ versions: DocumentVersion[] }>(path, {
      method: 'GET',
    });

    return response.versions;
  }

  /**
   * Create a new version of a document.
   */
  async create(
    siteId: string,
    params: CreateDocumentVersionParams,
    options?: { keepalive?: boolean }
  ): Promise<DocumentVersion> {
    const body: Record<string, unknown> = { snapshot: params.snapshot };
    if (params.puckActions && params.puckActions.length > 0) {
      body.puckActions = params.puckActions;
    }
    return this.base.request<DocumentVersion>(
      `/api/sites/${siteId}/branches/${params.branchId}/documents/${params.documentId}/versions`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        keepalive: options?.keepalive,
      }
    );
  }

  /**
   * Restore a previous version, promoting it to the current state of the document.
   *
   * The server creates a new CoW version entry referencing the same immutable
   * snapshot data as the source version — no data round-trip required.
   *
   * @see https://github.com/pantheon-systems/collaborative-state-system/issues/80
   */
  async restore(
    siteId: string,
    branchId: string,
    documentId: string,
    versionId: string,
  ): Promise<DocumentVersion> {
    return this.base.request<DocumentVersion>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions/${versionId}/restore`,
      { method: 'POST' }
    );
  }
}
