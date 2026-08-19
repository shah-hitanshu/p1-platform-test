# @pantheon-systems/p1-content-validator

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
