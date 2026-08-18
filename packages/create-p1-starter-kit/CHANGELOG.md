# @pantheon-systems/create-p1-starter-kit

## 0.11.0

### Minor Changes

- f55ce53: **[Fix]** Published pages are now cached instead of server-rendered on every request.

  ### What Changed

  Both public routes shipped with `export const dynamic = "force-dynamic"`, which disables the response cache and forces a full server render — and a round trip to the content API — for every visitor, on content that is identical for all of them. The catch-all route additionally read `searchParams`, which opts a route out of caching permanently on its own.

  Published pages no longer read the request query string, and the catch-all declares `generateStaticParams`, so responses now carry `s-maxage=300, stale-while-revalidate` and are cacheable by a CDN.

  `loadRemoteDatasourceContext` now accepts `searchParams` as optional.

  **A path with no published page is now a real 404.** It previously rendered the "this page doesn't exist yet" screen with a 200 status, which was harmless while every response was uncacheable. Now that the route is statically renderable, a 200 there means every URL a crawler probes becomes a cached response and an indexable page. The screen itself is unchanged — it moved to `app/not-found.tsx`, so it renders from the not-found boundary with a 404 status. A backend outage is deliberately _not_ a 404: it renders a separate, uncacheable holding page, because 404ing live content over a transient blip would deindex it.

  **Reads of published content moved into `@pantheon-systems/p1-next-sdk/server`** as `loadPublishedPage` and `loadRouteTemplateKeys`. They carry invariants that are easy to break by accident in a forked app — initialization awaited per read, misses distinguished from outages, prerendering aborted rather than baking an empty page into the build, and both reads memoized with React `cache()` so `generateMetadata` and the page body share one fetch instead of hitting Postgres twice. How a miss is _presented_ stays in the app.

  Initialization is likewise no longer pinned to a module-level promise in `createP1Handler` and `createP1Pages`. `ensureInitialized` clears its state on failure precisely so the next caller retries; awaiting a stored promise defeated that, so one transient failure at cold start left every later request awaiting a permanently rejected promise.

  **Publishing a route template now invalidates the public catch-all segment.** Instance URLs that resolve by template fall-through alone (`/jedi/5` against `/jedi/:id`) have no store entry, so they cannot be enumerated and were never revalidated — they served pre-edit content until `revalidate` expired. `createP1Handler` accepts `publicPageSegment` for an app whose catch-all is not `[...puckPath]`.

  ### Caching and publish visibility

  `revalidatePath` clears the Next.js response cache, so with no CDN in front an edit appears immediately — that invalidation was previously dead code, since there was never a cached response to invalidate. Behind a CDN that honors the advertised `s-maxage=300`, a publish takes up to 300s (plus `stale-while-revalidate`) to become visible, because nothing in this flow purges the CDN. Adding a purge hook to the publish path is what would close that window.

  ### Migration / Action Required

  The `?param=` **query override** no longer applies to published pages. Route template params are unaffected — they come from the path, so `/products/hats` still resolves `{{ urlParams.slug }}` as before. Only overriding that value with `?slug=…` stops working, along with any datasource driven purely by a query param.

  Editor preview is unaffected; it resolves params through the editor's own saved preview values.

  If a page genuinely needs query-driven content, read the query in a client component with `useSearchParams` — the page stays cached and only that subtree renders per request.

  A custom renderer that calls `getPage` directly should switch to `loadPublishedPage` from `@pantheon-systems/p1-next-sdk/server` and branch on its `status`, rather than treating a `null` return as both "missing" and "backend down".

### Patch Changes

- 863bff6: **[Fix]** Block images now lazy-load by default, so image-heavy pages stop fetching every image regardless of viewport.

  ### What Changed
  - `MediaImage` and `MediaFigure` render `loading="lazy"` + `decoding="async"` unless the caller passes `loading`, so custom blocks built on them inherit the behavior.
  - `createMediaFigureBlock` gained a "Loading" field (Lazy/Eager) whose default comes from the new `defaultLoading` option.
  - The data-list block's Cards/Rows/Listing layouts lazy-load item images, with a new "Image loading" field to opt an instance into eager.
  - The starter's primitive Image block gained the same Lazy/Eager field.

  ### Migration / Action Required

  Lazy loading applies retroactively: existing documents pick it up without being re-saved, so a published page whose LCP element is a hero or first-row listing image will load that image lazily after upgrading, and its LCP may regress until an editor opts back in. Set the block's loading field to "Eager" on above-the-fold images to restore the previous behavior.

