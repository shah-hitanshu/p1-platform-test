import type { RemoteDatasourceDefinition } from "./remote-datasources/remote-datasource-registry";

export type TemplateSuggestion = {
  /** Full token to insert, e.g. `{{ source.field }}` */
  insert: string;
  /** Short label for the list */
  label: string;
  /** Secondary line (field description) */
  description?: string;
};

type FunctionExample = {
  fn: string;
  args: (examplePath: string) => string;
  description: string;
};

const FUNCTION_EXAMPLES: FunctionExample[] = [
  { fn: "toUpperCase", args: (p) => p, description: "Uppercase text" },
  { fn: "trim", args: (p) => p, description: "Trim whitespace" },
  { fn: "replace", args: (p) => `${p}, "a", "A"`, description: "Replace first occurrence" },
  { fn: "slice", args: (p) => `${p}, 0, 4`, description: "Substring by index range" },
  { fn: "default", args: (p) => `${p}, "Unknown"`, description: "Fallback when value is empty" },
  { fn: "truncate", args: (p) => `${p}, 12, "..."`, description: "Shorten with suffix" },
];

function buildFunctionTemplateSuggestions(
  registry: RemoteDatasourceDefinition[]
): TemplateSuggestion[] {
  // Find a suitable example field from the first datasource in the registry
  let examplePath = "source.field";
  for (const def of registry) {
    if (def.fields.length > 0) {
      examplePath = `${def.id}.${def.fields[0]?.path ?? "field"}`;
      break;
    }
  }

  return FUNCTION_EXAMPLES.map((ex) => {
    const argsStr = ex.args(examplePath);
    return {
      insert: `{{ ${ex.fn}(${argsStr}) }}`,
      label: `${ex.fn}(${argsStr})`,
      description: ex.description,
    };
  });
}

/**
 * If the caret is inside an unclosed `{{ … }}` segment, returns the index of the first `{`
 * and the inner text after `{{` (trimmed for matching; whitespace is allowed in the document).
 */
export function getActiveRemoteDatasourceInterpolation(
  value: string,
  cursor: number
): { openIdx: number; query: string } | null {
  if (cursor < 0 || cursor > value.length) return null;
  const before = value.slice(0, cursor);
  const openIdx = before.lastIndexOf("{{");
  if (openIdx === -1) return null;
  const inner = value.slice(openIdx + 2, cursor);
  if (inner.includes("}}")) return null;
  return { openIdx, query: inner.trim() };
}

/**
 * Suggest `{{ source.path }}` templates from the datasource registry, filtered by the partial path after `{{`.
 */
export function remoteDatasourceTemplateSuggestions(
  query: string,
  registry: RemoteDatasourceDefinition[] = []
): TemplateSuggestion[] {
  const f = query.trim().toLowerCase();
  const functionSuggestions = buildFunctionTemplateSuggestions(registry);
  const results: TemplateSuggestion[] = functionSuggestions.filter(
    (item) => f === "" || item.label.toLowerCase().includes(f)
  );

  for (const def of registry) {
    const id = def.id;
    const idLower = id.toLowerCase();
    for (const field of def.fields) {
      const inner = `${id}.${field.path}`;
      const innerLower = inner.toLowerCase();
      const match =
        f === "" ||
        innerLower.startsWith(f) ||
        (!f.includes(".") && idLower.startsWith(f));
      if (!match) continue;
      results.push({
        insert: `{{ ${inner} }}`,
        label: inner,
        description: field.description,
      });
    }
  }

  results.sort((a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label));
  return results.slice(0, 40);
}
