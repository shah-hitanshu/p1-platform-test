/**
 * Editor URL → page path mapping, shared by the server page handler and the
 * client-side editor. Pure and client-safe: the editor renders from a
 * persistent layout (so it survives route-param changes) and derives its page
 * path from usePathname() with these helpers, which must agree with the
 * server's parsing in pages-handler.
 */

import { pagePathFromCatchAllSegments } from "@pantheon-systems/puck-css/routes";

export function parseEditorSegments(segments: string[]): string {
  if (segments.length === 0) return "/";
  const command = segments[0];

  // /p1/api/... is handled by the route handler, not the page
  if (command === "api") return "/";

  // /p1/edit/... -> editor for the path
  if (command === "edit") {
    return pagePathFromCatchAllSegments(segments.slice(1));
  }

  // /p1/... (anything else) -> editor for that path
  return pagePathFromCatchAllSegments(segments);
}

export function editorPagePathFromUrlPath(
  pathname: string,
  basePath = "/p1",
): string {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
    // Falling back silently would make the editor load and edit the root
    // document while the URL points somewhere else entirely.
    console.warn(
      `[p1-next-sdk] "${pathname}" is outside the editor base path "${basePath}"; ` +
        `falling back to the root page. If the editor is not mounted at ${basePath}, ` +
        `pass the correct basePath to editorPagePathFromUrlPath.`,
    );
    return "/";
  }
  const segments = pathname
    .slice(basePath.length)
    .split("/")
    .filter(Boolean);
  return parseEditorSegments(segments);
}
