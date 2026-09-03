# @pantheon-systems/css-client

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

- eb0d356: Merge job runner support (PCC-3737): `merge.executeRequest` responses may now carry the async job shape (`jobId`, `status`, counters, `statusUrl`) when a merge outlives the server's bounded wait; new `merge.getJob` and `merge.waitForJob` poll it to a terminal state. The editor's merge-resolution flow polls long-running merges to completion instead of misreading the accepted response as success.
- eb0d356: Add `merging` to `MergeRequestStatus`: merge requests report this status while the merge job runner is executing them (PCC-3737). Existing statuses are unchanged; clients that switch exhaustively on the status union should handle the new value.
- 053ca52: Stop sending the full local Yjs history on every WebSocket connect. On first connect
  the client sends no state vector; the server responds with its full current state and
  a baseline verdict. On reconnects the client sends only the delta the server is
  missing. When the server reports the client's lineage has diverged (code 4002), the
  client fetches fresh content from REST and reconnects with a new Y.Doc — bypassing the
  union-merge admission path that could otherwise resurrect pre-merge content.
- 61cb80e: **[Breaking Change]** The `crdtState` field is removed from the `DocumentVersion` type.

  ### What Changed
  - `DocumentVersion.crdtState` no longer exists. The API stopped returning this field some time ago (its backing storage was removed server-side), so the type was promising a `string | null` value that was always `undefined` at runtime.

  ### Migration / Action Required

  Delete any reference to `version.crdtState` — code that read it was already receiving `undefined`, and object literals typed as `DocumentVersion` no longer need to supply it.

  ```ts
  // Before
  const version: DocumentVersion = {
    id,
    documentId,
    branchId,
    versionNumber,
    snapshot,
    crdtState: null /* … */,
  };

  // After
  const version: DocumentVersion = { id, documentId, branchId, versionNumber, snapshot /* … */ };
  ```

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

## 0.12.0

### Patch Changes

- b99acfb: Carry the HTTP status on `AuthenticationError` for 401 responses, so callers reporting "request X failed (status)" can name the status for a rejected session the same way they can for other API errors. Stays optional: the error is also thrown when no token could be obtained locally, where there is no response and no status.
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

## 0.11.1

### Patch Changes

- a16d921: Set `license` to `UNLICENSED` to match the rest of the suite. These packages had drifted
  to `MIT` (or had no `license` field at all), but they are closed-source and were never
  intended to be published under an open-source license.

## 0.11.0

## 0.10.0

### Minor Changes

- d44e904: **css-client:** Label requests for backend correlation. Every call now sends a W3C
  `traceparent`, an `x-p1-request-id`, and `x-p1-sdk` identifying the calling package and
  version, so a request can be traced from your application through the P1 backend to the
  database.

  The client does not collect, buffer, or transmit telemetry anywhere — it only labels the
  API calls you already make, and issues no additional network requests.

  Errors now carry the correlation id. `P1ApiError` (and its subclasses), `NetworkError`,
  `AuthenticationError`, and `SessionExpiredError` expose `requestId`, and it is appended to
  the error message as `[request id: …]` so it survives into logs and support tickets. The id
  the server reports is preferred; when a request never reaches the API, the client-minted id
  is used, so there is always something to quote.

  Three new optional `P1ClientConfig` fields:

  - `sdk` — `{ name, version }` for a wrapper SDK to identify itself instead of `css-client`.
  - `clientId` — an application identifier sent as `x-p1-client-id`, for telling your own
    deployments apart in backend logs. Don't put anything personally identifying here.
  - `getTraceparent` — supplies a `traceparent` from an ambient tracer, so a host application
    already running OpenTelemetry keeps one trace across its own spans and this client's
    requests. Omit it and each request starts a fresh trace.

  No breaking changes; every new field is optional and existing behavior is unchanged.

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

## 0.9.0

### Minor Changes

- cbaa45c: **css-client:** Add Datasource and Query API endpoints. `DatasourcesEndpoint` provides `list`, `get`, and `delete` for content type datasources. `QueriesEndpoint` provides `list`, `get`, `delete`, and `getResults` with pagination support. New types exported: `Datasource`, `Query`, `QueryResults`, `QueryResultItem`, `QueryResultsMeta`, `QuerySortField`, and `QueryResultsParams`.

  **p1-next-sdk:** Integrate CSS query fetchers into server-side rendering. `createCssQueryFetchers` converts CSS queries into `RemoteDatasourceFetcher` instances for SSR data pre-fetching. Query fetchers are wired into the `datasource-context` and `editor-context` routes. Gracefully handles environments where the queries endpoint is unavailable.

  **puck-css:** Add `cssQueriesToDatasourceDefinitions` adapter to transform CSS query metadata into `RemoteDatasourceDefinition` entries for the editor datasource registry. Fix `mergeBlockForPreview` and `mergeRootForPreview` to preserve React element props (e.g. contentEditable spans) instead of overwriting them with resolved string values. Fix template overlay text visibility and caret rendering. Pass auth tokens to editor-context and datasource-context fetch calls when available.

- be8bf28: `SeoMetadata` on the content payload gains two optional site-wide defaults, `ogImage` and
  `ogLocale`. A page that leaves either field empty now inherits the site's value instead of
  omitting the tag, so the resolution order is page value → site default → omit.

  Both are additive and optional, so an un-upgraded consumer of the payload keeps working;
  reading the new fields just requires this version's types.

