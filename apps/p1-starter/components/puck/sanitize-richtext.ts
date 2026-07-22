import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize richtext HTML before it is rendered via `dangerouslySetInnerHTML`.
 *
 * Blocks render editor-authored richtext as an HTML string on the public,
 * server-rendered surface. This is defense-in-depth at the render boundary:
 * it does not rely on the richtext editor's schema or on TipTap's default
 * link-protocol allowlist to be the only thing standing between stored content
 * and the DOM. The allowlist below matches what the richtext toolbar can
 * actually produce (inline formatting + lists + links); anything else —
 * `<script>`, `<img onerror>`, `javascript:`/`data:` hrefs — is stripped.
 *
 * Runs in both Node (SSR) and the browser via isomorphic-dompurify.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "code",
  "span",
];

const ALLOWED_ATTR = ["href", "target", "rel"];

export function sanitizeRichtextHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Explicit protocol allowlist (defense-in-depth over DOMPurify's default,
    // which already rejects javascript:/unknown schemes): only safe link
    // protocols, plus relative/anchor hrefs.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|ftp:|#|\/|\.)/i,
  });
}
