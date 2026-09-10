# @pantheon-systems/puck-css

## 0.15.0

### Minor Changes

- 34b32da: **[Added]** A feature plugin can ask the editor to open a document or start a new page.

  ### What Changed
  - `deps.openDocument(path)` moves the editor to another document. Where the host handles document selection the URL and the page selector move with the canvas; where it does not, the document loads in place.
  - `deps.openCreatePage({ locale, sourceDocumentId })` opens the create-page modal, aimed at a locale and at the page a new version starts from.
  - Both are safe to call and safe to hold in a dependency array for the editor's lifetime. Until the editor fills them they do nothing, so a plugin needs no check of its own.

- 791e6a0: **[Added]** The editor toolbar names the market a page belongs to and lists the site's others.

  ### What Changed
  - The localization feature contributes a control to the document toolbar showing the open page's market, with every market the site publishes in beneath it.
  - A market holding a version of the page opens it; a market holding none offers to create one.
  - The list reads the same wherever in a page's locale set the editor is standing, because a version resolves up to its canonical before the list is built.
  - Markets are named in their own language and in English, so a tag is never the only label a reader gets. A page carrying no locale reads `Unset`.
  - A locale a document carries but the site no longer configures is still listed, after the configured markets, so a version that exists stays reachable.
  - The control stays away until a page is open, rather than naming a market it has no page to measure against.
  - Where the site's locales cannot be read, the control says so and offers another go. A site that publishes in nothing and a request that failed no longer look alike.
  - Where two pages carry the same locale, both are listed and each names its own page, so neither is left unreachable and the rows can be told apart.

- 4eca2a7: **[Feature]** Create a page in one of a site's markets, or bring an existing page into a market.

  ### What Changed
  - The create-page modal takes a market for a new page. The field is bounded to the site's locale registry and searchable by native name, English name and tag, so `Deutsch`, `German` and `de` all reach the same market. Carrying no market is the field's empty state rather than a row in the list, and clearing the field returns to it.
  - A fifth starting point brings an existing page into a market as a version of it, seeded from a copy of the page's current content. The editor lands on the new version once it exists.
  - A control elsewhere in the editor can open this flow already aimed at a market and at the page a version starts from, so a market settled before the modal opened is carried into it.
  - Where the site's locales cannot be read, the translate flow says so and offers another go rather than reporting that the site has no markets configured.

  ### Host-side change to be aware of

  `onDocumentCreate` takes a fourth argument: `(path, template?, title?, locale?)`. `locale` is the market a new page is created in.

  A host that implements the callback with three parameters keeps compiling and keeps working, but **drops the market silently** — pages created through the modal's locale field come out untagged, with no error raised anywhere. If your host forwards these arguments on, widen it to pass the fourth through:

  ```ts
  onDocumentCreate={(path, template, title, locale) =>
    createDocument(path, template, title, locale)
  }
  ```

- 34b32da: **[Added]** A feature plugin can place a control in the editor's document toolbar.

  ### What Changed
  - `P1FeaturePlugin.toolbarActions` returns a control to render in the toolbar above the canvas. Returning nothing contributes nothing, so a feature can stay out of the toolbar while its other slots run.
  - Controls are placed in plugin priority order, so a site composing several features gets the same toolbar every time.

- aa9979e: **[Fix]** Publishing now invalidates the public route it changed, so a page reaches the site immediately instead of waiting out the app's revalidate window.

  ### What Changed
  - The editor publishes to the backend directly, so nothing in the request path told the Next.js app that one of its cached renders had gone out of date. The public page segment is statically renderable, so the app kept serving what it had — for up to `revalidate` seconds, and with a `stale-while-revalidate` window that lets a CDN in front of it serve the same stale render for far longer.
  - The case that made this visible: a path requested before its page existed has a `notFound()` render cached against it. Creating and publishing that page left the cached 404 in place, so a page that had published correctly, and was listed in the site structure, was not reachable on the site.
  - `createP1Handler` gains a `revalidate` POST action (`POST /p1/api/revalidate` with `{ path }`), auth-wrapped like `publish`. It only invalidates — the content is already in the backend, and re-persisting it here would give one page two write paths.
  - `useP1Editor` calls it after a successful publish, awaited before `onPublishSuccess` fires: until it returns, the public route can still be serving pre-publish content. A failed invalidation is reported as a stale route, never as a failed publish — the publish has already committed by then.
  - Route-template fan-out (overrides plus the public catch-all segment, for instance URLs that resolve by template fall-through) is shared with the `publish` action rather than duplicated, so the two cannot drift.

  ### Migration / Action Required

  None for apps whose P1 handler is mounted at `/p1/api` from `createP1Handler` — the new action is served automatically and the editor calls it on its own.

  An app that renders public pages from a segment other than `[...puckPath]` should already be passing `publicPageSegment` to `createP1Handler`; the new action honors the same option.

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

### Patch Changes

- c9e7068: **[Fix]** A new project's first `npm test` no longer prints a wall of "Sourcemap for ... points to missing source files" warnings.

  ### What Changed
  - The published packages no longer ship sourcemaps. The maps referenced TypeScript sources that are not part of the published package, so bundlers warned about every one of them. Tests and builds were unaffected — the warnings were only noise.
  - Nothing to configure: update your dependencies and the warnings are gone.

- 2f64e8a: **[Fix]** The publish and delete confirmation toasts no longer render with a transparent background.

  ### What Changed
  - Recent design-system builds paint the toast card from a `--pds-color-toast-*` custom-property family (background, foreground, action, and one icon colour per status) that the design-system core stylesheet this package pins does not define. An undefined `background-color` computes to `transparent`, so the "Publish directly to live site?" confirmation showed the editor toolbar straight through it — its Confirm/Cancel buttons overlapping the branch selector and Publish button — and the warning icon fell back to inherited grey instead of amber.
  - Those properties are now bridged to the tokens the pinned core stylesheet does define, so the toasts render opaquely against either naming.

  ### Migration / Action Required

  None.

