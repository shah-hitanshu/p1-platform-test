import { getPage } from "./get-page";
import {
  getRawPropValue,
  MAX_XREF_DEPTH,
  CROSS_PAGE_REF_REGEX,
} from "./cross-reference";
import { stripTrailingSlash } from "./paths";
import { rawValueToString } from "./utils";

/**
 * Resolves `{{ pages["/"].blocks["id"].props.x }}` into raw values
 * from other routes. Recurses until no tokens remain or depth limit. Does not apply datasource templates.
 */
export function resolveCrossPageTemplates(input: string, depth = 0): string {
  if (depth > MAX_XREF_DEPTH) return "";

  if (input.search(CROSS_PAGE_REF_REGEX) === -1) return input;

  const out = input.replace(
    CROSS_PAGE_REF_REGEX,
    (whole, pathLit: string, blockLit: string, propKey: string) => {
      try {
        // Decode the JSON-encoded path/block captures and look up the referenced prop value.
        const path = JSON.parse(pathLit) as string;
        const blockId = JSON.parse(blockLit) as string;
        const p = stripTrailingSlash(path);
        const page = getPage(p);
        if (!page) return "";
        const raw = getRawPropValue(page, blockId, propKey);
        return rawValueToString(raw);
      } catch {
        return whole;
      }
    }
  );

  if (out === input) return input;

  if (out.search(CROSS_PAGE_REF_REGEX) === -1) return out;

  return resolveCrossPageTemplates(out, depth + 1);
}
