---
"@pantheon-systems/puck-css": patch
---

**[Fix]** Removed the right inspector panel's in-canvas "reopen strip", added in a prior release to work around the panel becoming unreachable when both side panels were collapsed.

### What Changed
- The right panel now collapses fully to 0px width, the same as the left panel, instead of reserving 48px of canvas for a reopen button.
- Reopening the panel is done through the existing top toolbar "Toggle right panel" button, which already covered this case and predates the strip.
