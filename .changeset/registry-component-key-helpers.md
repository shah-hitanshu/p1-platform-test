---
'@pantheon-systems/p1-content-validator': minor
---

Two registry helpers are now exported: `registryComponentKey`, which produces the
case-insensitive key used to match a component across the registry, and
`componentNameFromPath`, which recovers a component name from its registry document path.

Both were already used internally to match registry documents regardless of casing. They're
exported so callers syncing or inspecting a registry can derive the same keys instead of
re-deriving the normalisation rules and drifting from them.
