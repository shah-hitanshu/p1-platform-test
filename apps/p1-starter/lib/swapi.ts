import type {
  RemoteDatasourceFetcher,
  RemoteDatasourceFetcherParams,
} from "@pantheon-systems/puck-css/server";
import { getFirstValue, savedValue } from "./fetcher-helpers";

const SWAPI_BASE = "https://swapi.info/api";

function swapiPersonIdFromUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const m = url.match(/\/people\/(\d+)\/?$/);
  return m?.[1];
}

function resolveSwapiId(params: RemoteDatasourceFetcherParams): string | undefined {
  const { searchParams, urlParams, savedPreviewParams } = params;
  const idFromQuery = getFirstValue(searchParams, "id");
  const idSavedRaw = savedValue(savedPreviewParams, "id");
  const idFromSaved = idSavedRaw && /^\d+$/.test(idSavedRaw) ? idSavedRaw : undefined;
  const idFromPath = urlParams.id && /^\d+$/.test(urlParams.id) ? urlParams.id : undefined;
  return idFromQuery ?? idFromSaved ?? idFromPath;
}

async function fetchSwapiPerson(
  id: string | undefined,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  if (!id || !/^\d+$/.test(id)) return {};
  try {
    const res = await fetchImpl(`${SWAPI_BASE}/people/${id}`);
    if (!res.ok) return {};
    const json: unknown = await res.json();
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return json as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function fetchSwapiPeopleList(
  fetchImpl: typeof fetch,
): Promise<{ id: string; name: string; url?: string }[]> {
  try {
    const res = await fetchImpl(`${SWAPI_BASE}/people`);
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const results = Array.isArray(json) ? json : null;
    if (!results) return [];
    const out: { id: string; name: string; url?: string }[] = [];
    for (const row of results) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      const id = swapiPersonIdFromUrl(r.url);
      const name = typeof r.name === "string" ? r.name : "";
      const url = typeof r.url === "string" ? r.url : undefined;
      if (id && name) out.push({ id, name, url });
    }
    return out;
  } catch {
    return [];
  }
}

export const SWAPI_FETCHERS: RemoteDatasourceFetcher[] = [
  {
    id: "swapi",
    fetch: async (params) => fetchSwapiPerson(resolveSwapiId(params), params.fetchImpl),
  },
  {
    id: "swapi_list",
    fetch: async (params) => ({ items: await fetchSwapiPeopleList(params.fetchImpl) }),
  },
];
