---
"@pantheon-systems/puck-css": patch
---

Fix an editor crash when the installed `pds-toolkit-react` is missing an icon the outline panel asks for.

`Icon` dereferences its glyph entry without a guard, so an icon name the installed version does not ship throws during render rather than rendering nothing. The outline panel passed a keyword-derived name straight through, so a block whose icon had been renamed or removed unmounted the whole editor — and it repeated on every load of any document containing that block, leaving the page unopenable.

Icon names now resolve against the set `pds-toolkit-react` reports it ships, preferring a shipped alternative (`link` → `linkSimple`) and rendering no icon when it ships none. `SafeIcon` additionally contains any such throw so a missing glyph can never cost more than itself.
