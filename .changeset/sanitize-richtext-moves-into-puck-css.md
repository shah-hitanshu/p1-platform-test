---
"@pantheon-systems/puck-css": minor
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Feature]** The richtext sanitizer moves out of the template into `@pantheon-systems/puck-css/sanitize-richtext`, so a tightened allowlist reaches existing projects on a package upgrade instead of only new ones.

### What Changed

- `sanitizeRichtextHtml(html, options?)` is a new export from `@pantheon-systems/puck-css/sanitize-richtext`. It is the same DOMPurify wrapper the scaffold used to carry: it allows the inline formatting, lists and links the richtext editor produces, strips everything else, and holds links to `https:`, `http:`, `mailto:`, `tel:`, `ftp:` and relative or same-page hrefs. It runs under SSR and in the browser, and `isomorphic-dompurify` is now puck-css's dependency rather than each project's.
- It pairs with `richtextField` / `createRichtextField`, which produce the HTML it sanitizes. Those live in puck-css, so the allowlist that reads their output now versions with them.
- **`options` extends the allowlists and cannot narrow them.** `allowedTags` and `allowedAttrs` merge on top of the defaults for a block that needs a tag or attribute the defaults omit. Nothing removes a default, nothing widens the link-protocol allowlist, and additions that would let stored content run script — `<script>`, `<iframe>`, `<object>`, `<form>`, `<svg>`, any `on*` handler, `srcdoc`, `formaction` — are dropped rather than honoured. They are dropped instead of throwing so a bad option can't take a published page down.
- **Its own entry point, not part of `/fields`.** `/fields` is a client module that lazily pulls the editor toolbar; a block's render path is also evaluated on the server, and routing it through a client boundary would drag the subtree client-side.
- The starter's `components/puck/sanitize-richtext.ts` is gone and its blocks import the shared function. Scaffolds keep rendering the same markup.

### Migration / Action Required

None to keep working — a project that still has the local copy keeps using it. To hand the sanitizer over to the package, delete `components/puck/sanitize-richtext.ts`, drop the `isomorphic-dompurify` dependency, and repoint the import:

```tsx
- import { sanitizeRichtextHtml } from "./sanitize-richtext";
+ import { sanitizeRichtextHtml } from "@pantheon-systems/puck-css/sanitize-richtext";
```

One behaviour note for a project doing that swap: the shared defaults also allow `h2`, `h3`, `blockquote` and `mark`. The editor's schema can represent all four, so a paste carries them into the stored value, and the scaffold's narrower copy was discarding them at render. After the swap they render. A project that wants them gone should strip them on the way in rather than at the render boundary.

For a block that needs to render something the defaults omit:

```tsx
sanitizeRichtextHtml(value, { allowedTags: ["figure", "figcaption"] });
```
