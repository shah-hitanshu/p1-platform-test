---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The editor toolbar's icon-only buttons now name themselves on hover.
The panel toggles and undo/redo showed nothing, and the two panel toggles use
the same icon, so there was no way to tell them apart. A disabled undo or redo
names itself too.
