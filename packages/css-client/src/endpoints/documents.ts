/**
 * Documents Endpoint
 *
 * API operations for documents.
 */

import type { Document, CreateDocumentParams, ListDocumentsOptions, PublishDocumentResult } from '../types.js';
import type { BaseEndpoint } from './base.js';

export class DocumentsEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  /**
   * Get a document by ID.
   */
  async get(siteId: string, documentId: string): Promise<Document> {
    return this.base.request<Document>(`/api/sites/${siteId}/documents/${documentId}`, {
      method: 'GET',
    });
  }

  /**
   * Get a document by path on a specific branch.
   */
  async getByPath(siteId: string, path: string): Promise<Document> {
    const encodedPath = encodeURIComponent(path);
    return this.base.request<Document>(`/api/sites/${siteId}/documents/by-path/${encodedPath}`, {
      method: 'GET',
    });
  }

  /**
   * List documents on a branch.
   */
  async list(siteId: string, branchId: string, options?: ListDocumentsOptions): Promise<Document[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.pathPrefix !== undefined) {
      params.set('pathPrefix', options.pathPrefix);
    }

    const query = params.toString();
    const path = query
      ? `/api/sites/${siteId}/branches/${branchId}/documents?${query}`
      : `/api/sites/${siteId}/branches/${branchId}/documents`;

    const response = await this.base.request<{ documents: Document[] }>(path, {
      method: 'GET',
    });

    return response.documents;
  }

  /**
   * Create a new document on a branch.
   */
  async create(params: CreateDocumentParams): Promise<Document> {
    const response = await this.base.request<{ document: Document }>(
      `/api/sites/${params.siteId}/branches/${params.branchId}/documents`,
      {
        method: 'POST',
        body: JSON.stringify({ path: params.path }),
      }
    );

    return response.document;
  }

  /**
   * Delete a document from a branch.
   */
  async delete(siteId: string, branchId: string, documentId: string): Promise<void> {
    await this.base.request<void>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}`,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * Check if a document exists on a branch.
   */
  async exists(siteId: string, branchId: string, documentId: string): Promise<boolean> {
    try {
      await this.base.request<Document>(
        `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}`,
        { method: 'GET' }
      );
      return true;
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Restore an archived document.
   * This unarchives a soft-deleted document, making it active again.
   */
  async restore(siteId: string, documentId: string): Promise<Document> {
    return this.base.request<Document>(
      `/api/sites/${siteId}/documents/${documentId}/restore`,
      {
        method: 'POST',
      }
    );
  }

  /**
   * Publish a single document on a branch.
   * Creates a checkpoint containing only this document's current version.
   */
  async publish(siteId: string, branchId: string, documentId: string): Promise<PublishDocumentResult> {
    return this.base.request<PublishDocumentResult>(
      `/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/publish`,
      { method: 'POST' }
    );
  }
}