- ac9d7b5: **[Fix]** The editor's block drawer now renders correctly in projects that don't use Tailwind CSS.

  ### What Changed
  - The block-drawer rows were styled with Tailwind utility classes while this package declares no Tailwind dependency. They only rendered because the scaffold's stylesheet extended Tailwind's scan into this package, so a project that removed Tailwind lost layout inside the editor itself — icons and labels stacked instead of sitting on one row.
  - Every component here now ships its own styles, so nothing in this package depends on the consumer's Tailwind build.

  ### Migration / Action Required

  None. Projects scaffolded from the starter kit can now remove the
  `@source "../node_modules/@pantheon-systems/puck-css/dist";` line from
  `app/styles.css`; new scaffolds no longer include it.

- 64ac89e: Fix an editor crash when the installed `pds-toolkit-react` is missing an icon the outline panel asks for.

  `Icon` dereferences its glyph entry without a guard, so an icon name the installed version does not ship throws during render rather than rendering nothing. The outline panel passed a keyword-derived name straight through, so a block whose icon had been renamed or removed unmounted the whole editor — and it repeated on every load of any document containing that block, leaving the page unopenable.

  Icon names now resolve against the set `pds-toolkit-react` reports it ships, preferring a shipped alternative (`link` → `linkSimple`) and rendering no icon when it ships none. `SafeIcon` additionally contains any such throw so a missing glyph can never cost more than itself.

- 2790711: **[Fix]** `performLogout` no longer requires a `cssBaseUrl` — an omitted value now defaults to the production CCR backend, matching every other config path.

  ### What Changed
  - `PerformLogoutConfig.cssBaseUrl` is now optional. When omitted, logout resolves against the production backend instead of requiring the caller to supply a value.

- 998cd5b: **[Fix]** Select field values in the editor field panel are no longer clipped.

  ### What Changed
  - The value text in a closed `select` field — such as `og:type` in the page metadata panel — had the top of its glyphs cut off. PDS styles the bare `select` element with a fixed control height while Puck's field CSS adds its own vertical padding and sets no height; because the PDS rule is layered, the two combined instead of one winning, leaving a content box too short for the line of text. Selects now size from their padding like the text fields beside them, so the value renders fully and every select field matches the height of its neighbours.

- Updated dependencies [2790711]
- Updated dependencies [c9e7068]
- Updated dependencies [d0206d2]
- Updated dependencies [d0206d2]
  - @pantheon-systems/css-client@0.15.0

## 0.14.0

### Minor Changes

- 3e80471: **[Feature]** `brokerLogout()` is a new public export from `@pantheon-systems/css-client`. It asks the backend for the Auth0 logout URL and hands it back, reporting one of three outcomes — it does not navigate.

  **[Fix]** Broker logout now ends the Auth0 session. Previously it only cleared the local token, so the next login signed the same user straight back in without a prompt.

  ### What Changed
  - A failed logout no longer destroys the token, so it can be retried. The signed-in user's details are kept alongside it, rather than leaving a session that reports as authenticated with nobody attached.
  - `createBrokerAuth().logout()` performs the redirect for you and returns the same three outcomes. If you call it, you need do nothing.
  - `performLogout()` from `@pantheon-systems/puck-css` clears local state and returns the outcome, but does **not** redirect — on `signed_out` the caller must navigate to `outcome.logoutUrl`, or the Auth0 session stays alive.
  - `useP1Auth().logout()` does perform that navigation for you, and now returns the outcome instead of `void`; ignoring the return value still compiles.
  - Apps mounting `createP1AuthHandler` gain a `logout` route alongside `login` and `redeem`, so logout stays same-origin instead of calling the backend directly.
  - A logout URL that is not `https:` is now rejected as an error rather than navigated to.
  - `OAuthSession.logout()` returns the outcome instead of `void`. Calling it and ignoring the result is unchanged; writing your own `OAuthSession` implementation now means returning the outcome from `logout()`.

  ### Migration / Action Required

  Only if you call `brokerLogout()` directly. It returns instead of navigating, so the redirect is yours to perform — and on `signed_out` that navigation is what actually ends the Auth0 session:

  ```ts
  const outcome = await brokerLogout({ cssBaseUrl });

  switch (outcome.status) {
    case 'signed_out':
      // Required. Without this the Auth0 session survives and the next
      // login signs the same user back in with no prompt.
      window.location.href = outcome.logoutUrl;
      break;

    case 'no_session':
      break; // Nothing to sign out of.

    case 'error':
      // The token is kept deliberately. Show the message and let the user
      // retry — clearing local state here renders them signed out while
      // they still hold a live credential.
      showError(outcome.message);
      break;
  }
  ```

- 3bbdef5: The DataList block's builtin display components (Grid/Cards, List/Listing, Table/Rows) and the block shell around them no longer render with Tailwind utility classes. They now use semantic `p1-datalist-*` class names from a stylesheet the components import themselves, so correct rendering no longer depends on a consumer's Tailwind build scanning this package's `dist`.

  Every colour, space, radius, border width, font size, and font weight is driven by a `--p1-datalist-*` custom property that resolves to the matching PDS design token, falling back to a literal for hosts that don't load PDS. Hosts can retheme the block by overriding those properties. The components deliberately set no `font-family`, so type inherits from the host page. Layouts are visually unchanged.

- b2a17ba: **[Feature]** Translated pages can now diverge from the page they came from, field by field.

  ### What Changed
  - Editing a translation, every text field carries a control to break its link to the source page. A broken field keeps whatever the translator types; an unbroken one follows the source. Breaking is reversible: resetting a field puts it back under the source's control and discards the local wording.
  - Editing a canonical page, every text field carries a control to mark it non-translatable. That holds the field identical across every language version of the page, for things like product names and codes that should not be reworded.
  - A field's setting comes from the most specific answer available: an explicit choice on the field, otherwise what the page's template declares for that slot, otherwise the site's default. A field nobody has spoken for follows the source page.
  - The controls reach single-line and multi-line text fields, which is where translatable wording lives; other field types are unaffected for now. They sit on a page's own fields and on the top-level fields of each component. A field nested inside a group or a repeated item follows the field it belongs to, which is where the setting is held.

  The field controls stay out of the way where they do not apply, so fields on a page with nothing to diverge from look as they did before.

