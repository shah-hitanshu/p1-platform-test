---
"@pantheon-systems/puck-css": minor
"@pantheon-systems/p1-next-sdk": patch
---

**[Fix]** Requests for static assets no longer reach the document API.

### What Changed

- Paths ending in a known static-asset extension (`.js`, `.css`, `.png`, `.webp`, `.svg`, fonts, media, and friends) return `null` from `getPage` without a document lookup. Previously each of these 404s cost a content-API round trip and live Postgres work.
- `normalizePath` now rejects those paths too, so a page can no longer be published at a path the renderer refuses to resolve.
- `hasStaticAssetExtension` is exported from `@pantheon-systems/puck-css` and `/server`.

### Notes

- Page slugs may legitimately contain dots, so the check matches an explicit extension list rather than treating any dot as an extension. `/v1.2-release-notes` still resolves.
- `.html`, `.php`, `.aspx`, and `.pdf` are deliberately **not** short-circuited — sites migrating off a legacy CMS serve real pages at those paths.
- Redirect lookups are unaffected: redirects are user-configured for arbitrary paths, including old asset URLs that a migrating site points at a new home, so the middleware still resolves them for asset-extension paths.
