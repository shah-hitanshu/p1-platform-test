---
"@pantheon-systems/p1-next-sdk": minor
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Feature]** `createPublishedPage()` is a new export from `@pantheon-systems/p1-next-sdk/server`. It builds the published-page render pipeline — read, status branch, route templates, datasource resolution, render — so route files don't have to assemble it by hand.

### What Changed

- The pipeline used to be hand-written in `app/page.tsx` and `app/[...puckPath]/page.tsx`, so every scaffolded project froze a copy of it. Improvements to caching or datasource resolution could never reach a project once it was created. Both starter routes are now shims of under 25 lines.
- What genuinely differs per app flows in as options: `Client` (which holds the app's `puck.config`), `Unavailable`, `Fallback` for a home page with no document yet, `fetchers`, `resolveMetadata`, and `titles`.
- `internalPathPrefixes` is forwarded to `loadPublishedPage`, so the reserved-namespace denylist stays a single decision.
- The home route now resolves CCR query datasources, which only the catch-all did before. A data-bound component on the home page previously rendered against an unresolved context.

### Migration / Action Required

None — existing route files keep working. To adopt it, build the factory once in a shared module and re-export from both routes:

```tsx
// app/published-pages.tsx
export const published = createPublishedPage({
  Client,
  Unavailable: ContentUnavailable,
  Fallback: WelcomeBlock,
  fetchers: REMOTE_DATASOURCE_FETCHERS,
  resolveMetadata: resolvePageMetadata,
  titles: { home: "My Site" },
});

// app/[...puckPath]/page.tsx
export const revalidate = 300;
export const generateStaticParams = published.generateStaticParams;
export const generateMetadata = published.generateMetadata;
export default published.Page;
```

`revalidate` must stay a literal in the route file. Next.js statically analyzes segment-config exports, so a value re-exported through the factory goes undetected and the route silently loses its revalidation window — the same constraint that keeps `dynamic` in the route file for `createP1Pages`.
