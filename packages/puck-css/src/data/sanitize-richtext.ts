import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize richtext HTML before rendering it via `dangerouslySetInnerHTML`.
 *
 * Blocks store the value of a `richtext` field as an HTML string and render it
 * on the public, server-rendered surface. This is defense-in-depth at the
 * render boundary: it does not rely on the editor's schema, or on the editor's
 * default link-protocol handling, to be the only thing standing between stored
 * content and the DOM. `<script>`, `<img onerror>`, and `javascript:`/`data:`
 * hrefs are stripped regardless of how they got into the stored value.
 *
 * Runs in both Node (SSR) and the browser.
 */

/**
 * Tags the editor can produce, and that are safe to render as-is: inline
 * formatting, lists, links, and the block elements a paste can carry through
 * the editor schema.
 */
const DEFAULT_ALLOWED_TAGS: readonly string[] = [
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
  "h2",
  "h3",
  "blockquote",
  "mark",
];

const DEFAULT_ALLOWED_ATTRS: readonly string[] = ["href", "target", "rel"];

/**
 * Tags that `allowedTags` can never add. Each one either executes script,
 * loads a foreign document, navigates on the reader's behalf, or opens a
 * namespace-confusion path — none of which a richtext value has any business
 * doing, whatever the caller's intent.
 *
 * Resource-loading tags are here for a subtler reason than the rest: DOMPurify
 * permits `data:` URIs on `img`/`video`/`audio`/`source`/`track` regardless of
 * `ALLOWED_URI_REGEXP`. Letting a caller add one would quietly reopen the
 * protocol allowlist this module treats as fixed, so they stay out; a block
 * that needs inline media should use a dedicated field rather than richtext.
 */
const NEVER_ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "script",
  "noscript",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "link",
  "meta",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "template",
  "svg",
  "math",
  "html",
  "head",
  "body",
  "title",
  "img",
  "image",
  "picture",
  "source",
  "video",
  "audio",
  "track",
  "canvas",
  "map",
  "area",
]);

/**
 * Attributes that `allowedAttrs` can never add, alongside every `on*` event
 * handler. `src` and `style` are here for the same reason as the resource
 * tags: both fetch a URL the protocol allowlist never sees.
 */
const NEVER_ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  "srcdoc",
  "formaction",
  "xlink:href",
  "xmlns",
  "xmlns:xlink",
  "src",
  "style",
]);

/**
 * Only safe link protocols, plus relative and same-page hrefs. Not
 * configurable: widening it is how `javascript:` gets back in.
 */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|tel:|ftp:|#|\/|\.)/i;

export interface SanitizeRichtextOptions {
  /** Extra tags to permit, on top of the defaults. */
  allowedTags?: readonly string[];
  /** Extra attributes to permit, on top of the defaults. */
  allowedAttrs?: readonly string[];
}

function isEventHandler(attr: string): boolean {
  return attr.startsWith("on");
}

function extend(
  defaults: readonly string[],
  additions: readonly string[] | undefined,
  forbidden: ReadonlySet<string>,
  isAlwaysForbidden: (value: string) => boolean = () => false,
): string[] {
  if (!additions?.length) return [...defaults];

  const merged = new Set(defaults);
  for (const raw of additions) {
    const value = raw.toLowerCase();
    if (forbidden.has(value) || isAlwaysForbidden(value)) continue;
    merged.add(value);
  }
  return [...merged];
}

/**
 * Sanitize a richtext HTML string for rendering.
 *
 * `options` is additive only. Entries in `allowedTags`/`allowedAttrs` are
 * merged on top of the defaults; nothing can remove a default, narrow the
 * link-protocol allowlist, or introduce a tag or attribute that would let
 * stored content run script. Values that would do so are dropped rather than
 * throwing, so a bad option can't take down a published page.
 *
 * @param html Stored richtext HTML.
 * @param options Additive allowlist extensions.
 * @returns Sanitized HTML, safe to pass to `dangerouslySetInnerHTML`.
 */
export function sanitizeRichtextHtml(
  html: string,
  options?: SanitizeRichtextOptions,
): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: extend(
      DEFAULT_ALLOWED_TAGS,
      options?.allowedTags,
      NEVER_ALLOWED_TAGS,
    ),
    ALLOWED_ATTR: extend(
      DEFAULT_ALLOWED_ATTRS,
      options?.allowedAttrs,
      NEVER_ALLOWED_ATTRS,
      isEventHandler,
    ),
    ALLOWED_URI_REGEXP,
  });
}
