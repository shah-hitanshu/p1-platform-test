---
"@pantheon-systems/puck-css": patch
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** A document row in the merge preview panel now responds to hover, and a document path is set in medium weight. New scaffolds no longer ship a standalone `/p1/merge` page.

### What Changed
- `.merge-preview-document__row` gained a hover background, so a row that is already `cursor: pointer` also looks clickable.
- `.merge-preview-document__path` is now weighted to stand out from the rest of the row.
- The scaffold template no longer includes `app/p1/merge/`. Merge review is reached through the editor's built-in "Compare with Live" overlay, which needs no route of its own.

Both CSS rules apply to `MergePreviewPanel` — reachable via the exported component or `createMergePreviewPlugin`. They do not affect the "Compare with Live" overlay, which renders its own document list.

Existing projects are unaffected: an app that already has `app/p1/merge/` keeps it, and removing it is optional. If you do remove it, `/p1/merge` will not 404 — the editor mounts at an optional catch-all, so the URL falls through and opens the editor on a document at that path.
