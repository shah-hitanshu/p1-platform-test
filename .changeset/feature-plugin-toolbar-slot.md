---
"@pantheon-systems/puck-css": minor
---

**[Added]** A feature plugin can place a control in the editor's document toolbar.

### What Changed
- `P1FeaturePlugin.toolbarActions` returns a control to render in the toolbar above the canvas. Returning nothing contributes nothing, so a feature can stay out of the toolbar while its other slots run.
- Controls are placed in plugin priority order, so a site composing several features gets the same toolbar every time.