- b8bb111: **[Feature]** The editor now tells you when a page does not exist and offers to create it, instead of failing silently.

  ### What Changed
  - Opening the editor at a path with no page renders a "This page doesn't exist" panel in the canvas — the header, page navigator and side panels stay in place around it. It offers **Create page** to users whose role permits it, and **Open home page** to everyone. It replaces the generic "Choose a page from the menu above" empty state for this case only.
  - The flow is self-contained: `useP1Editor` creates the page and re-opens it. No wiring is required beyond what an editor already passes.
  - `useP1Editor` returns `notFound: true` when the path lookup finds no page on the current branch. Previously that case surfaced as a load error. It is reported separately because nothing has failed — the page simply is not there yet. Only the path lookup counts: a 404 from a later call in the same load (a missing version, say) stays an error, so the panel never offers to create a page that already exists. `retry()` is also returned, for consumers rendering their own panel.
  - `onDocumentNotFound` is unchanged and still takes priority: a callback returning `true` retries the load, and `notFound` stays `false`.

  ### Migration / Action Required

  None. Drop any `onDocumentNotFound` auto-create callback to adopt the new flow.

### Patch Changes

- 43f251c: **[Fix]** The editor no longer loses its data-source registry and route list on every page it opens. A document identifies its page by slug, so reading the open document's path gave the editor `blog` where its own APIs require the page path `/blog` — `/p1/api/editor-context` and `/p1/api/datasources` answered `400 invalid_path` for every page except the site root.

  ### What Changed
  - `useLiveEditorContext` (and `useLiveRemoteDatasources`, which reads through it) now roots the path it queries with, so `{{ source.field }}` resolution in the canvas, the data-source explorer, and the field-connect sidebar see live data again.
  - The `path` these hooks return is rooted for the same reason — saving or removing a page-scoped data source posts it back to the API, and those requests were failing too.
  - Sites whose document paths already carry a leading slash are unaffected.

- Updated dependencies [3e80471]
- Updated dependencies [b2a17ba]
  - @pantheon-systems/css-client@0.14.0

## 0.13.0

### Minor Changes

- d194eb4: **[Feature]** `brokerLogout()` is a new public export from `@pantheon-systems/css-client`. It asks the backend for the Auth0 logout URL and hands it back, reporting one of three outcomes — it does not navigate.

  **[Fix]** Broker logout now ends the Auth0 session. Previously it only cleared the local token, so the next login signed the same user straight back in without a prompt.

  ### What Changed
  - A failed logout no longer destroys the token, so it can be retried. The signed-in user's details are kept alongside it, rather than leaving a session that reports as authenticated with nobody attached.
  - `createBrokerAuth().logout()` performs the redirect for you and returns the same three outcomes. If you call it, you need do nothing.
  - `performLogout()` from `@pantheon-systems/puck-css` clears local state and returns the outcome, but does **not** redirect — on `signed_out` the caller must navigate to `outcome.logoutUrl`, or the Auth0 session stays alive.
  - `useP1Auth().logout()` does perform that navigation for you, and now returns the outcome instead of `void`; ignoring the return value still compiles.
  - Apps mounting `createP1AuthHandler` gain a `logout` route alongside `login` and `redeem`, so logout stays same-origin instead of calling the backend directly.
  - A logout URL that is not `https:` is now rejected as an error rather than navigated to.
  - `OAuthSession.logout()` returns the outcome instead of `void`. Calling it and ignoring the result is unchanged; writing your own `OAuthSession` implementation now means returning the outcome from `logout()`.

  ### Migration / Action Required

  Only if you call `brokerLogout()` directly. It returns instead of navigating, so the redirect is yours to perform — and on `signed_out` that navigation is what actually ends the Auth0 session:

  ```ts
  const outcome = await brokerLogout({ cssBaseUrl });

  switch (outcome.status) {
    case 'signed_out':
      // Required. Without this the Auth0 session survives and the next
      // login signs the same user back in with no prompt.
      window.location.href = outcome.logoutUrl;
      break;

    case 'no_session':
      break; // Nothing to sign out of.

    case 'error':
      // The token is kept deliberately. Show the message and let the user
      // retry — clearing local state here renders them signed out while
      // they still hold a live credential.
      showError(outcome.message);
      break;
  }
  ```

- 356af36: Move the editor's mid-switch waiting state out of the starter app and into the SDK.

  `useP1Editor` now keeps the last props that rendered, so a reload no longer blanks the canvas while the next document arrives, and it reports **why** it is reloading. New `<EditorReloadOverlay>` (backed by `LoadingOverlay` in `puck-css/pds`) renders the wait with the right copy: a workstream switch and a page switch were both announced as "Switching workstream" before, even though only one of them was.

  `useP1Editor` return shape:

  - `loading` now means _nothing to render yet_ — the first document has neither loaded nor failed. It no longer turns on for reloads that happen behind existing content. Callers using `loading` as "a switch is in flight" should read `reloading` instead.
  - `reloading: 'branch' | 'document' | null` — new.
  - `hasContent: boolean` — new; whether a document has ever loaded, i.e. whether `puckProps` are worth rendering.
  - `puckKey` / `puckProps` are retained across a reload rather than following the emptied context.

  The `p1-migrate` codemod adopts the SDK overlay as part of the migration, so a migrated app lands on the same editor page as a freshly scaffolded one. It leaves an app that customized that region alone.

  The reload reason is derived by comparing the branch the loaded document came from against the current branch, rather than latched when the branch changes. A workstream switch commits the branch and the navigation that goes with it in separate renders, so the load effect runs more than once per switch — a one-shot flag was consumed by the first run and every run after it reported a plain page switch.

- 053ca52: Stop sending the full local Yjs history on every WebSocket connect. On first connect
  the client sends no state vector; the server responds with its full current state and
  a baseline verdict. On reconnects the client sends only the delta the server is
  missing. When the server reports the client's lineage has diverged (code 4002), the
  client fetches fresh content from REST and reconnects with a new Y.Doc — bypassing the
  union-merge admission path that could otherwise resurrect pre-merge content.

### Patch Changes

