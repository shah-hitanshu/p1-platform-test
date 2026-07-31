/**
 * Catalog of template remote data sources (`{{ source.path }}`).
 * Consuming apps provide builtin datasource definitions to populate the editor's autocomplete.
 */

export type RemoteDatasourceFieldDoc = {
  /** Dot path under the source key, e.g. `name` or `homeworld` */
  path: string;
  description: string;
};

export type RemoteDatasourceDefinition = {
  /** Identifier in templates, e.g. `source` in `{{ source.field }}` */
  id: string;
  label: string;
  description: string;
  /** How this source is populated for the current page (query, path, etc.) */
  resolution: string;
  fields: RemoteDatasourceFieldDoc[];
};

import type { HttpJsonRemoteDatasourceDefinition } from "./user-remote-datasource-types";

export function buildRemoteDatasourceRegistry(
  builtinRemoteDatasources: RemoteDatasourceDefinition[],
  globalRemoteDatasources: HttpJsonRemoteDatasourceDefinition[] = [],
  pageRemoteDatasources: HttpJsonRemoteDatasourceDefinition[] = []
): RemoteDatasourceDefinition[] {
  const mapped = [...globalRemoteDatasources, ...pageRemoteDatasources].map((def) => ({
    id: def.id,
    label: def.label,
    description: def.description,
    resolution:
      "HTTP JSON remote datasource configured in the editor. URL/headers/query can include templates like `{{ urlParams.id }}`.",
    fields: def.fields,
  }));
  return [...builtinRemoteDatasources, ...mapped];
}
