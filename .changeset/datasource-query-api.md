---
"@pantheon-systems/css-client": minor
"@pantheon-systems/p1-next-sdk": minor
"@pantheon-systems/puck-css": patch
---

**css-client:** Add Datasource and Query API endpoints. `DatasourcesEndpoint` provides `list`, `get`, and `delete` for content type datasources. `QueriesEndpoint` provides `list`, `get`, `delete`, and `getResults` with pagination support. New types exported: `Datasource`, `Query`, `QueryResults`, `QueryResultItem`, `QueryResultsMeta`, `QuerySortField`, and `QueryResultsParams`.

**p1-next-sdk:** Integrate CSS query fetchers into server-side rendering. `createCssQueryFetchers` converts CSS queries into `RemoteDatasourceFetcher` instances for SSR data pre-fetching. Query fetchers are wired into the `datasource-context` and `editor-context` routes. Gracefully handles environments where the queries endpoint is unavailable.

**puck-css:** Add `cssQueriesToDatasourceDefinitions` adapter to transform CSS query metadata into `RemoteDatasourceDefinition` entries for the editor datasource registry. Fix `mergeBlockForPreview` and `mergeRootForPreview` to preserve React element props (e.g. contentEditable spans) instead of overwriting them with resolved string values. Fix template overlay text visibility and caret rendering. Pass auth tokens to editor-context and datasource-context fetch calls when available.
