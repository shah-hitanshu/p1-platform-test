# @pantheon-systems/p1-next-sdk

## 0.12.0

### Patch Changes

- Updated dependencies [5c8b489]
- Updated dependencies [93f4976]
- Updated dependencies [b99acfb]
- Updated dependencies [b99acfb]
- Updated dependencies [716771a]
- Updated dependencies [c9e31fb]
  - @pantheon-systems/puck-css@0.12.0
  - @pantheon-systems/css-client@0.12.0

## 0.11.1

### Patch Changes

- a16d921: Set `license` to `UNLICENSED` to match the rest of the suite. These packages had drifted
  to `MIT` (or had no `license` field at all), but they are closed-source and were never
  intended to be published under an open-source license.
- Updated dependencies [a16d921]
- Updated dependencies [1297cd2]
  - @pantheon-systems/css-client@0.11.1
  - @pantheon-systems/puck-css@0.11.1

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

- 77ba737: **[Fix]** Requests for static assets no longer reach the document API.

  ### What Changed
  - Paths ending in a known static-asset extension (`.js`, `.css`, `.png`, `.webp`, `.svg`, fonts, media, and friends) return `null` from `getPage` without a document lookup. Previously each of these 404s cost a content-API round trip and live Postgres work.
  - `normalizePath` now rejects those paths too, so a page can no longer be published at a path the renderer refuses to resolve.
  - `hasStaticAssetExtension` is exported from `@pantheon-systems/puck-css` and `/server`.

  ### Notes
  - Page slugs may legitimately contain dots, so the check matches an explicit extension list rather than treating any dot as an extension. `/v1.2-release-notes` still resolves.
  - `.html`, `.php`, `.aspx`, and `.pdf` are deliberately **not** short-circuited — sites migrating off a legacy CMS serve real pages at those paths.
  - Redirect lookups are unaffected: redirects are user-configured for arbitrary paths, including old asset URLs that a migrating site points at a new home, so the middleware still resolves them for asset-extension paths.

- Updated dependencies [a5880d4]
- Updated dependencies [863bff6]
- Updated dependencies [f55ce53]
- Updated dependencies [77ba737]
  - @pantheon-systems/puck-css@0.11.0
  - @pantheon-systems/css-client@0.11.0

## 0.10.0

### Minor Changes

- e8a472a: Adds the DataListBlock ("List") view-system component: a datasource-driven Puck block that renders a collection in three modes — Grid (cards), Table (rows), and List (listing). Modes come from a registry (`builtin-modes.ts`) mapping each mode key to its layout component, image positions, mode-specific fields, and defaults, so a new mode can be added without touching the block itself. `createDataListBlock()` is exported for apps to instantiate with their own wrapper class.

  When a datasource is selected but field mappings are empty, `autoMapFields()` heuristically assigns datasource fields to the title, subtitle, teaser, image, and icon roles by name pattern, so a freshly dropped block renders real content instead of blanks.

  Adds collection operators (sort, filter, group-by, start-at, max-items, and conditional status filtering for CMS template datasources), applied in the block's `resolveData`.

  Sidebar fields are grouped into collapsible "Content" and "Layout & style" sections via `DataListFieldsGrouper`, which also hides fields belonging to inactive view modes. Puck's built-in field types are replaced throughout with PDS field wrappers (datasource-select, schema-select, template-select, view-mode, image-position) for consistent styling.

  `css-client` gains the query fields and types the block needs to read collection content; `p1-next-sdk` middleware and query fetchers pass them through. The starter-kit template build script now carries the new block's files.

### Patch Changes

- 74dda98: Adds a README to every published package. Each one rendered a blank page on npmjs.com, because
  no `README.md` existed in the package directory to be included in the tarball — npm renders the
  README from the published tarball, not from the source repository, so a private repo was never
  the cause.

  Also repoints every `repository` URL at `pantheon-systems/p1-platform` with the correct
  `directory`. They still referenced the pre-merge repositories (`puck-css-integration`,
  `collaborative-state-system`, `p1-media-r2`), so the "Repository" link on each npm page went
  nowhere. Adds a matching `homepage` for each package.

  No runtime code changes.

- e8a472a: Fixes template datasources, which could not resolve end to end. Three separate faults sat on the same path: `getEditorContext` ran outside the request auth context, so lazy branch resolution never completed and both the template datasource list and the route list came back empty; `extractReferencedDatasourceIds` and `resolveSourcePath` both used `\w`, which excludes the hyphen, so the kebab-case query names behind every `templates.<name>` id failed to match a fetcher and were then read as subtraction by the expression evaluator.

  A failed CSS query lookup in the editor context now warns instead of being swallowed, so an empty datasource dropdown is diagnosable.

