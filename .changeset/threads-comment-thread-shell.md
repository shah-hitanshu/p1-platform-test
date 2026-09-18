---
"@pantheon-systems/puck-css": minor
---

**[Feature]** The comment panel that opens from a block's comment trigger now has the shape of a thread: a header naming the block, a place for its comments, and a composer.

### What Changed

- The panel header shows a block icon and the block's name — the same name the outline uses — with a `Resolved` badge when the thread has been resolved, and the close button.
- Below the header is the comment list, empty until threads are stored, and below that a composer: a text area for a new comment, a note on mentioning someone and posting from the keyboard, and a `Post` button that stays disabled until the draft says something.
- ⌘/Ctrl + Enter posts from the text area.
- `CommentTrigger` takes a `subject` (`{ label, icon? }`) naming the thing being discussed, and `resolved` for a thread that has been closed out. Without a `subject` the panel names the kind of thing instead — "Page", "Workstream". `BlockCommentTrigger` resolves the block's name itself.
- `CommentThread` takes an `onPost` callback that receives the trimmed draft. Nothing wires it yet: posting from a block's panel becomes real when threads are stored.

### Migration / Action Required

None. The placeholder text the panel used to show is gone; anything selecting the panel should use its `data-context-type` and `data-context-id` attributes.
