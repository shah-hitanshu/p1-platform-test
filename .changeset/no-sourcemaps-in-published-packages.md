---
"@pantheon-systems/puck-css": patch
"@pantheon-systems/css-client": patch
"@pantheon-systems/p1-next-sdk": patch
"@pantheon-systems/p1-ai-chat": patch
"@pantheon-systems/p1-media": patch
"@pantheon-systems/p1-content-validator": patch
---

**[Fix]** A new project's first `npm test` no longer prints a wall of "Sourcemap for ... points to missing source files" warnings.

### What Changed
- The published packages no longer ship sourcemaps. The maps referenced TypeScript sources that are not part of the published package, so bundlers warned about every one of them. Tests and builds were unaffected — the warnings were only noise.
- Nothing to configure: update your dependencies and the warnings are gone.
