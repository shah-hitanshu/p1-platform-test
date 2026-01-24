/**
 * Documents API Module
 */

import type { Document } from '../types';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

interface DocumentsResponse {
  documents: Document[];
}

interface CreateDocumentParams {
  path: string;
}

interface UpdateDocumentParams {
  path?: string;
}

/**
 * List documents for a site
 */
export async function listDocuments(
  siteId: string,
  options?: { pathPrefix?: string; archived?: boolean }
): Promise<Document[]> {
  let url = `/api/sites/${siteId}/documents`;
  const params = new URLSearchParams();

  if (options?.pathPrefix) {
    params.set('pathPrefix', options.pathPrefix);
  }
  if (options?.archived !== undefined) {
    params.set('archived', String(options.archived));
  }

  if (params.toString()) {
    url += `?${params.toString()}`;
  }

  const response = await apiGet<DocumentsResponse>(url);
  return response.documents;
}

/**
 * Get a single document
 */
export async function getDocument(
  siteId: string,
  documentId: string
): Promise<Document> {
  return apiGet<Document>(`/api/sites/${siteId}/documents/${documentId}`);
}

/**
 * Create a new document
 */
export async function createDocument(
  siteId: string,
  params: CreateDocumentParams
): Promise<Document> {
  return apiPost<Document>(`/api/sites/${siteId}/documents`, params);
}

/**
 * Update a document
 */
export async function updateDocument(
  siteId: string,
  documentId: string,
  params: UpdateDocumentParams
): Promise<Document> {
  return apiPatch<Document>(
    `/api/sites/${siteId}/documents/${documentId}`,
    params
  );
}

/**
 * Archive (soft delete) a document
 */
export async function archiveDocument(
  siteId: string,
  documentId: string
): Promise<void> {
  return apiDelete(`/api/sites/${siteId}/documents/${documentId}`);
}

/**
 * Restore an archived document
 */
export async function restoreDocument(
  siteId: string,
  documentId: string
): Promise<Document> {
  return apiPost<Document>(
    `/api/sites/${siteId}/documents/${documentId}/restore`
  );
}
