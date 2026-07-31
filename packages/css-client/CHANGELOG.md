# @pantheon-systems/css-client

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