- 8916328: **[Fix]** The editor no longer floods the browser console with Puck's "You're using the `usePuck` method without a selector" warning.

  ### What Changed
  - Four editor components — the ActionBar pin button, the inspector fields override, the left-rail panel header, and the template fields override — called Puck's `usePuck()` without a selector. Puck logs that warning once per mount, and these components mount on every block hover, selection change, and panel toggle, so the warning repeated constantly during normal editing.
  - Each now reads only the store value it needs (`dispatch`, and `config` in the inspector) through `createUsePuck()`. As a side effect they no longer re-render on unrelated Puck state changes.

  No API or behavior change; nothing to do on upgrade.

- eb0d356: Merge job runner support (PCC-3737): `merge.executeRequest` responses may now carry the async job shape (`jobId`, `status`, counters, `statusUrl`) when a merge outlives the server's bounded wait; new `merge.getJob` and `merge.waitForJob` poll it to a terminal state. The editor's merge-resolution flow polls long-running merges to completion instead of misreading the accepted response as success.
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

- f273c53: CI registry sync no longer rewrites unchanged components. The backend now
  compares each posted registry descriptor against what the branch already
  stores and writes a version only when it differs, so a sync run over an
  unchanged component set adds no document history. The `write:registry` token
  still has no read access — the comparison happens server-side.

  The example GitHub Actions workflow in the starter kit's `ci-examples/` now
  ships with a concurrency group, so repeated pushes to a branch no longer race
  parallel sync runs into the same registry documents. Sites already running a
  copy of that workflow should add the same `concurrency` block.

- Updated dependencies [d194eb4]
- Updated dependencies [495856b]
- Updated dependencies [eb0d356]
- Updated dependencies [eb0d356]
- Updated dependencies [61cb80e]
- Updated dependencies [053ca52]
- Updated dependencies [61cb80e]
  - @pantheon-systems/css-client@0.13.0

## 0.12.0

### Minor Changes

- 5c8b489: Add `author` as a `ContentRole`, with permissions identical to `editor`. Part of the custom user roles MVP.

### Patch Changes

- 93f4976: **[Fix]** Page route resolution no longer drops to an empty page list — or hammers the backend with retries — when the document-list API has an outage.

  ### What Changed
  - When refreshing its route key cache fails, the page store now keeps serving the last successful result instead of returning an empty list, so collection-template routes keep resolving during a backend brownout.
  - After a failed refresh, no new document-list queries are issued for a 30-second cooldown, preventing render traffic from amplifying backend slowness into a sustained overload.
  - Happy-path behavior is unchanged (same 30-second cache TTL and values).

