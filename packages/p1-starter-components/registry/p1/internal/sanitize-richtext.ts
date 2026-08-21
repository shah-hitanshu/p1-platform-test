import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize richtext HTML before rendering via `dangerouslySetInnerHTML`.
 *
 * Allowlist matches what the Puck richtext toolbar can produce; anything
 * else — `<script>`, `<img onerror>`, `javascript:`/`data:` hrefs — is
 * stripped. Runs in both Node (SSR) and the browser via isomorphic-dompurify.
 */
const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "ul", "ol", "li", "a", "code", "span",
  "h2", "h3", "blockquote", "mark",
];

const ALLOWED_ATTR = ["href", "target", "rel"];

export function sanitizeRichtextHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|ftp:|#|\/|\.)/i,
  });
}
