# @pantheon-systems/p1-content-validator

## 2.1.3

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

## 2.1.2

### Patch Changes

- a16d921: Set `license` to `UNLICENSED` to match the rest of the suite. These packages had drifted
  to `MIT` (or had no `license` field at all), but they are closed-source and were never
  intended to be published under an open-source license.

## 2.1.1

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

## 2.1.0

### Minor Changes

- be8bf28: `validateOps` now rejects a write whose component `type` doesn't match the registry's
  canonical casing, naming the expected spelling in the error.

  This closes a case that previously validated clean and then broke at render. Puck resolves
  `type` by exact key lookup into `config.components` with no normalisation, so a document
  holding `"quoteblock"` against a config keyed `"QuoteBlock"` breaks the editor and the
  published page — even though every prop on that component validated fine. The registry
  lookup stays case-insensitive on purpose: that's how a mis-cased type gets found at all, so
  the error can tell you the casing to use instead of degrading into a bare "unknown component
  type".

  Mis-cased types are rejected rather than silently corrected — a writer that meant a
  different component should hear about it. Hand-built registries that omit a descriptor
  `name` are unaffected, since there's no canonical casing to hold the writer to.

- dbcbf4d: **p1-content-validator:** Add translation authority and translatability resolution. `validateTranslationAuthority` reports writes that target a prop the translation does not own, distinguishing a warning from a violation. `resolveTranslatable`, `resolveSlotAuthority`, and `resolveSlotAuthorityMap` resolve a prop's effective authority from a template's per-slot defaults and a translation's per-prop overrides, with `AUTHORITIES`, `DEFAULT_AUTHORITY`, and `isAuthority` exposing the authority values themselves. `TemplateSnapshot` now carries an optional `root.props._localeAuthority` map of per-slot defaults. New types exported: `Authority`, `AuthoritySeverity`, `AuthorityOverrideMap`, `AuthorityDiagnostic`, and `ValidateTranslationAuthorityInput`.

  A prop-path edit now resolves the innermost component in the path rather than the outermost, so a write into a component nested in a slot prop is validated against that component's schema.

- be8bf28: Two registry helpers are now exported: `registryComponentKey`, which produces the
  case-insensitive key used to match a component across the registry, and
  `componentNameFromPath`, which recovers a component name from its registry document path.

  Both were already used internally to match registry documents regardless of casing. They're
  exported so callers syncing or inspecting a registry can derive the same keys instead of
  re-deriving the normalisation rules and drifting from them.
