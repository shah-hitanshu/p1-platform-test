export function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

export function isComponentNode(value: unknown): value is { type: string; props: Record<string, unknown> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return typeof o.type === "string" && o.props !== null && typeof o.props === "object" && !Array.isArray(o.props);
}

/** Strip a trailing slash, defaulting empty string to "/". */
export function stripTrailingSlash(path: string): string {
  return path.replace(/\/$/, "") || "/";
}

export const PATH_REGEX = /^\/[a-zA-Z0-9/_\-:.]+$/;

const RESERVED_PATH_PREFIXES = ["/p1", "/puck", "/structure", "/_next"];

export function isReservedPath(normalized: string): boolean {
  return RESERVED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Coerce unknown input to a trimmed, trailing-slash-stripped path,
 * then validate format and reject reserved prefixes.
 * Returns `null` when the input is invalid or reserved.
 */
export function normalizePath(path: unknown): string | null {
  const raw = typeof path === "string" ? path.trim() : "";
  const normalized = stripTrailingSlash(raw);
  if (normalized !== "/" && !PATH_REGEX.test(normalized)) {
    return null;
  }
  if (isReservedPath(normalized)) {
    return null;
  }
  return normalized;
}
