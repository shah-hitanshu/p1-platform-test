---
"@pantheon-systems/puck-css": minor
---

**[Added]** A feature plugin can ask the editor to open a document or start a new page.

### What Changed
- `deps.openDocument(path)` moves the editor to another document. Where the host handles document selection the URL and the page selector move with the canvas; where it does not, the document loads in place.
- `deps.openCreatePage({ locale, sourceDocumentId })` opens the create-page modal, aimed at a locale and at the page a new version starts from.
- Both are safe to call and safe to hold in a dependency array for the editor's lifetime. Until the editor fills them they do nothing, so a plugin needs no check of its own.