- b99acfb: Report editor boot failures instead of hanging on "Loading document". `useP1Editor` never starts a document load until a branch resolves, and `P1PuckProvider` dropped both ways that can fail: a refused `GET /api/sites/{siteId}/branches`, and a list that resolves without a usable branch (which is what the API returns for a site id that doesn't exist). The provider now exposes `branchResolutionError`, naming the request and its HTTP status, and the editor reports it as a fatal load error. A refused document list is also no longer reported as "No documents found on this branch" — the provider exposes `documentsError` and the real failure is shown instead.
- 716771a: Stop the editor from requesting a templates URL with an empty branch segment.

  `useTemplateList` no longer fetches until a branch is resolved, matching `useDocuments`,
  so the editor waits for `P1PuckProvider` to resolve the site's main branch rather than
  calling through with an empty branch id. css-client rejects a blank or missing path
  parameter with a `MissingParameterError` naming it — a `P1ApiError` carrying status 400,
  so existing bad-request handling and retry predicates treat it correctly — instead of
  emitting a URL the API misparses (`/branches//templates`, which something upstream
  collapses into `/branches/templates`, reported back as `Branch not found: "templates"`).

  The single-resource getters (`branches.get`, `sites.get`, `queries.get`,
  `checkpoints.get`, `merge.getRequest`, `agentRegistry.get`) carry the same check, because
  a blank _trailing_ parameter leaves one slash the API strips — so `branches.get(siteId,
'')` used to return the branch _list_ typed as a single `Branch`, with no error anywhere.

  A blank or whitespace `CSS_BRANCH_ID` / `NEXT_PUBLIC_CSS_BRANCH_ID` now reads as unset on
  every path that consumes it, including the content client, where it previously reached
  `?branch=` and 404'd every published page.

- c9e31fb: **[Fix]** The Puck canvas no longer remounts when editor-context data resolves, so selection, scroll position, and in-progress field edits survive initial load and branch switches.

  ### What Changed
  - `useP1Plugins` now returns its plugin array synchronously instead of returning `[]` until the editor-context fetch resolved. The array's identity was changing mid-load, and Puck treats its plugin list as identity-sensitive config, so every load remounted the whole canvas.
  - The field-connect ("Bind") modal now reads live routes and remote datasources itself rather than the values captured when the plugin was created, so its route/datasource list stays current after a branch switch instead of showing whatever was available at plugin-creation time.
  - **[Deprecation]** `createFieldConnectPlugin`'s `routes` and `remoteDatasourceRegistry` options are deprecated. They are now only a fallback used until live data loads.

  ### Migration / Action Required

  Nothing is required — the deprecated options still work.

  If you render the published `EditorClient` outside a `P1PuckProvider`, its Bind modal now fetches `/p1/api/editor-context` itself and prefers that result over the `routes`/`remoteDatasourceRegistry` you pass in. Make sure your host app serves that route; if it doesn't, the modal still falls back to your props, but each mount will retry the request first.

  Drop the two options once you are on this version:

  ```diff
    createFieldConnectPlugin({
      config,
      editorPath,
  -   routes,
  -   remoteDatasourceRegistry,
    })
  ```

- Updated dependencies [b99acfb]
- Updated dependencies [716771a]
  - @pantheon-systems/css-client@0.12.0

## 0.11.1

### Patch Changes

- a16d921: Set `license` to `UNLICENSED` to match the rest of the suite. These packages had drifted
  to `MIT` (or had no `license` field at all), but they are closed-source and were never
  intended to be published under an open-source license.
- 1297cd2: **[Fix]** Template references to hyphenated datasource ids (e.g. `{{ blog-post.title }}`) now resolve; previously they were never fetched and rendered as an empty string.

  ### What Changed
  - P1 auto-generates content-type datasource ids in kebab-case (`blog-post`, `customer-story`). Template resolution only accepted `A–Z`, `a–z`, `0–9`, and `_` in datasource ids, so hyphenated ids were silently skipped during datasource loading and evaluated to `""` at render time. Both plain (`{{ blog-post.title }}`) and namespaced (`{{ templates.blog-post.title }}`) references now resolve, including `.markdownLinks` expansion.

- Updated dependencies [a16d921]
  - @pantheon-systems/css-client@0.11.1

## 0.11.0

### Minor Changes

- 77ba737: **[Fix]** Requests for static assets no longer reach the document API.

  ### What Changed
  - Paths ending in a known static-asset extension (`.js`, `.css`, `.png`, `.webp`, `.svg`, fonts, media, and friends) return `null` from `getPage` without a document lookup. Previously each of these 404s cost a content-API round trip and live Postgres work.
  - `normalizePath` now rejects those paths too, so a page can no longer be published at a path the renderer refuses to resolve.
  - `hasStaticAssetExtension` is exported from `@pantheon-systems/puck-css` and `/server`.

  ### Notes
  - Page slugs may legitimately contain dots, so the check matches an explicit extension list rather than treating any dot as an extension. `/v1.2-release-notes` still resolves.
  - `.html`, `.php`, `.aspx`, and `.pdf` are deliberately **not** short-circuited — sites migrating off a legacy CMS serve real pages at those paths.
  - Redirect lookups are unaffected: redirects are user-configured for arbitrary paths, including old asset URLs that a migrating site points at a new home, so the middleware still resolves them for asset-extension paths.

### Patch Changes

- a5880d4: **[Fix]** Opening another page in the editor no longer leaves a block selected from the page you left.

  ### What Changed

  Selection is held by position, so a selection that survived a page change became whichever block sits at that position on the new page. The inspector showed that block's fields and the outline highlighted it, and an edit made there landed on a page you were not looking at. The editor now clears the selection when it loads a different document.

- 863bff6: **[Fix]** Block images now lazy-load by default, so image-heavy pages stop fetching every image regardless of viewport.

  ### What Changed
  - `MediaImage` and `MediaFigure` render `loading="lazy"` + `decoding="async"` unless the caller passes `loading`, so custom blocks built on them inherit the behavior.
  - `createMediaFigureBlock` gained a "Loading" field (Lazy/Eager) whose default comes from the new `defaultLoading` option.
  - The data-list block's Cards/Rows/Listing layouts lazy-load item images, with a new "Image loading" field to opt an instance into eager.
  - The starter's primitive Image block gained the same Lazy/Eager field.

  ### Migration / Action Required

  Lazy loading applies retroactively: existing documents pick it up without being re-saved, so a published page whose LCP element is a hero or first-row listing image will load that image lazily after upgrading, and its LCP may regress until an editor opts back in. Set the block's loading field to "Eager" on above-the-fold images to restore the previous behavior.

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
  - @pantheon-systems/css-client@0.11.0

## 0.10.0

### Minor Changes

- e8a472a: Adds the DataListBlock ("List") view-system component: a datasource-driven Puck block that renders a collection in three modes — Grid (cards), Table (rows), and List (listing). Modes come from a registry (`builtin-modes.ts`) mapping each mode key to its layout component, image positions, mode-specific fields, and defaults, so a new mode can be added without touching the block itself. `createDataListBlock()` is exported for apps to instantiate with their own wrapper class.

  When a datasource is selected but field mappings are empty, `autoMapFields()` heuristically assigns datasource fields to the title, subtitle, teaser, image, and icon roles by name pattern, so a freshly dropped block renders real content instead of blanks.

  Adds collection operators (sort, filter, group-by, start-at, max-items, and conditional status filtering for CMS template datasources), applied in the block's `resolveData`.

  Sidebar fields are grouped into collapsible "Content" and "Layout & style" sections via `DataListFieldsGrouper`, which also hides fields belonging to inactive view modes. Puck's built-in field types are replaced throughout with PDS field wrappers (datasource-select, schema-select, template-select, view-mode, image-position) for consistent styling.

  `css-client` gains the query fields and types the block needs to read collection content; `p1-next-sdk` middleware and query fetchers pass them through. The starter-kit template build script now carries the new block's files.

- e8a472a: Adds a template badge to the bottom of the inspector's Page tab, showing which template the current page is bound to. The label is read from the current template's `_template.label`, falling back to matching the document's `templateId` against the loaded template list. The badge is hidden when a block is selected or when the page has no bound template.
- f9d18df: Fixes the datasource explorer panel being stuck on its loading skeleton, and the canvas never resolving `{{ source.field }}` tokens, on any editor built with `useP1Editor`.

  Puck receives its plugin array once per mount. `useP1Editor` keeps that array identity-stable on purpose — new plugin objects mean new override component identities, which remounts the canvas and every field, losing focus mid-keystroke — so it rebuilds only when the plugin _count_ changes. That made every value a plugin factory closed over permanently frozen. The count changes exactly once, when the editor context arrives and `useP1Plugins` goes from zero plugins to three; the datasource registry only exists at that moment, so the context fetch it triggers is still in flight. The explorer plugin captured `snapshot: {}` and `loadingIds: Set(["…"])`, the preview-resolve plugin captured the same empty context, and the settled data that arrived milliseconds later was rebuilt into fresh plugin objects that Puck never saw. A warm react-query cache hid the bug, since the data was already present at freeze time.

  Plugin-rendered components now read datasource state through the new `useLiveRemoteDatasources` hook instead of receiving it by value. `P1QueryProvider` already wraps the whole editor, so this subscribes them to the same react-query entries the editor host reads: data, loading state, registry, and preview params all stay live without anything crossing the plugin boundary, and the array stays identity-stable. This also fixes the panel pointing at a stale document path after navigating between pages, since the path now comes from `P1PuckContext` rather than the captured `editorPath`.

  **Breaking:** the data arguments those factories took are removed rather than deprecated, since passing them by value could never have worked. `createRemoteDatasourceExplorerPlugin` and `createPreviewResolvePlugin` now take a single options object — drop the leading context argument, and drop the `routeTemplateKeys`, `savedPreviewParams`, `remoteDatasourceRegistry`, `loadingIds`, and `loading` options; all of that is read live. `Client`'s `remoteDatasourceContext`, `routeTemplateKeys`, and `savedPreviewParams` props are removed for the same reason.

  ```diff
  - createPreviewResolvePlugin(remoteDatasourceContext, { editorPath, loading })
  + createPreviewResolvePlugin({ editorPath })
  - createRemoteDatasourceExplorerPlugin(snapshot, { editorPath, routeTemplateKeys, savedPreviewParams, remoteDatasourceRegistry, loadingIds })
  + createRemoteDatasourceExplorerPlugin({ editorPath })
  ```

- db21361: The editor chrome is now **responsive**. The plugin rail (Blocks / Outline / History / AI)
  is permanent — it no longer defaults to hidden behind a toggle, so the panels are visible
  on a first visit. Its toggle button and the `p1-plugin-rail-<siteId>` localStorage key are
  both removed; stale values for that key are ignored.

  Horizontal space is governed by one rule: the canvas never drops below 600px, and chrome
  yields in priority order as the window narrows. The left panel auto-collapses below 1308px
  and the right follows below 988px, with thresholds derived from the real chrome dimensions
  rather than fixed breakpoints. Auto-management only ever reopens a panel it closed itself —
  a panel the author closed stays closed at any width. The panel preference is written only at
  widths where nothing is auto-collapsed, so a narrow session never overwrites a wide-screen
  preference. Puck mounts with the budget-constrained visibility, so a narrow first load no
  longer paints both panels open and then snaps them shut.

  The preference key drops its site suffix: `p1-sidebar-<siteId>` becomes `p1-sidebar`, since
  localStorage is already origin-scoped and an origin serves a single site. The `{ left, right }`
  shape is unchanged, but the rename means an existing saved preference is not carried over —
  authors get the default (both panels open) once, then their next change sticks.

  The historical-version preview banner stays exactly one line tall at every canvas width.
  Its label truncates with an ellipsis (full text on hover) instead of wrapping the action
  row onto a second line, and it renders outside Puck's scaled preview wrapper so it measures
  the real canvas. The version steppers gain "Previous Version" / "Next Version" tooltips,
  suppressed while disabled or while a revert is in flight.

### Patch Changes

- 03c3ab3: Fixes the editor canvas and preview rendering the _previously_ selected workstream's document after a workstream switch. Deterministic, and it never self-corrected. Also fixes the first document of a cold load being dropped, which is what left you one behind before any switch had happened.

  The document sync key described which document had been **requested** rather than which one was **in hand**. `documentSyncKey(branchId, documentId)` was built from the live `css.branchId` while the data was read from a ref, and those come from different clocks: `switchBranch` commits the branch synchronously but only clears `currentDocument`/`currentData` later, in an async phase that awaits any in-flight switch plus a save-flush, and `documentLoading` is written only inside `loadDocument` so it stays `false` throughout. In that window the publish effect re-ran and published the incoming branch's key beside the outgoing branch's data. The sync plugin applied that pairing and recorded the new key as applied, so the correct document — arriving moments later under the same key — was skipped as already applied.

  Every payload the provider emits now carries the identity it was loaded under, committed in the same render pass as the data itself, and both the sync key and the data are derived from that one record. A new key paired with a different document's data is no longer guarded against; it is unrepresentable.

  The plugin's "first document observed is already on the canvas" special case is gone, replaced by an explicit `BLANK_SYNC_KEY` sentinel. That premise was false: Puck mounts with blank data and the branch is restored from `sessionStorage` _after_ mount, so the first correct payload was being swallowed. `ContextSyncBridge` now stands down unless the applied key matches the current document exactly, since the plugin owns the first document too.

  This also repairs the autosave write-back guard, which the bug had defeated. Both sides of its comparison read the new branch's key while the canvas still held the old branch's content, so it waved the save through — meaning an edit made right after a switch could write one workstream's content into another workstream's document. The applied key now genuinely means "what the canvas shows", so the guard drops those saves as intended.

  Puck is deliberately **not** remounted on a switch. Keying it by branch or document would fix the staleness by tearing down the preview iframe and re-parsing all canvas styles on every switch, which is the lag the sync store exists to avoid.

  No API change for consumers: `P1PuckContextValue` gains an optional `currentDataOrigin`, and the sync store's types are internal to the package.

- 89fd945: Profile pictures now render for logged in user and collaborators in the editor header, instead of everyone falling back to coloured initials. Initials remain the fallback for anyone whose account has no photo.
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
- Updated dependencies [74dda98]
  - @pantheon-systems/css-client@0.10.0

## 0.9.0

### Minor Changes

- 0077a4b: Adds a **Pantheon AI** button to the editor header. It opens the AI chat panel in the right-hand inspector rail, in place of the Page and Blocks tabs, and reveals the rail if it was collapsed.

  Enable it with `showAIPanelToggle` on `useP1Editor`'s `pluginOptions`; it is hidden by default. The panel itself comes from `@pantheon-systems/p1-ai-chat`.

  New exports: `useAIPanelOpen()` reads whether the panel is open, and `aiPanelStore` opens, closes or toggles it.

- be8bf28: The live collaborators indicator in the editor header is reworked. Collaborators now show
  as a stacked row of avatars with initials derived from the display name, a stable
  per-person colour, and an overflow count once the stack is full, so who's in the document
  is readable at a glance instead of a flat list. Presence identity is resolved from a single
  place, so the same person no longer appears twice after a reconnect.

  The editor header and subheader are restyled to match the design prototype: tighter
  spacing, aligned action groups, and the document-state badge moved in beside the title.

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

- d04d399: The Create Page dialog's "Generate with AI" no longer creates a page before handing the brief over. It calls `onGenerateWithAI` with the brief plus the title and path that were typed, then closes, and the assistant creates the page once the page template is settled.

  `onGenerateWithAI` no longer requires `onNavigate` alongside it, since the dialog no longer navigates. The tile still falls back to a placeholder when `onGenerateWithAI` is not passed.

- 83567a7: Adds a visual component sidebar: Puck's default component list is replaced with collapsible categories of real, live-rendered preview cards, based on each component's `defaultProps`. This is the default drawer for every `puck-css` editor — opt out via `useP1Editor`'s `liveThumbnailDrawer: false`. Also insets the editor canvas with a grey gutter and a slightly rounded page.

  Previews are cached in-memory per session (not persisted to localStorage — the cache feeds `dangerouslySetInnerHTML`, and localStorage is writable by any same-origin script) so identical cards aren't re-rendered on category re-expand or document switch. Each preview renders through an isolated config with a pass-through page root, so it shows only the component itself rather than the real, currently-open document's page chrome.

- be8bf28: The editor's layer list is replaced by a new **Outline panel**. It shows the page's
  component tree with each component's own icon, keeps the selected component in sync with
  the canvas, and supports drag-to-reorder within a level. Components that don't declare an
  icon fall back to a name-derived one, so the tree stays readable for custom blocks.

  The panel chrome is now shared and exported, so plugin panels can match it without
  re-implementing the frame: `PanelShell` (scroll container + borders), `PanelHeader`
  (title, optional actions), and `OutlinePanel` itself are available from
  `@pantheon-systems/puck-css/editor`, along with the `PanelShellProps` and
  `PanelHeaderProps` types.

### Patch Changes

- cbaa45c: **css-client:** Add Datasource and Query API endpoints. `DatasourcesEndpoint` provides `list`, `get`, and `delete` for content type datasources. `QueriesEndpoint` provides `list`, `get`, `delete`, and `getResults` with pagination support. New types exported: `Datasource`, `Query`, `QueryResults`, `QueryResultItem`, `QueryResultsMeta`, `QuerySortField`, and `QueryResultsParams`.

  **p1-next-sdk:** Integrate CSS query fetchers into server-side rendering. `createCssQueryFetchers` converts CSS queries into `RemoteDatasourceFetcher` instances for SSR data pre-fetching. Query fetchers are wired into the `datasource-context` and `editor-context` routes. Gracefully handles environments where the queries endpoint is unavailable.

  **puck-css:** Add `cssQueriesToDatasourceDefinitions` adapter to transform CSS query metadata into `RemoteDatasourceDefinition` entries for the editor datasource registry. Fix `mergeBlockForPreview` and `mergeRootForPreview` to preserve React element props (e.g. contentEditable spans) instead of overwriting them with resolved string values. Fix template overlay text visibility and caret rendering. Pass auth tokens to editor-context and datasource-context fetch calls when available.

- be8bf28: Inspector field labels no longer carry a field-type icon. Every field was prefixed with an
  icon representing its input type (text, number, select), which added visual noise without
  telling an editor anything the input itself didn't already show. Labels are now text only.
- be8bf28: The "New workstream" button is hidden in the workstream switcher. It rendered as an
  actionable menu item but had nothing wired to it, so clicking it did nothing — creating a
  workstream isn't supported from the editor yet. It'll come back when the flow behind it
  exists.
- be8bf28: Editor icons render at their intended size again. `pds-toolkit-react` renamed `<Icon>`'s
  `iconSize` prop to `size` in `2.0.0-alpha.43`, but puck-css was bumped past that release
  still passing `iconSize` at 18 call sites. Because `Icon` spreads unrecognised props onto
  the underlying `<svg>`, the size was silently dropped — icons fell back to the component
  default and React logged a "does not recognize the `iconSize` prop on a DOM element"
  warning on every render.

  The bundled type declarations for `pds-toolkit-react` had also kept the old prop name, which
  is why TypeScript never flagged it. They now match the real component and type `size` as
  the proper `IconSize` union, so both a stale prop name and an invalid size fail to compile.

- 7d51095: Fixes an editor crash (`RangeError: Empty text nodes are not allowed`) on any page whose blocks omit a rich-text prop that the component defaults to `""`. Puck merges `defaultProps` underneath stored props on every render, so an omitted rich-text key inherits its default; Puck's `RichTextRender` then wraps that non-HTML string as `{type:"text", text:""}`, and prosemirror-model rejects a zero-length text node. That render path has no error boundary, so a single bad prop takes down the whole subtree and the page appears not to load. `undefined` normalizes to an empty document and renders fine, so an absent value is safe and `""` is not.

  New `sanitizeRichtextDefaults` strips empty-string defaults from `richtext` fields in a Puck config, walking nested `objectFields`/`arrayFields` since rich text commonly lives inside array items. It returns the input by reference when there is nothing to strip, so it cannot break Puck's memoization on config identity. Applied inside `wrapConfigForEditorPreview`, which every P1 editor surface already routes through, so consumers are covered without an app-side change; also exported for direct use. This additionally fixes the component drawer, whose live thumbnails render each component from `defaultProps` alone and so crashed independently of any document (PCC-3589).

- Updated dependencies [cbaa45c]
- Updated dependencies [78b00e2]
- Updated dependencies [be8bf28]
  - @pantheon-systems/css-client@0.9.0

## 0.8.0

### Patch Changes

- The right-side inspector is now read-only while previewing an older version, so edits made during preview no longer leak into the previewed content.
- Minimum supported Node.js is now 24. The `engines.node` field on these packages moved from `>=18.0.0`/`>=20.12.0` to `>=24.0.0`, so installs on older Node will warn (or fail, depending on your package manager's `engine-strict` setting).
- Bumped `@pantheon-systems/pds-toolkit-react` to `2.0.0-alpha.51`.
- Template pinning now resolves by slot id instead of component type. A canvas component is pinned when its own `props.id` maps to `true` in the template's `root.props._pinMap` and a matching instance exists in the template's content or zones, so a same-typed local or duplicated component is never locked and structural validation can no longer be satisfied by a stand-in of the same type. On a bound page the live template governs pins, so unpinning in the template now takes effect on existing pages rather than being masked by the page's stale snapshot pin map.

  Creating a page from a template is now delegated to the backend: `documents.create` carries `templateId`, `templateVersion`, and `title`, and no client snapshot follows, so version 1 is built server-side with the template's slot ids preserved. Blank pages keep the client-built initial version. The local template scaffold and its non-deterministic id minter are removed.

- Plugin rail visibility now persists across reloads and document navigation. The rail's open/closed state was plain component state, so it reset to hidden on every remount — which happens on each document navigation, since `<Puck>` is keyed per document. It now reads and writes `localStorage` keyed by `siteId`, matching the existing left/right sidebar behavior. First-visit default is unchanged (hidden).
- Fixed `PRODUCTION_BASE_URL` missing its `.io` TLD.
- Registry component documents are now matched case-insensitively. The server's `normalizePath` lowercases every document path, so a component registered as `HeroBlock` lists back at `_registry/components/heroblock`; the sync's case-sensitive lookups missed it and re-registered every PascalCase component on every editor load (create → 409 → `getByPath` recovery → new version), defeating the index-hash fast path and bloating `document_versions`. All in-memory matching now goes through a lowercased key. Stored formats are unchanged. Names that collide case-insensitively share one server document and now emit a warning.
- SEO metadata from the content API now reaches the rendered `<head>`. `css-client` exposes a typed `SeoMetadata` object on `PageContent`; on public reads the `puck-css` DAL folds it into `root.props._seo` via an immutable shallow merge, so it rides the single `Data` currency through `resolvePageData` into each route's `generateMetadata` without widening `getPage`'s return type. Editor (auth-token) and versions reads leave `Data` unchanged. `SeoMetadata` is re-exported from `@pantheon-systems/puck-css/server` so apps can type `_seo` without taking a direct `css-client` dependency.
- Creating a new page now generates a single version instead of 2–3.
- The Workstream switcher no longer resets to Live/main when navigating between documents. `switchBranch()` previously persisted the new branch only after an async save-flush completed, so navigating away mid-flush remounted with a stale branch; the selection is now committed immediately. Flushes are also serialized via an in-flight promise, so rapid re-selection during an in-flight save can no longer save the outgoing edit twice to two different branches.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @pantheon-systems/css-client@0.8.0

## 0.7.0

### Minor Changes

- e937842: Adds a `./registry-sync` subpath export exposing `syncComponentRegistry`, `extractDescriptors`, and `buildRegistryIndex` with no React dependency, so component-registry syncing can run outside the browser (e.g. a headless CI script). This is a behavior-preserving extraction: `useComponentRegistry`'s public API, deps, and browser behavior are unchanged — it now delegates to the same logic via the new module instead of an inline, module-private function.
- e937842: `@pantheon-systems/css-client`: `documents.create()` accepts an optional `snapshot`, written as the initial version in the same call instead of requiring a separate `versions.create()` round-trip. Purely additive — omitted by every existing caller, unchanged behavior for them.

  `@pantheon-systems/puck-css`: adds `syncComponentRegistryWriteOnly` to the `./registry-sync` subpath export — a CI-only counterpart to `syncComponentRegistry` for a `write:registry`-scoped token with no read access at all. Always creates-or-versions every descriptor + the registry index unconditionally, with no existence/hash-check reads, relying on the backend treating `_registry/*` document creation as idempotent. `syncComponentRegistry` itself is unchanged and keeps its skip-if-unchanged behavior for the interactive editor.

### Patch Changes

- b0254ff: Bump `@pantheon-systems/pds-toolkit-react` (PDS v2) from `2.0.0-alpha.12` to `2.0.0-alpha.44`. The older alpha declared `@fortawesome/pro-*` FontAwesome Pro packages as `optionalDependencies`; those 404 on public npm and failed the pnpm `minimumReleaseAge` supply-chain check, breaking `pnpm install --frozen-lockfile` in CI on any lockfile regeneration. alpha.44 drops those optionals, resolving the failure at the source. No API adaptation was required (puck-css typechecks clean against alpha.44).
- `syncComponentRegistry`'s fast path trusts the registry index's cached `hashes` map and skips re-reading a component's descriptor whenever the hash still matches, so it never notices a descriptor that drifted out of band (e.g. reverted independently of the index). The registry index now carries a `verifiedAt` timestamp, and the fast path forces a full per-component re-verification once that timestamp is more than 24 hours old, bounding how long such a drift can persist instead of letting it stand indefinitely. Behavior-preserving for the common case: `verifiedAt` fresh and hashes matching still takes the fast path exactly as before.
- Updated dependencies [e937842]
  - @pantheon-systems/css-client@0.7.0

## 0.6.0

### Patch Changes

- @pantheon-systems/css-client@0.6.0

## 0.5.0

### Minor Changes

- 0bc7982: Template types and the template editor now use the content snapshot shape: a `Template` carries `content` items plus `root.props._template` metadata and `root.props._pinMap` pin state, mirroring a Puck document. `templates.list()` returns `TemplateSummary[]` (metadata only, no layout content); fetch a template by ID for its full snapshot. Template layout is authored on the editor canvas and saved through document versions; `templates.create()` and `templates.update()` now accept metadata fields only (label, description, defaultUrlPattern, deprecated). This requires a backend running the matching template API (PCC-3357). Older 0.4.x clients keep working against the updated backend through a temporary compatibility window that also serves derived legacy fields (a top-level label and a components array). The client also reviews and resolves migration conflicts via `migrationConflicts.list()` and `migrationConflicts.resolve()`.

### Patch Changes

- Updated dependencies [0bc7982]
  - @pantheon-systems/css-client@0.5.0

## 0.4.4

### Patch Changes

- Fix editing the root "/" homepage from the editor page switcher: selecting the homepage now opens the editor instead of navigating to the dashboard, and all pages route through a single `/p1/` separator via `editorPathHref` (also fixing non-root page links).
- Updated dependencies
  - @pantheon-systems/css-client@0.4.4

## 0.4.3

### Patch Changes

- Bug fixes and improvements: deferred branch detection for read:published tokens, init promise retry, production backend URL handling, editor top menu UI improvements.
- Updated dependencies
  - @pantheon-systems/css-client@0.4.3

## 0.4.2

### Patch Changes

- 6650602: Public SSR with a read:published sat\_ token now initializes and renders without touching the branches or versions endpoints.
- dc7cfd7: Fix packages being published with unresolved workspace:\* references by switching from npm publish to pnpm publish. Fix starter kit CLI to show "npm run dev" instead of "npm dev" for npm users.
- Updated dependencies [dc7cfd7]
  - @pantheon-systems/css-client@0.4.2
