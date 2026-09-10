# @pantheon-systems/create-p1-starter-kit

## 0.15.0

### Patch Changes

- 0d89bb0: **[Feature]** The SEO layer moves out of the template: metadata resolution into `@pantheon-systems/p1-next-sdk/server`, the editor field definitions into `@pantheon-systems/puck-css/seo`.

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
  import { createSeoRootFields, DEFAULT_EDITOR_ROOT_TITLE } from '@pantheon-systems/puck-css/seo';

  const buildFields = (rootProps?: Record<string, unknown>) => ({
    title: { type: 'text' as const },
    description: { type: 'textarea' as const },
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

- 2790711: **[Fix]** A freshly scaffolded project now connects to the production CCR backend by default instead of failing to connect at all.

  ### What Changed
  - The scaffolded `middleware.ts` and the editor widget's logout handler no longer hardcode `http://localhost:8787` as their fallback when `NEXT_PUBLIC_CSS_BASE_URL` is unset. They now fall back to the SDK's production base URL, matching every other config path in the template.

## 0.14.0

### Patch Changes

- 45a272d: **[Feature]** `createPublishedPage()` is a new export from `@pantheon-systems/p1-next-sdk/server`. It builds the published-page render pipeline — read, status branch, route templates, datasource resolution, render — so route files don't have to assemble it by hand.

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
    titles: { home: 'My Site' },
  });

  // app/[...puckPath]/page.tsx
  export const revalidate = 300;
  export const generateStaticParams = published.generateStaticParams;
  export const generateMetadata = published.generateMetadata;
  export default published.Page;
  ```

  `revalidate` must stay a literal in the route file. Next.js statically analyzes segment-config exports, so a value re-exported through the factory goes undetected and the route silently loses its revalidation window — the same constraint that keeps `dynamic` in the route file for `createP1Pages`.

- 9e6f679: Fix unreadable sign-in and welcome screens on dark-themed sites. Both screens set a dark
  foreground but no background of their own, so on a site whose `body` is dark — including one
  that follows the visitor's OS dark mode — they rendered dark text on a dark background. They
  now establish their own background alongside the foreground, from a single shared surface
  definition the two screens have in common.
- 0fc5140: **[Fix]** The AI chatbot now appears for everyone it has been turned on for. Some accounts were enabled but never saw the chat panel in the editor.

  ### What Changed
  - The editor now identifies the signed-in user by their account email when checking whether the chatbot is available to them. Accounts that had been given access but saw no chat panel get it on their next editor load.
  - Nothing to configure: update the scaffold and redeploy.

- 3e32a74: **[Fix]** `loadPublishedPage()` now refuses internal document namespaces itself, so `/_registry/**` and `/_redirects/**` 404 on a published site even when the app's `page.tsx` carries no denylist of its own.

  ### What Changed
  - The check used to live in the scaffolded catch-all route (`app/[...puckPath]/page.tsx`), duplicated across `generateMetadata` and the page body. That file is forkable user land: a project that rewrote or tidied it exposed every registry and redirect document as a live public page. Like the other invariants in `published-page.ts` — awaited init, miss-versus-outage, aborted prerender — this one belongs in the SDK.
  - Internal paths report `{ status: "missing" }` without reaching the backend, so the renderer's existing `notFound()` handling covers them with no extra code.
  - Matching is case-insensitive and on segment boundaries: `/_Redirects/x` is refused (the server lower-cases document paths before lookup, so it resolves the same record), while a real page at `/_registry-guide` still renders.
  - Scaffolded projects no longer ship `isInternalPath`. Existing projects keep working either way — a leftover local copy is now redundant, not harmful.

  ### Migration / Action Required

  None. To reserve additional namespaces of your own, pass them to `loadPublishedPage`:

  ```ts
  const result = await loadPublishedPage(path, {
    internalPathPrefixes: ['/_private'],
  });
  ```

  The option adds to the built-in list rather than replacing it, so a short list cannot un-block `/_registry`.

- 104572b: **[Fix]** A scaffolded project's test suite now runs on its own. Its `vitest.config.ts` previously aliased three package specifiers to paths above the project directory, which resolve to nothing outside the repo the template is built from.

  ### What Changed
  - `vitest.config.ts` no longer contains those aliases. Tests resolve `@pantheon-systems/puck-css` and `@pantheon-systems/pds-toolkit-react` from `node_modules` like any other dependency, so they exercise the published packages rather than stand-ins.
  - Three list-block test files that depended on those aliases were withheld from the template and are now included. A fresh scaffold runs 29 test files instead of 26.

  ### Migration / Action Required

  Projects scaffolded before this release carry the old config. Replace the `resolve.alias` block in `vitest.config.ts`:

  ```ts
  // Before
  resolve: {
    alias: {
      "@pantheon-systems/puck-css/fields": resolve(__dirname, "../..", "packages/puck-css/src/data/fields.tsx"),
      "@pantheon-systems/pds-toolkit-react": resolve(__dirname, "../..", "packages/puck-css/src/__mocks__/@pantheon-systems/pds-toolkit-react.ts"),
      "@puckeditor/core": resolve(__dirname, "../..", "packages/puck-css/src/__mocks__/@puckeditor/core.ts"),
    },
  },

  // After
  test: {
    server: {
      deps: {
        inline: [/@pantheon-systems[/+]puck-css/, /@pantheon-systems[/+]pds-toolkit-react/],
      },
    },
  },
  ```

  `inline` is required: `pds-toolkit-react` imports its own stylesheet, and Node's ESM loader cannot load `.css`. Drop the now-unused `import { resolve } from "path"`.

## 0.13.0

### Minor Changes

- 8b746d8: Add non-interactive scaffolding: `--yes`/`-y` accepts defaults for every prompt, and
  `--pm <pnpm|npm|yarn>`, `--git`/`--no-git`, `--install`/`--no-install` answer individual
  prompts directly. CI uses this to scaffold and validate a generated project on every PR.

### Patch Changes

- 61cb80e: **[Fix]** Public package builds no longer ship internal Jira ticket references, expanded internal service names, or backend implementation details (storage engine, compute primitive, real hostnames) in comments, JSDoc, `package.json` descriptions, or READMEs.

  ### What Changed
  - `css-client`, `p1-next-sdk`, `puck-css`, `p1-ai-chat`, and `p1-content-validator` now build in two `tsc` passes — one declarations-only, one comment-stripped `.js` — so implementation comments no longer survive into the published `.js`. JSDoc on exported symbols (which intentionally survives, for consumers' IDE tooltips) was hand-edited to drop internal ticket refs and backend rationale.
  - `p1-media`'s esbuild sourcemaps no longer inline `sourcesContent`; they previously shipped the entire original TypeScript source, comments included, regardless of any `.js`/`.d.ts` cleanup.
  - `puck-css`'s `files` allowlist no longer includes the bare `src/pds/theme` directory, which was shipping a raw test file and a 200KB generated `.ts` source file alongside the intended theme CSS (already covered by the existing `src/**/*.css` entry).
  - `create-p1-starter-kit`'s scaffolded template (copied from `apps/p1-starter`) had the same class of ticket-ref comments cleaned, including its example CI workflow.
  - Package `description` fields and `README.md` files (which npm always publishes regardless of the `files` field) no longer name the internal "CCR"/"Collaborative Content Repository" service.
  - `puck-css`'s `[ccr-store]` log tag and an internal Puck remount key are renamed (`[p1-store]` / `p1-<role>`); neither is persisted or part of any public contract.
  - A new CI guardrail (`.github/scripts/check-npm-leaks.sh`, wired into PR CI's hard gates and into `publish.yml`) packs each public package the way `npm publish` would and fails the build if any of these terms reappear. It fails closed — an unreadable tarball or a glob-free `files` entry whose build output is missing is an error, never a pass — and carries a `--self-test` mode, run first in both workflows, that verifies detection against fixtures.

  No public API or runtime behavior change.

  ### Deliberately out of scope
  - The bare `CCR` service name is deliberately still present in published output — most visibly `puck-css`'s exported `PRODUCTION_BASE_URL` (`https://ccr.p1.pantheon.io`, also referenced in `apps/p1-starter/.env.example`), the live default hostname every unconfigured consumer's SDK talks to, and ~200 local `ccr` variable bindings from `useP1Puck()`. Naming a service is not the leak this fix is about: the guardrail bans the architecture behind it — the expanded "Collaborative Content Repository"/"Collaborative State System" forms, storage engine, CRDT, compute primitive, ticket refs, and `.workers.dev` hostnames. Renaming those bindings is optional cleanup, not a release blocker.

