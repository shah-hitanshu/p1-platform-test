import type { RemoteDatasourceDefinition } from "@pantheon-systems/p1-client-sdk";

export const REMOTE_DATASOURCE_REGISTRY: RemoteDatasourceDefinition[] = [
  {
    id: "swapi",
    label: "Star Wars API (person)",
    description:
      "Person record from SWAPI. Used when editing pages that resolve a numeric person id (see resolution).",
    resolution:
      "Query `?id=<n>` takes precedence. If omitted, a numeric `:id` is read from the URL when it matches a collection template in the database (see `resolveSwapiIdFromPagePath`).",
    fields: [
      { path: "name", description: "Character name" },
      { path: "height", description: "Height" },
      { path: "mass", description: "Mass" },
      { path: "hair_color", description: "Hair color" },
      { path: "skin_color", description: "Skin color" },
      { path: "eye_color", description: "Eye color" },
      { path: "birth_year", description: "Birth year" },
      { path: "gender", description: "Gender" },
      { path: "homeworld", description: "URL of homeworld resource" },
      { path: "films", description: "Film resource URLs" },
      { path: "species", description: "Species resource URLs" },
      { path: "vehicles", description: "Vehicle resource URLs" },
      { path: "starships", description: "Starship resource URLs" },
      { path: "created", description: "Record creation timestamp" },
      { path: "edited", description: "Record edit timestamp" },
      { path: "url", description: "Canonical person URL" },
    ],
  },
  {
    id: "monster",
    label: "Pokemon GraphQL (pokemon)",
    description: "Single pokemon record from GraphQL Pokemon (`getPokemon`).",
    resolution:
      "Resolved from query params (`?monster=...`, `?monsterIndex=...`, `?index=...`, then `?id=...`), preview params, or route params (`:monster`, `:monsterIndex`, `:index`, `:id`).",
    fields: [
      { path: "index", description: "Pokemon slug (mapped from `key`)." },
      {
        path: "name",
        description: "Pokemon display name (mapped from `species`).",
      },
      { path: "num", description: "Pokedex number." },
      { path: "types", description: "Type list." },
      { path: "abilities", description: "Abilities object." },
      { path: "hp", description: "HP stat." },
      { path: "attack", description: "Attack stat." },
      { path: "defense", description: "Defense stat." },
      { path: "speed", description: "Speed stat." },
      { path: "sprite", description: "Sprite URL." },
      { path: "url", description: "Synthetic URL path for this monster." },
    ],
  },
  {
    id: "urlParams",
    label: "Route URL params",
    description:
      "Captured params from route templates (for example `/jedis/:id`). Available to all templates.",
    resolution:
      "Derived from concrete URL path matches and editor preview params; query params with the same key override preview values.",
    fields: [{ path: "id", description: "Example route param value" }],
  },
  {
    id: "swapi_list",
    label: "Star Wars API (people index)",
    description:
      "First page of SWAPI `/people/` (loaded every request). Use with a List block and `markdownLinks` token.",
    resolution:
      "First `/people/` page is fetched on every request (alongside the single-person `swapi` row). Extra SWAPI traffic on person-scoped pages; swap to lazy loading if you need to optimize.",
    fields: [
      {
        path: "items",
        description:
          "Array of `{ id, name }` rows from SWAPI `/people/`. In an Array field, set value to `{{ swapi_list.items }}` to hydrate cards/rows.",
      },
      {
        path: "items.0.url",
        description:
          "Canonical SWAPI URL for each item (available as `item.url` in per-card templates).",
      },
      {
        path: "markdownLinks",
        description:
          'In a List block\'s items field: `{{ swapi_list.markdownLinks "/jedi/{id}" }}` (or bare `{{ swapi_list.markdownLinks }}`) -- expands to one `[name](/jedi/n)` line per person.',
      },
    ],
  },
  {
    id: "monster_list",
    label: "Pokemon GraphQL (pokemon index)",
    description:
      "Pokemon list from GraphQL Pokemon `getAllPokemon` (loaded every request).",
    resolution:
      "Fetched on every request, independent of SWAPI/person id preview settings. Uses `getAllPokemon(take, offset)`.",
    fields: [
      {
        path: "items",
        description:
          "Array of `{ index, name, url }` rows from `getAllPokemon` (mapped from `key` + `species`). In an Array field, set `{{ monster_list.items }}` to hydrate cards/rows.",
      },
      {
        path: "items.0.index",
        description: "Pokemon slug/index (for example `bulbasaur`).",
      },
      {
        path: "items.0.name",
        description: "Display name (for example `Bulbasaur`).",
      },
      {
        path: "items.0.url",
        description: "Synthetic URL path for per-item links.",
      },
    ],
  },
  {
    id: "article",
    label: "Content Publisher (article)",
    description:
      "Single Content Publisher article resolved from query/preview/route params.",
    resolution:
      "Resolved from `?article=...`, `?articleId=...`, `?slug=...`, then `?id=...`; then preview params; then route params (`:article`, `:articleId`, `:slug`, `:id`). Loaded using `PCCConvenienceFunctions.getArticleBySlugOrId` from `@pantheon-systems/cpub-react-sdk/server`.",
    fields: [
      { path: "id", description: "Article identifier." },
      { path: "title", description: "Article title." },
      { path: "slug", description: "Slug/path alias if present." },
      {
        path: "body",
        description: "Body/content payload (shape depends on API).",
      },
      { path: "url", description: "Canonical article URL if present." },
    ],
  },
  {
    id: "article_list",
    label: "Content Publisher (articles index)",
    description:
      "Article list from Content Publisher, loaded every request for list rendering.",
    resolution:
      "Fetched every request using `PCCConvenienceFunctions.getPaginatedArticles` from `@pantheon-systems/cpub-react-sdk/server`.",
    fields: [
      {
        path: "items",
        description:
          "Array of normalized `{ id, title, slug?, url? }` rows. Use `{{ article_list.items }}` to hydrate array/list blocks.",
      },
      { path: "items.0.id", description: "Article identifier." },
      { path: "items.0.title", description: "Article title." },
      {
        path: "items.0.slug",
        description: "Article slug/path alias if present.",
      },
      { path: "items.0.url", description: "Canonical URL if present." },
    ],
  },
];
