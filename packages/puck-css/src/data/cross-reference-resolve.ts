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
export async function resolveCrossPageTemplates(input: string, depth = 0): Promise<string> {
  if (depth > MAX_XREF_DEPTH) return "";

  if (input.search(CROSS_PAGE_REF_REGEX) === -1) return input;

  // Collect all matches
  const matches: { whole: string; pathLit: string; blockLit: string; propKey: string }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CROSS_PAGE_REF_REGEX.source, CROSS_PAGE_REF_REGEX.flags);
  while ((m = re.exec(input)) !== null) {
    matches.push({ whole: m[0], pathLit: m[1] ?? "", blockLit: m[2] ?? "", propKey: m[3] ?? "" });
  }

  // Deduplicate getPage calls — collect unique paths, fetch each once
  const uniquePaths = new Set<string>();
  const parsedMatches: { whole: string; path: string; blockId: string; propKey: string }[] = [];
  for (const { whole, pathLit, blockLit, propKey } of matches) {
    try {
      const path = stripTrailingSlash(JSON.parse(pathLit) as string);
      const blockId = JSON.parse(blockLit) as string;
      uniquePaths.add(path);
      parsedMatches.push({ whole, path, blockId, propKey });
    } catch {
      parsedMatches.push({ whole, path: "", blockId: "", propKey });
    }
  }

  const pageCache = new Map<string, Awaited<ReturnType<typeof getPage>>>();
  await Promise.all(
    Array.from(uniquePaths).map(async (p) => {
      pageCache.set(p, await getPage(p));
    })
  );

  const replacements = parsedMatches.map(({ whole, path, blockId, propKey }) => {
    if (!path) return { whole, replacement: whole };
    const page = pageCache.get(path);
    if (!page) return { whole, replacement: "" };
    const raw = getRawPropValue(page, blockId, propKey);
    return { whole, replacement: rawValueToString(raw) };
  });

  let out = input;
  for (const { whole, replacement } of replacements) {
    out = out.replace(whole, replacement);
  }

  if (out === input) return input;

  if (out.search(CROSS_PAGE_REF_REGEX) === -1) return out;

  return resolveCrossPageTemplates(out, depth + 1);
}
