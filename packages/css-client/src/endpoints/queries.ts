import type { Query, QueryResults, QueryResultsParams } from '../types.js';
import type { BaseEndpoint } from './base.js';

export class QueriesEndpoint {
  constructor(private readonly base: BaseEndpoint) {}

  async list(siteId: string, branchId: string): Promise<Query[]> {
    const response = await this.base.request<{ queries: Query[] }>(
      `/api/sites/${siteId}/branches/${branchId}/queries`,
      { method: 'GET' }
    );
    return response.queries;
  }

  async get(siteId: string, branchId: string, name: string): Promise<Query> {
    return this.base.request<Query>(
      `/api/sites/${siteId}/branches/${branchId}/queries/${name}`,
      { method: 'GET' }
    );
  }

  async delete(siteId: string, branchId: string, name: string): Promise<void> {
    await this.base.request<void>(
      `/api/sites/${siteId}/branches/${branchId}/queries/${name}`,
      { method: 'DELETE' }
    );
  }

  async getResults(
    siteId: string,
    branchId: string,
    queryName: string,
    params?: QueryResultsParams
  ): Promise<QueryResults> {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) {
      searchParams.set('limit', String(params.limit));
    }
    if (params?.offset !== undefined) {
      searchParams.set('offset', String(params.offset));
    }
    const qs = searchParams.toString();
    const path = `/api/sites/${siteId}/branches/${branchId}/queries/${queryName}/results${qs ? `?${qs}` : ''}`;

    return this.base.request<QueryResults>(path, { method: 'GET' });
  }
}
