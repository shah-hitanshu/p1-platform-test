import type {
  RemoteDatasourceFetcher,
  RemoteDatasourceFetcherParams,
} from "@pantheon-systems/puck-css/server";
import { getFirstValue, savedValue } from "./fetcher-helpers";

const GRAPHQL_POKEMON_ENDPOINT = "https://graphqlpokemon.favware.tech/v8";
const MONSTER_INDEX_REGEX = /^[a-z0-9][a-z0-9_-]*$/i;

function asMonsterIndex(
  value: string | undefined,
  allowNumeric = true,
): string | undefined {
  if (!value) return undefined;
  if (!MONSTER_INDEX_REGEX.test(value)) return undefined;
  if (!allowNumeric && /^\d+$/.test(value)) return undefined;
  return value;
}

function resolveMonsterIndex(params: RemoteDatasourceFetcherParams): string | undefined {
  const { searchParams, urlParams, savedPreviewParams } = params;
  return (
    asMonsterIndex(getFirstValue(searchParams, "monster")) ??
    asMonsterIndex(getFirstValue(searchParams, "monsterIndex")) ??
    asMonsterIndex(getFirstValue(searchParams, "index")) ??
    asMonsterIndex(getFirstValue(searchParams, "id"), false) ??
    asMonsterIndex(savedValue(savedPreviewParams, "monster")) ??
    asMonsterIndex(savedValue(savedPreviewParams, "monsterIndex")) ??
    asMonsterIndex(savedValue(savedPreviewParams, "index")) ??
    asMonsterIndex(savedValue(savedPreviewParams, "id"), false) ??
    asMonsterIndex(urlParams.monster) ??
    asMonsterIndex(urlParams.monsterIndex) ??
    asMonsterIndex(urlParams.index) ??
    asMonsterIndex(urlParams.id, false)
  );
}

async function fetchMonster(
  index: string | undefined,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  if (!index || !MONSTER_INDEX_REGEX.test(index)) return {};
  try {
    const res = await fetchImpl(GRAPHQL_POKEMON_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query GetPokemon($pokemon: PokemonEnum!) {
  getPokemon(pokemon: $pokemon) {
    key
    num
    species
    types
    abilities { first second hidden special }
    hp attack defense spAtk spDef speed sprite
  }
}`,
        variables: { pokemon: index },
      }),
    });
    if (!res.ok) return {};
    const json: unknown = await res.json();
    if (!json || typeof json !== "object" || Array.isArray(json)) return {};
    const data = (json as { data?: unknown }).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const pokemon = (data as { getPokemon?: unknown }).getPokemon;
    if (pokemon && typeof pokemon === "object" && !Array.isArray(pokemon)) {
      const row = pokemon as Record<string, unknown>;
      return { ...row, index: row.key, name: row.species, url: `/pokemon/${index}` };
    }
    return {};
  } catch {
    return {};
  }
}

async function fetchMonsterList(
  fetchImpl: typeof fetch,
): Promise<{ index: string; name: string; url?: string }[]> {
  try {
    const res = await fetchImpl(GRAPHQL_POKEMON_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query GetAllPokemon($take: Int!, $offset: Int!) {
  getAllPokemon(take: $take, offset: $offset) {
    key
    species
  }
}`,
        variables: { take: 200, offset: 89 },
      }),
    });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    if (!json || typeof json !== "object" || Array.isArray(json)) return [];
    const data = (json as { data?: unknown }).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const results = (data as { getAllPokemon?: unknown }).getAllPokemon;
    if (!Array.isArray(results)) return [];
    const out: { index: string; name: string; url?: string }[] = [];
    for (const row of results) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      const index = typeof r.key === "string" ? r.key : "";
      const name = typeof r.species === "string" ? r.species : "";
      const url = index ? `/pokemon/${index}` : undefined;
      if (index && name) out.push({ index, name, url });
    }
    return out;
  } catch {
    return [];
  }
}

export const MONSTER_FETCHERS: RemoteDatasourceFetcher[] = [
  {
    id: "monster",
    fetch: async (params) => fetchMonster(resolveMonsterIndex(params), params.fetchImpl),
  },
  {
    id: "monster_list",
    fetch: async (params) => ({ items: await fetchMonsterList(params.fetchImpl) }),
  },
];
