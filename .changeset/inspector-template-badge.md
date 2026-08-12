---
"@pantheon-systems/puck-css": minor
---

Adds a template badge to the bottom of the inspector's Page tab, showing which template the current page is bound to. The label is read from the current template's `_template.label`, falling back to matching the document's `templateId` against the loaded template list. The badge is hidden when a block is selected or when the page has no bound template.
