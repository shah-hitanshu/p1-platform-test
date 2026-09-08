---
"@pantheon-systems/p1-next-sdk": minor
"@pantheon-systems/puck-css": minor
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Feature]** The SEO layer moves out of the template: metadata resolution into `@pantheon-systems/p1-next-sdk/server`, the editor field definitions into `@pantheon-systems/puck-css/seo`.

### What Changed

- `resolvePageMetadata()` and `buildPageMetadata()` are new exports from `@pantheon-systems/p1-next-sdk/server`. They map the stored root props (`_seo`, `_meta`) onto Next's `Metadata` — a mapping coupled to those shapes, not to a site's branding, so a copy in every scaffold could only fall behind them. The app's datasource fetcher registry is injected as `fetchers`, and `transform` gets the last word on the emitted metadata for tags a site wants to add or override — it receives the page and the authored values with any `{{ }}` already resolved, so a site can emit a tag from a field it added without resolving templates itself.
- `createPublishedPage()` now defaults `resolveMetadata` to that resolver, passing the `fetchers` it already holds. Metadata behaviour therefore arrives with a package upgrade. Passing `resolveMetadata` still replaces the mapping outright.
- `createSeoRootFields()` is a new export from `@pantheon-systems/puck-css/seo` (`src/data/page-metadata/`), along with `OG_TYPES`, `TWITTER_CARDS`, `DEFAULT_EDITOR_ROOT_TITLE` and the `PageMetaFields` type. It returns the `_meta` object field — the dropdown vocabularies, the help text, and the placeholders showing what an empty field inherits. puck-css owns the shape stored at `root.props._meta`, so the fields that write it now version with it.
- **The stored `_meta` shape stays extensible.** Every field in the group templates except `ogType` and `twitterCard`, whose values are checked against a union — so a field a site adds to the group gets `{{ }}` resolution like the built-in ones, and reaches `<head>` through `transform`. Previously the templated fields were a fixed list, which is why extending the group is worth a mention: nothing about it is closed.
- `@pantheon-systems/puck-css/seo` is its own entry point rather than part of the `/fields` barrel: `/fields` is a client module, and a Puck config is also evaluated on the server.
- The starter's `lib/page-seo.ts`, `lib/seo-metadata.ts` and `lib/seo-metadata.consts.ts` are gone, and `components/puck/root.tsx` is down to its own title, description, and render wrapper. Rendered tags are unchanged — the suites that pinned them moved into the packages alongside the code.

### Migration / Action Required

None — an app that passes its own `resolveMetadata` keeps working. To hand the metadata layer over to the packages, delete the local copies and compose the field set:

```tsx
// app/published-pages.tsx — drop resolveMetadata entirely
export const published = createPublishedPage({
  Client,
  Unavailable: ContentUnavailable,
  Fallback: WelcomeBlock,
  fetchers: REMOTE_DATASOURCE_FETCHERS,
});

// components/puck/root.tsx
import { createSeoRootFields, DEFAULT_EDITOR_ROOT_TITLE } from "@pantheon-systems/puck-css/seo";

const buildFields = (rootProps?: Record<string, unknown>) => ({
  title: { type: "text" as const },
  description: { type: "textarea" as const },
  ...createSeoRootFields(rootProps),
});

export const puckRoot = {
  fields: buildFields(),
  resolveFields: (data) => buildFields(data.props ?? {}),
  defaultProps: { title: DEFAULT_EDITOR_ROOT_TITLE },
  render: ({ children }) => <div className="font-sans antialiased">{children}</div>,
};
```

To keep site-specific tags on top of the shared mapping, wrap the resolver rather than replacing it:

```tsx
resolveMetadata: (args) =>
  resolvePageMetadata({
    ...args,
    fetchers: REMOTE_DATASOURCE_FETCHERS,
    transform: (metadata, { meta }) => ({ ...metadata, keywords: meta.keywords }),
  }),
```

The starter's README documents that seam under Customization, alongside adding a field to the group itself.
