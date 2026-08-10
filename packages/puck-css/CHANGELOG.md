# @pantheon-systems/puck-css

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
