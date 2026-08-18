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

// Loop rather than /\/+$/: the regex backtracks quadratically on long slash
// runs, and this sees request-controlled paths.
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  return path.slice(0, end);
}

export const PATH_REGEX = /^\/[a-zA-Z0-9/_\-:.]+$/;

const RESERVED_PATH_PREFIXES = ["/p1", "/puck", "/_next"];

export function isReservedPath(normalized: string): boolean {
  return RESERVED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

// Deliberately excludes .html/.php/.aspx/.pdf: sites migrating off a legacy CMS
// serve real pages at those paths. Everything here is a build artifact no
// document can ever answer for.
const STATIC_ASSET_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "css", "map",
  "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp4", "webm", "ogg", "mp3", "wav",
]);

/**
 * True for paths whose last segment ends in a known static-asset extension.
 * Page slugs may contain dots, so this matches an explicit extension list
 * rather than treating any dot as an extension.
 */
export function hasStaticAssetExtension(path: string): boolean {
  const lastSegment = trimTrailingSlashes(path).split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }
  return STATIC_ASSET_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase());
}

/**
 * Coerce unknown input to a trimmed, trailing-slash-stripped path,
 * then validate format and reject reserved prefixes and static-asset paths.
 * Returns `null` when the input is invalid, reserved, or unrenderable.
 */
export function normalizePath(path: unknown): string | null {
  const raw = typeof path === "string" ? path.trim() : "";
  const normalized = stripTrailingSlash(raw);
  if (normalized !== "/" && !PATH_REGEX.test(normalized)) {
    return null;
  }
  if (isReservedPath(normalized) || hasStaticAssetExtension(normalized)) {
    return null;
  }
  return normalized;
}
