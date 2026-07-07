/**
 * P1 Content Client
 *
 * Read-only client for fetching published content from the P1 content delivery API.
 * Designed for server-side use (e.g., Next.js SSR/SSG) without pulling in
 * browser dependencies like partysocket.
 */

import { P1ApiError } from './errors.js';

export interface P1ContentClientConfig {
  baseUrl: string;
  apiToken: string;
  siteId: string;
  branchId?: string;
}

export interface PageContent {
  documentId: string;
  path: string;
  data: Record<string, unknown>;
  branchId: string;
  branchName: string;
  isMainBranch: boolean;
  versionNumber: number;
  versionCreatedAt: string;
  etag: string;
}

export interface PageListEntry {
  path: string;
  documentId: string;
  lastModifiedAt: string;
}

export interface PageListResult {
  pages: PageListEntry[];
  branchId: string;
  branchName: string;
  isMainBranch: boolean;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

function trimLeadingSlashes(value: string): string {
  let start = 0;
  while (start < value.length && value[start] === '/') start++;
  return value.slice(start);
}

export class P1ContentClient {
  private baseUrl: string;
  private apiToken: string;
  private siteId: string;
  private branchId?: string;

  constructor(config: P1ContentClientConfig) {
    this.baseUrl = trimTrailingSlashes(config.baseUrl);
    this.apiToken = config.apiToken;
    this.siteId = config.siteId;
    this.branchId = config.branchId;
  }

  async getPage(documentPath: string): Promise<PageContent | null> {
    // Special case: "/" is the root page - don't include it in the URL path
    const cleanPath = documentPath === '/' ? '' : trimLeadingSlashes(documentPath);
    const pathSegment = cleanPath ? `/${cleanPath}` : '';
    let url = `${this.baseUrl}/api/sites/${this.siteId}/content${pathSegment}`;
    if (this.branchId) {
      url += `?branch=${this.branchId}`;
    }
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.apiToken },
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new P1ApiError(
        (body as { error?: string }).error || `HTTP ${response.status}`,
        response.status
      );
    }
    return response.json() as Promise<PageContent>;
  }

  async getPagePaths(): Promise<PageListResult> {
    let url = `${this.baseUrl}/api/sites/${this.siteId}/content-pages`;
    if (this.branchId) {
      url += `?branch=${this.branchId}`;
    }
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.apiToken },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new P1ApiError(
        (body as { error?: string }).error || `HTTP ${response.status}`,
        response.status
      );
    }
    return response.json() as Promise<PageListResult>;
  }
}
