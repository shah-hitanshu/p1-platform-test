---
"@pantheon-systems/puck-css": patch
---

**[Fix]** Select field values in the editor field panel are no longer clipped.

### What Changed

- The value text in a closed `select` field — such as `og:type` in the page metadata panel — had the top of its glyphs cut off. PDS styles the bare `select` element with a fixed control height while Puck's field CSS adds its own vertical padding and sets no height; because the PDS rule is layered, the two combined instead of one winning, leaving a content box too short for the line of text. Selects now size from their padding like the text fields beside them, so the value renders fully and every select field matches the height of its neighbours.
