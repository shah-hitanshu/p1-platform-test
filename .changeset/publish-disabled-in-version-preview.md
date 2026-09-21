---
"@pantheon-systems/puck-css": patch
---

**[Fix]** While a historical version is being previewed from Version History, the editor's Publish button is now greyed out and the "Changes pending publishing" badge is hidden, instead of offering to publish a read-only page and reporting pending changes that do not belong to the version on screen.

### What Changed
- `PublishControl` takes a `disabled` prop that it forwards to the PDS `SplitButton`, which disables both the primary action and the more-actions menu.
- `P1EditorSubheader` exposes this as `publishDisabled`, and the editor toolbar sets it from the editor context's `isViewingHistoricalVersion`.
- The toolbar's badge state is suppressed during a preview for the same reason it is already suppressed off the Live branch: the published status describes the current version, not the previewed one, and a guessed state is worse than none.
