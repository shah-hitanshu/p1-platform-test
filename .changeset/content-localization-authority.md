---
"@pantheon-systems/p1-content-validator": minor
---

**p1-content-validator:** Add translation authority and translatability resolution. `validateTranslationAuthority` reports writes that target a prop the translation does not own, distinguishing a warning from a violation. `resolveTranslatable`, `resolveSlotAuthority`, and `resolveSlotAuthorityMap` resolve a prop's effective authority from a template's per-slot defaults and a translation's per-prop overrides, with `AUTHORITIES`, `DEFAULT_AUTHORITY`, and `isAuthority` exposing the authority values themselves. `TemplateSnapshot` now carries an optional `root.props._localeAuthority` map of per-slot defaults. New types exported: `Authority`, `AuthoritySeverity`, `AuthorityOverrideMap`, `AuthorityDiagnostic`, and `ValidateTranslationAuthorityInput`.

A prop-path edit now resolves the innermost component in the path rather than the outermost, so a write into a component nested in a slot prop is validated against that component's schema.
