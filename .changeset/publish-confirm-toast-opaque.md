---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The publish and delete confirmation toasts no longer render with a transparent background.

### What Changed

- Recent design-system builds paint the toast card from a `--pds-color-toast-*` custom-property family (background, foreground, action, and one icon colour per status) that the design-system core stylesheet this package pins does not define. An undefined `background-color` computes to `transparent`, so the "Publish directly to live site?" confirmation showed the editor toolbar straight through it — its Confirm/Cancel buttons overlapping the branch selector and Publish button — and the warning icon fell back to inherited grey instead of amber.
- Those properties are now bridged to the tokens the pinned core stylesheet does define, so the toasts render opaquely against either naming.

### Migration / Action Required

None.
