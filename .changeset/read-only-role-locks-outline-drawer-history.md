---
"@pantheon-systems/puck-css": patch
---

**[Fix]** A read-only role can no longer reorder or delete blocks from the Outline panel, drag new blocks out of the Blocks drawer, use undo/redo, or save and delete data sources.

### What Changed

- Outline panel rows lose their drag handle and Delete button when the signed-in user cannot edit documents. Rows can still be selected to inspect a block.
- Blocks in the drawer cannot be picked up for a read-only user, matching how they already behave while previewing a historical version.
- The Undo and Redo toolbar buttons stay disabled for a read-only user, so local changes that were never going to save cannot be replayed.
- In the Data sources panel, "Save datasource" and "Delete" are disabled for a read-only user, with a note explaining that edit permission is required.

Previously these controls stayed interactive: the edits were applied on the canvas and then discarded before saving, which looked like editing that silently failed.
