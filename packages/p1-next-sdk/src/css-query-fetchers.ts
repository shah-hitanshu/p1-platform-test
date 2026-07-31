import {
  getSharedP1Client,
  getSharedSiteId,
  getSharedBranchId,
  CSS_QUERY_ID_PREFIX,
} from "@pantheon-systems/puck-css/server";
import type {
  RemoteDatasourceFetcher,
  P1StoreClient,
} from "@pantheon-systems/puck-css/server";

export interface CreateCssQueryFetchersOptions {
  client?: P1StoreClient | null;
  branchId?: string | null;
  filterIds?: Set<string>;
}

type QueriesEndpoint = NonNullable<P1StoreClient["queries"]>;
type QueryList = Awaited<ReturnType<QueriesEndpoint["list"]>>;

const inflightQueries = new Map<string, Promise<QueryList>>();

function listQueriesDeduped(
  endpoint: QueriesEndpoint,
  siteId: string,
  branchId: string,
): Promise<QueryList> {
  const key = `${siteId}:${branchId}`;
  const existing = inflightQueries.get(key);
  if (existing) return existing;
  const promise = endpoint.list(siteId, branchId).finally(() => {
    inflightQueries.delete(key);
  });
  inflightQueries.set(key, promise);
  return promise;
}

export async function createCssQueryFetchers(
  opts?: CreateCssQueryFetchersOptions,
): Promise<RemoteDatasourceFetcher[]> {
  const client = opts?.client ?? getSharedP1Client();
  const siteId = getSharedSiteId();
  const branchId = opts?.branchId || getSharedBranchId();

  if (!client?.queries || !siteId || !branchId) {
    return [];
  }

  const queries = client.queries;

  let allQueries;
  try {
    allQueries = await listQueriesDeduped(queries, siteId, branchId);
  } catch {
    return [];
  }

  const filterIds = opts?.filterIds;
  const filtered = filterIds
    ? allQueries.filter((q) => filterIds.has(`${CSS_QUERY_ID_PREFIX}${q.name}`))
    : allQueries;

  return filtered.map((query) => ({
    id: `${CSS_QUERY_ID_PREFIX}${query.name}`,
    fetch: async () => {
      try {
        const results = await queries.getResults(siteId, branchId, query.name);
        return results as unknown as Record<string, unknown>;
      } catch {
        return {};
      }
    },
  }));
}
