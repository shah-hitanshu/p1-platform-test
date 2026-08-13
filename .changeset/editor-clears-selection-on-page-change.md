---
"@pantheon-systems/puck-css": patch
---

**[Fix]** Opening another page in the editor no longer leaves a block selected from the page you left.

### What Changed

Selection is held by position, so a selection that survived a page change became whichever block sits at that position on the new page. The inspector showed that block's fields and the outline highlighted it, and an edit made there landed on a page you were not looking at. The editor now clears the selection when it loads a different document.
