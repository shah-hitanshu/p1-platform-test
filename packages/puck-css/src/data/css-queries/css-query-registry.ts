import type { RemoteDatasourceDefinition } from "../remote-datasources/remote-datasource-registry";

export const CSS_QUERY_ID_PREFIX = "templates.";

interface CssQueryInput {
  name: string;
  datasource: string;
  includeMetadata: boolean;
  includeSnapshot: boolean;
}

function kebabToTitleCase(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const RESULT_FIELDS: { path: string; description: string }[] = [
  { path: "items", description: "Array of matching documents" },
  { path: "returnedCount", description: "Number of items returned" },
  { path: "query.name", description: "Query name" },
  { path: "query.sortedBy", description: "Sort order applied" },
  { path: "items[].documentId", description: "Document UUID" },
  { path: "items[].path", description: "Document path" },
  { path: "items[].createdAt", description: "Document creation timestamp" },
  { path: "items[].metadata", description: "Document metadata (title, custom fields)" },
  { path: "items[].snapshot", description: "Full document content snapshot" },
];

export function cssQueriesToDatasourceDefinitions(
  queries: CssQueryInput[],
): RemoteDatasourceDefinition[] {
  return queries.map((query) => ({
    id: `${CSS_QUERY_ID_PREFIX}${query.name}`,
    label: kebabToTitleCase(query.datasource),
    description: `Content query for ${query.datasource} pages`,
    resolution: "CSS content query (auto-generated from content type template)",
    fields: RESULT_FIELDS,
  }));
}