- Updated dependencies [d44e904]
- Updated dependencies [e8a472a]
- Updated dependencies [03c3ab3]
- Updated dependencies [89fd945]
- Updated dependencies [e8a472a]
- Updated dependencies [f9d18df]
- Updated dependencies [74dda98]
- Updated dependencies [db21361]
- Updated dependencies [e8a472a]
  - @pantheon-systems/css-client@0.10.0
  - @pantheon-systems/puck-css@0.10.0

## 0.9.0

### Minor Changes

- cbaa45c: **css-client:** Add Datasource and Query API endpoints. `DatasourcesEndpoint` provides `list`, `get`, and `delete` for content type datasources. `QueriesEndpoint` provides `list`, `get`, `delete`, and `getResults` with pagination support. New types exported: `Datasource`, `Query`, `QueryResults`, `QueryResultItem`, `QueryResultsMeta`, `QuerySortField`, and `QueryResultsParams`.

  **p1-next-sdk:** Integrate CSS query fetchers into server-side rendering. `createCssQueryFetchers` converts CSS queries into `RemoteDatasourceFetcher` instances for SSR data pre-fetching. Query fetchers are wired into the `datasource-context` and `editor-context` routes. Gracefully handles environments where the queries endpoint is unavailable.

  **puck-css:** Add `cssQueriesToDatasourceDefinitions` adapter to transform CSS query metadata into `RemoteDatasourceDefinition` entries for the editor datasource registry. Fix `mergeBlockForPreview` and `mergeRootForPreview` to preserve React element props (e.g. contentEditable spans) instead of overwriting them with resolved string values. Fix template overlay text visibility and caret rendering. Pass auth tokens to editor-context and datasource-context fetch calls when available.

### Patch Changes

- be8bf28: **puck-css:** The right-hand inspector supports **collapsible field sections** and
  **per-field help text**, both opt-in through Puck's per-field `metadata` so existing
  configs render unchanged.

  Help text is declared as `metadata: { help, helpWhenEmpty }` and renders beneath the input.
  `help` always shows; `helpWhenEmpty` shows only while the field has no value, which is how
  an inheriting field can say where its value is coming from — a field inherits exactly while
  it's empty. Fields declaring neither key are untouched.

  `PRODUCTION_BASE_URL` is now re-exported from `@pantheon-systems/puck-css/server`, so apps
  and SDKs can resolve the default backend without reaching into internals.

  **p1-next-sdk:** Broker login no longer fails when no backend URL is configured. An unset
  `p1BaseUrl` (neither `CSS_BASE_URL` nor `NEXT_PUBLIC_CSS_BASE_URL` set) now falls back to
  the production backend for both the login and redeem calls, matching what
  `createNextConfig` and `createNextContentClient` already did. Previously an unset value was
  passed straight through and the login round-trip failed.

- f815649: Fix the post-login redirect landing on `localhost:3000` instead of the site's real public URL. `postBrokerLogin` derived its redirect origin from the Route Handler's `request.url`, which reflects the Node server's own bind address once a reverse proxy is involved rather than the Host the browser actually requested. It now reads the `host` header instead, with `P1_SITE_URL`/`p1SiteUrl` still taking priority when set.

  `x-forwarded-host` is deliberately not consulted: on Pantheon it is not validated the way `Host` is (an arbitrary `Host` is rejected upstream; an arbitrary `X-Forwarded-Host` is not), so trusting it here would let a request redirect a login to an attacker-controlled origin. (PCC-3574)

  Also, from the same review: a malformed `P1_SITE_URL`/`p1SiteUrl` no longer throws and 500s the login route -- it falls back to the request's own origin and logs a warning instead.

- 78b00e2: Complete the SDK half of removing the per-environment `P1_SITE_URL` requirement (PCC-3531 phase 3). A multidev inherits its site's `P1_SITE_URL` at provisioning time, which points at the wrong environment with no error -- that cannot be fixed operationally, only by no longer depending on it.

  The browser has always known its own origin; it just never said so. `css-client`'s `login()` now states it -- `{ origin }` in proxy mode, `{ proposedRedirectUrl }` in direct mode, since direct mode has no server hop to compose the URL -- and `p1-next-sdk`'s `postBrokerLogin` forwards it upstream as `proposedRedirectUrl`, but only when neither `P1_SITE_URL`/`p1SiteUrl` nor an explicit `redirectUrl` is configured: a configured site's request is byte-identical to before this existed. Neither layer makes a trust decision -- CCR is the only party that authenticates the site, so it is the only place the proposal is checked against the site's registered origins (already live; this was the unused half).

  Also fixes a disclosure this same mechanism created: `/p1/auth/login` is a public, unauthenticated endpoint, and CCR's decline-warning was being returned straight through in the response body, letting a caller probe whether a given origin is registered for a site by watching the warning appear or vanish. The warning is now logged server-side with a `[P1AuthHandler]` prefix and stripped before the response reaches the browser.

