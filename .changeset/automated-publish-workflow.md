---
"@pantheon-systems/p1-ai-chat": patch
---

Add automated release workflow using changesets. Merging changesets to `main`
now opens a "Version Packages" PR; merging that PR publishes to npm via OIDC
trusted publishing.
