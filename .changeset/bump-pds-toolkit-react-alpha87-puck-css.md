---
"@pantheon-systems/puck-css": minor
---

**[Breaking Change]** `@pantheon-systems/pds-toolkit-react` bumped to `2.0.0-alpha.87` (peer requirement raised to `>=2.0.0-alpha.86`), which redesigned the `Icon` size scale.

### What Changed
- Every icon size name shifts to a new pixel value as of `pds-toolkit-react` `2.0.0-alpha.86`: old `s`→new `xs`, old `l`→new `xl`, old `xl`→new `2xl`, old `2xl`→new `4xl`; `m` is unchanged; old `3xl` (40px) has no exact replacement. All `Icon` usages inside this package have been migrated to keep their original visual size, with one exception below.
- The "choose a page" empty-state icon shrinks from 40px to 32px — its old size (`3xl`) no longer exists and the nearest available size is smaller.