- 75833a7: Point the post-scaffold "next steps" output and the README setup table at the credentials the generated app actually requires (`NEXT_PUBLIC_CSS_SITE_ID`, `CSS_API_KEY`) instead of the optional Content Publisher pair.
- 859287e: Fix four defects in the generated template:

  - The scaffolded `eslint.config.js` now includes the shared `tests` preset, so test files get
    the test-file rule relaxations instead of being linted as source. The preset list is read from
    the starter app's own config, and the build fails loudly if a preset cannot be inlined.
  - Scaffolded projects ship a working `.gitignore`. npm strips files named `.gitignore` from
    published tarballs, so the template now carries it undotted and the CLI restores the name
    before the initial commit — previously the first commit could include `node_modules` and `.env`.
  - Scaffolds ship a README written for them, and no longer ship the monorepo's `CHANGELOG.md`.
  - Scaffolds no longer ship `tsconfig.tsbuildinfo` or `next-env.d.ts`. Both are generated
    build artifacts, gitignored in the source app; the tsbuildinfo was a 466KB incremental
    cache keyed to paths inside the monorepo that produced it.

## 0.12.0

### Patch Changes

- 59d8607: Fix the Tailwind `@source` path in the starter template so scaffolded projects pick up puck-css component styles. The path was monorepo-relative and did not exist in a scaffold, so every Tailwind utility used inside puck-css (data-list built-in components, editor chrome) rendered unstyled. It now points at `node_modules/@pantheon-systems/puck-css/dist`, which resolves in both the monorepo and a scaffolded project.
- 9bbb083: Stamp `p1.templateVersion` into a scaffolded project's `package.json`, recording the version of `create-p1-starter-kit` that generated it. Previously a scaffold carried no record of its origin, so the only way to infer its generation was reading the pinned dependency versions. The field is the anchor future migration tooling needs to know a project's starting point.

## 0.11.1

### Patch Changes

- a16d921: Set `license` to `UNLICENSED` to match the rest of the suite. These packages had drifted
  to `MIT` (or had no `license` field at all), but they are closed-source and were never
  intended to be published under an open-source license.

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
