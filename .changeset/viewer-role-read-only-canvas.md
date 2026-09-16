---
"@pantheon-systems/puck-css": minor
---

**[Feature]** Roles that cannot edit documents now see a fully locked canvas: props and structural controls are disabled, inline rich-text editing is suppressed, action-menu items requiring edit access are hidden, and any change that reaches the save layer is silently dropped.

### What Changed

- The prop inspector, blocks drawer, drag handles, and insert/delete controls are all locked when `permissions.canEditDocuments` is `false`.
- `contentEditable` fields on the canvas are stripped so rich-text inline editing is unavailable.
- The action menu (`PublishControl`) filters per flag: Review requires `canProposeMerge`, Publish requires `canCreateCheckpoint`, Create workstream requires `canCreateBranch`, and Delete page requires `canEditDocuments`. Items are dropped entirely rather than shown disabled.
- A "You are viewing this page in read-only mode." banner appears above the canvas frame for read-only roles.
- Changes that reach `onChange` or the component registry while the role cannot edit are silently discarded as a backstop.

### Migration / Action Required

No changes required. When `permissions` is absent from the P1 context, all behavior is unchanged (backward compatible).
