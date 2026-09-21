---
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** Removed the plain-text "List" block from the Typography category in the starter's block picker. It shared its label with the datasource-bound "List" block in the Data category, making the two indistinguishable when adding a block. The Data category's "List" block is unchanged.

The example SWAPI datasource no longer advertises a `markdownLinks` path. That token expanded to markdown link lines for the removed block's free-text items field, and no remaining starter block renders them as links. Use the `items` array with an Array field instead.

### Migration / Action Required

None. This only affects newly scaffolded sites; an already-scaffolded site owns its own copy of `puck.config.tsx` and `lib/remote-datasources.ts` and is unaffected.
