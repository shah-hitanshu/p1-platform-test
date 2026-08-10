---
'@pantheon-systems/p1-content-validator': minor
---

`validateOps` now rejects a write whose component `type` doesn't match the registry's
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
