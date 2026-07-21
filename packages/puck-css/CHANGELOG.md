# @pantheon-systems/puck-css

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