- 079216a: **[Fix]** A newly scaffolded project now installs — `pnpm install` previously failed with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` before you could run anything.

  ### What Changed

  `@pantheon-systems/p1-ai-chat` and `@pantheon-systems/p1-media` were written into the generated `package.json` with an internal specifier that only resolves inside our own repository. Both are now ordinary version ranges, like every other dependency.

  ### Migration / Action Required

  Scaffold again with this release. A project generated by an earlier version cannot install as-is.

## 0.10.0

### Patch Changes

- e8a472a: Adds the DataListBlock ("List") view-system component: a datasource-driven Puck block that renders a collection in three modes — Grid (cards), Table (rows), and List (listing). Modes come from a registry (`builtin-modes.ts`) mapping each mode key to its layout component, image positions, mode-specific fields, and defaults, so a new mode can be added without touching the block itself. `createDataListBlock()` is exported for apps to instantiate with their own wrapper class.

  When a datasource is selected but field mappings are empty, `autoMapFields()` heuristically assigns datasource fields to the title, subtitle, teaser, image, and icon roles by name pattern, so a freshly dropped block renders real content instead of blanks.

  Adds collection operators (sort, filter, group-by, start-at, max-items, and conditional status filtering for CMS template datasources), applied in the block's `resolveData`.

  Sidebar fields are grouped into collapsible "Content" and "Layout & style" sections via `DataListFieldsGrouper`, which also hides fields belonging to inactive view modes. Puck's built-in field types are replaced throughout with PDS field wrappers (datasource-select, schema-select, template-select, view-mode, image-position) for consistent styling.

  `css-client` gains the query fields and types the block needs to read collection content; `p1-next-sdk` middleware and query fetchers pass them through. The starter-kit template build script now carries the new block's files.

- 74dda98: Adds a README to every published package. Each one rendered a blank page on npmjs.com, because
  no `README.md` existed in the package directory to be included in the tarball — npm renders the
  README from the published tarball, not from the source repository, so a private repo was never
  the cause.

  Also repoints every `repository` URL at `pantheon-systems/p1-platform` with the correct
  `directory`. They still referenced the pre-merge repositories (`puck-css-integration`,
  `collaborative-state-system`, `p1-media-r2`), so the "Repository" link on each npm page went
  nowhere. Adds a matching `homepage` for each package.

  No runtime code changes.

- abc522c: The starter's catch-all route now treats `_redirects/*` as an internal document namespace alongside `_registry/*`, so redirect records can never render as pages.

  Redirect records moved out of `_registry/`, which merge and checkpoint capture treat as code-owned and strip unconditionally — a redirect created on a workstream could never reach the main branch a live site resolves redirects against.

## 0.9.0

### Patch Changes

- 84907a1: Scaffolded sites' `body { margin: 0; }` reset in `app/styles.css` is now scoped via `body:has(> .p1-app-shell)` (with the matching wrapper added around `{children}` in `app/layout.tsx`) instead of a bare `body` selector. Puck's canvas-preview iframe copies every parent stylesheet verbatim and also syncs the host document's `<body>` attributes onto its own iframe `<body>`, so a bare or class-scoped `body` rule here could still match inside the iframe and override its design-token-based body styling (PCC-3499).

## 0.8.0

### Minor Changes

- 5075a8a: Sites scaffolded via `create-p1-starter-kit` now include the `@pantheon-systems/p1-media` plugin by default, alongside the existing plain-URL `ImageBlock`. A new `MediaFigureBlock` component adds a real versioned media library and asset picker (metadata, alt text, cropping) to the "Media" category. The plugin is on by default with no feature flag; `siteId`/auth resolve automatically from the ambient P1 editor context. Set `NEXT_PUBLIC_MEDIA_BASE_URL` to override the CDN origin used for URL validation in non-production deployments (defaults to the production origin).

### Patch Changes

- Minimum supported Node.js is now 24. The `engines.node` field on these packages moved from `>=18.0.0`/`>=20.12.0` to `>=24.0.0`, so installs on older Node will warn (or fail, depending on your package manager's `engine-strict` setting).
- `ParagraphBlock` in the scaffolded template now uses `richtextField` from `@pantheon-systems/puck-css/fields` instead of a textarea plus ReactMarkdown, enabling inline canvas editing, TipTap-backed rich text, AI generation hints, and the shared Bold/Italic/Underline/BulletList/OrderedList menu with no per-block configuration. Because the richtext field stores HTML rather than markdown, the render path sanitizes it through a shared SSR-safe sanitizer (allowlisting inline formatting, lists, and safe-protocol links) before it reaches `dangerouslySetInnerHTML`. The template also registers `@tailwindcss/typography` so `prose` list markers render under Tailwind v4 Preflight.

## 0.7.0

## 0.6.0

### Patch Changes

- 986075f: Add the LaunchDarkly-gated `p1-chatbot` AI assistant to the starter-kit editor. The chatbot renders only when the `p1-chatbot` LaunchDarkly flag is enabled and an agent URL is configured, so scaffolded sites ship with it off by default until opted in.

## 0.5.0

### Patch Changes

- efb961d: Fix the starter kit's auth route forcing Google's full re-authentication screen on every login (`prompt: 'login'`), even with a live browser session. Sites scaffolded via `create-p1-starter-kit` now use `prompt: 'select_account'`, so an existing Google session is reused with a lightweight account-chooser step instead of forcing full re-auth, while still letting users switch accounts on logout/login.

## 0.4.4

### Patch Changes

- Fix editing the root "/" homepage from the editor page switcher: selecting the homepage now opens the editor instead of navigating to the dashboard, and all pages route through a single `/p1/` separator via `editorPathHref` (also fixing non-root page links).

## 0.4.3

### Patch Changes

- Bug fixes and improvements: deferred branch detection for read:published tokens, init promise retry, production backend URL handling, editor top menu UI improvements.

## 0.4.2

### Patch Changes

- dc7cfd7: Fix packages being published with unresolved workspace:\* references by switching from npm publish to pnpm publish. Fix starter kit CLI to show "npm run dev" instead of "npm dev" for npm users.