- Updated dependencies [0077a4b]
- Updated dependencies [be8bf28]
- Updated dependencies [be8bf28]
- Updated dependencies [d04d399]
- Updated dependencies [cbaa45c]
- Updated dependencies [be8bf28]
- Updated dependencies [be8bf28]
- Updated dependencies [be8bf28]
- Updated dependencies [83567a7]
- Updated dependencies [be8bf28]
- Updated dependencies [78b00e2]
- Updated dependencies [7d51095]
- Updated dependencies [be8bf28]
  - @pantheon-systems/puck-css@0.9.0
  - @pantheon-systems/css-client@0.9.0

## 0.8.0

### Minor Changes

- 3ed945e: The P1 editor now renders from a persistent `Layout` instead of the catch-all `Page`, so navigating between documents no longer remounts the whole editor (providers, auth, and the Puck canvas iframe). `createP1Pages()` returns a `Layout` that renders the editor, `Page` is intentionally empty, and `EditorClient` is rendered with no props — it derives the edited page from the URL via the new `editorPagePathFromUrlPath` export.

  This is a breaking change for existing apps: the editor must be mounted from an `(editor)` route group. If you upgrade but keep only the old `app/p1/[[...p1]]/page.tsx`, the editor renders blank (TypeScript apps get a compile error from the changed `EditorClient` prop type; JavaScript apps get no signal, plus a one-time dev warning). New scaffolds from `create-p1-starter-kit` are unaffected.

  To migrate an existing app, run the codemod shipped with this release:

  ```bash
  npx @pantheon-systems/p1-next-sdk p1-migrate
  ```

  It restructures the routes for you (clean-tree gated, `--dry-run` supported, idempotent) and bails to the manual guide if your files diverged from the starter shape. See `docs/MIGRATION-EDITOR-LAYOUT.md` for the full guide and manual steps.

### Patch Changes

- `@pantheon-systems/css-client` and `@pantheon-systems/puck-css` are no longer declared as `peerDependencies`; they remain regular `dependencies`. The four suite packages are a lockstep group that always publishes at one version, so the peer edge duplicated a guarantee lockstep already provides — and caused every non-patch release to escalate the whole suite to a major bump. `peerDependencies` is now external-only (`react`, `react-dom`, `next`, `@puckeditor/core`). Consumers should continue to pin all suite packages at the same version.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @pantheon-systems/puck-css@0.8.0
  - @pantheon-systems/css-client@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [b0254ff]
- Updated dependencies
- Updated dependencies [e937842]
- Updated dependencies [e937842]
  - @pantheon-systems/puck-css@0.7.0
  - @pantheon-systems/css-client@0.7.0

## 0.6.0

### Patch Changes

- @pantheon-systems/css-client@0.6.0
- @pantheon-systems/puck-css@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [0bc7982]
  - @pantheon-systems/css-client@0.5.0
  - @pantheon-systems/puck-css@0.5.0

## 0.4.4

### Patch Changes

- Fix editing the root "/" homepage from the editor page switcher: selecting the homepage now opens the editor instead of navigating to the dashboard, and all pages route through a single `/p1/` separator via `editorPathHref` (also fixing non-root page links).
- Updated dependencies
  - @pantheon-systems/puck-css@0.4.4

## 0.4.3

### Patch Changes

- Bug fixes and improvements: deferred branch detection for read:published tokens, init promise retry, production backend URL handling, editor top menu UI improvements.
- Updated dependencies
  - @pantheon-systems/puck-css@0.4.3

## 0.4.2

### Patch Changes

- dc7cfd7: Fix packages being published with unresolved workspace:\* references by switching from npm publish to pnpm publish. Fix starter kit CLI to show "npm run dev" instead of "npm dev" for npm users.
- Updated dependencies [6650602]
- Updated dependencies [dc7cfd7]
  - @pantheon-systems/puck-css@0.4.2
