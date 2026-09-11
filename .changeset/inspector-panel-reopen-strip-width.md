---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The right-hand page/description panel can now be reopened after closing it, even when the left panel is also closed.

### What Changed
- Closing the right panel while the left panel was already closed left no visible control to bring it back — only Puck's own drag-to-resize edge worked, and it wasn't discoverable. The reopen button now gets the layout width it needs in that state too, so it stays visible and clickable.
- The editor's panel collapse/reopen controls now carry stable `data-testid` hooks, and the Blocks panel shell carries a `blocks-panel` id, so tests can target them without matching on Puck's per-build hashed class names.
