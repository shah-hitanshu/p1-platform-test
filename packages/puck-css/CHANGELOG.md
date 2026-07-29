# @pantheon-systems/puck-css

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
