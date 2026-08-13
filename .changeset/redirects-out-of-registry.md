---
"@pantheon-systems/create-p1-starter-kit": patch
---

The starter's catch-all route now treats `_redirects/*` as an internal document namespace alongside `_registry/*`, so redirect records can never render as pages.

Redirect records moved out of `_registry/`, which merge and checkpoint capture treat as code-owned and strip unconditionally — a redirect created on a workstream could never reach the main branch a live site resolves redirects against.
