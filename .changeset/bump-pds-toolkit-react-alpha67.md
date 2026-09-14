---
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** New scaffolds now pin `@pantheon-systems/pds-toolkit-react` to `2.0.0-alpha.67`, fixing a dropdown/menu that could render clipped past the right edge of the viewport.

### What Changed
- The starter template's `pds-toolkit-react` dependency moved from `2.0.0-alpha.66` to `2.0.0-alpha.67`, which fixes viewport-edge clipping on several Dropdown/Select components.

### Migration / Action Required
None for new scaffolds. Existing projects already scaffolded are unaffected (the template is copied at scaffold time); bump `@pantheon-systems/pds-toolkit-react` yourself to pick up the fix.