### Patch Changes

- 78b00e2: Complete the SDK half of removing the per-environment `P1_SITE_URL` requirement (PCC-3531 phase 3). A multidev inherits its site's `P1_SITE_URL` at provisioning time, which points at the wrong environment with no error -- that cannot be fixed operationally, only by no longer depending on it.

  The browser has always known its own origin; it just never said so. `css-client`'s `login()` now states it -- `{ origin }` in proxy mode, `{ proposedRedirectUrl }` in direct mode, since direct mode has no server hop to compose the URL -- and `p1-next-sdk`'s `postBrokerLogin` forwards it upstream as `proposedRedirectUrl`, but only when neither `P1_SITE_URL`/`p1SiteUrl` nor an explicit `redirectUrl` is configured: a configured site's request is byte-identical to before this existed. Neither layer makes a trust decision -- CCR is the only party that authenticates the site, so it is the only place the proposal is checked against the site's registered origins (already live; this was the unused half).

  Also fixes a disclosure this same mechanism created: `/p1/auth/login` is a public, unauthenticated endpoint, and CCR's decline-warning was being returned straight through in the response body, letting a caller probe whether a given origin is registered for a site by watching the warning appear or vanish. The warning is now logged server-side with a `[P1AuthHandler]` prefix and stripped before the response reaches the browser.

## 0.8.0

### Patch Changes

- Minimum supported Node.js is now 24. The `engines.node` field on these packages moved from `>=18.0.0`/`>=20.12.0` to `>=24.0.0`, so installs on older Node will warn (or fail, depending on your package manager's `engine-strict` setting).
- Template pinning now resolves by slot id instead of component type. A canvas component is pinned when its own `props.id` maps to `true` in the template's `root.props._pinMap` and a matching instance exists in the template's content or zones, so a same-typed local or duplicated component is never locked and structural validation can no longer be satisfied by a stand-in of the same type. On a bound page the live template governs pins, so unpinning in the template now takes effect on existing pages rather than being masked by the page's stale snapshot pin map.

  Creating a page from a template is now delegated to the backend: `documents.create` carries `templateId`, `templateVersion`, and `title`, and no client snapshot follows, so version 1 is built server-side with the template's slot ids preserved. Blank pages keep the client-built initial version. The local template scaffold and its non-deterministic id minter are removed.

- SEO metadata from the content API now reaches the rendered `<head>`. `css-client` exposes a typed `SeoMetadata` object on `PageContent`; on public reads the `puck-css` DAL folds it into `root.props._seo` via an immutable shallow merge, so it rides the single `Data` currency through `resolvePageData` into each route's `generateMetadata` without widening `getPage`'s return type. Editor (auth-token) and versions reads leave `Data` unchanged. `SeoMetadata` is re-exported from `@pantheon-systems/puck-css/server` so apps can type `_seo` without taking a direct `css-client` dependency.

## 0.7.0

### Minor Changes

- e937842: `@pantheon-systems/css-client`: `documents.create()` accepts an optional `snapshot`, written as the initial version in the same call instead of requiring a separate `versions.create()` round-trip. Purely additive — omitted by every existing caller, unchanged behavior for them.

  `@pantheon-systems/puck-css`: adds `syncComponentRegistryWriteOnly` to the `./registry-sync` subpath export — a CI-only counterpart to `syncComponentRegistry` for a `write:registry`-scoped token with no read access at all. Always creates-or-versions every descriptor + the registry index unconditionally, with no existence/hash-check reads, relying on the backend treating `_registry/*` document creation as idempotent. `syncComponentRegistry` itself is unchanged and keeps its skip-if-unchanged behavior for the interactive editor.

## 0.6.0

## 0.5.0

### Minor Changes

- 0bc7982: Template types and the template editor now use the content snapshot shape: a `Template` carries `content` items plus `root.props._template` metadata and `root.props._pinMap` pin state, mirroring a Puck document. `templates.list()` returns `TemplateSummary[]` (metadata only, no layout content); fetch a template by ID for its full snapshot. Template layout is authored on the editor canvas and saved through document versions; `templates.create()` and `templates.update()` now accept metadata fields only (label, description, defaultUrlPattern, deprecated). This requires a backend running the matching template API (PCC-3357). Older 0.4.x clients keep working against the updated backend through a temporary compatibility window that also serves derived legacy fields (a top-level label and a components array). The client also reviews and resolves migration conflicts via `migrationConflicts.list()` and `migrationConflicts.resolve()`.

## 0.4.4

### Patch Changes

- Fix editing the root "/" homepage from the editor page switcher: selecting the homepage now opens the editor instead of navigating to the dashboard, and all pages route through a single `/p1/` separator via `editorPathHref` (also fixing non-root page links).

## 0.4.3

### Patch Changes

- Bug fixes and improvements: deferred branch detection for read:published tokens, init promise retry, production backend URL handling, editor top menu UI improvements.

## 0.4.2

### Patch Changes

- dc7cfd7: Fix packages being published with unresolved workspace:\* references by switching from npm publish to pnpm publish. Fix starter kit CLI to show "npm run dev" instead of "npm dev" for npm users.
