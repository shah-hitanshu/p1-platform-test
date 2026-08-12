import type { RemoteDatasourceFieldDoc } from "./remote-datasources/remote-datasource-registry.js";

export type FieldRole =
  | "title"
  | "subtitle"
  | "meta"
  | "image"
  | "teaser"
  | "icon";

const ROLE_PATTERNS: Record<FieldRole, RegExp> = {
  title: /\b(title|name|headline|label|heading)\b/i,
  subtitle: /\b(subtitle|summary|excerpt|description|abstract)\b/i,
  meta: /\b(date|published|created|updated|category|author)\b/i,
  image: /\b(image|photo|thumbnail|picture|avatar|src)\b/i,
  teaser: /\b(teaser|preview|snippet|blurb|intro)\b/i,
  icon: /\b(icon|logo|badge|symbol|emoji)\b/i,
};

function normalizePath(path: string): string {
  return path
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]/g, " ")
    .toLowerCase();
}

export function suggestFieldForRole(
  fields: RemoteDatasourceFieldDoc[],
  role: FieldRole,
): string | null {
  const pattern = ROLE_PATTERNS[role];
  const match = fields.find((f) => pattern.test(normalizePath(f.path)));
  return match?.path ?? null;
}

export function autoMapFields(
  fields: RemoteDatasourceFieldDoc[],
): Partial<Record<FieldRole, string>> {
  const result: Partial<Record<FieldRole, string>> = {};
  const used = new Set<string>();
  const roles: FieldRole[] = [
    "title",
    "subtitle",
    "meta",
    "image",
    "teaser",
    "icon",
  ];

  for (const role of roles) {
    const match = fields.find(
      (f) =>
        !used.has(f.path) && ROLE_PATTERNS[role].test(normalizePath(f.path)),
    );
    if (match) {
      result[role] = match.path;
      used.add(match.path);
    }
  }

  if (!result.title && fields.length > 0) {
    const fallback = fields.find((f) => !used.has(f.path));
    if (fallback) {
      result.title = fallback.path;
    }
  }

  return result;
}
