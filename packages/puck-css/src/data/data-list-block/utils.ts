import type { ResolvedItem } from "./types.js";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function getByDotPath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) return undefined;
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    )
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const TEMPLATE_DATASOURCE_PREFIX = "templates.";

export function isTemplateDatasource(datasourceId: string | undefined): boolean {
  return !!datasourceId?.startsWith(TEMPLATE_DATASOURCE_PREFIX);
}

export function viewExtractKey(templateValue: string): string {
  const match = /^\{\{\s*item\.([^\s{}]+)\s*\}\}$/.exec(templateValue);
  return match ? (match[1] ?? "") : "";
}

export function resolveField(
  item: Record<string, unknown>,
  templateValue: string,
): string {
  const key = viewExtractKey(templateValue);
  if (!key) return "";
  const val = getByDotPath(item, key);
  if (val == null) return "";
  if (Array.isArray(val)) {
    if (val.length > 0 && typeof val[0] === "object") return JSON.stringify(val);
    return val.join(", ");
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export function resolveItemFields(
  item: Record<string, unknown>,
  mappings: {
    titleField: string;
    subtitleField: string;
    teaserField: string;
    imageField: string;
    iconField: string;
  },
): ResolvedItem {
  return {
    title: resolveField(item, mappings.titleField),
    subtitle: resolveField(item, mappings.subtitleField),
    teaser: resolveField(item, mappings.teaserField),
    image: resolveField(item, mappings.imageField),
    icon: resolveField(item, mappings.iconField),
    _raw: item,
  };
}

export function normalizeItems(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // not JSON
    }
  }
  return [];
}
