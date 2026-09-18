---
"@pantheon-systems/puck-css": minor
---

**[Feature]** Opening a block's comment thread now shows what has been said in it, and a comment posted from the thread appears in the list as soon as it lands.

### What Changed

- Opening a thread asks for its comments and lists them oldest first, each with who said it, when, and the comment. A mention reads as the member's name. While the comments are on their way the panel says so; if they cannot be loaded it says that instead and offers to try again.
- A thread reopened within half a minute is shown from memory rather than asked for again.
- Posting from the thread adds the comment to the list without another request. While a comment is in flight the `Post` button is disabled, and a comment that does not land leaves the draft in place and says so, rather than losing what was typed.
- `CommentThread` takes `comments`, `loading`, `failed`, `onRetry`, `posting` and `postFailed`, so a host rendering its own panel can show the same states. `onPost` may now resolve to `false` to say the comment did not land, which keeps the draft.
- `useThreadComments(threadId)` is exported for a host that loads a thread for a panel of its own; pass `undefined` while the panel is closed and nothing is requested.
- `appendThreadComment` and `storeThread` are exported alongside `applyThreadEvent`, which now also folds a `comment_posted` event into the open thread.
- `usePostComment`'s `post` now resolves to whether the comment landed.

### Migration / Action Required

None. A `CommentThread` rendered without the new props behaves as before, with an empty comment list.
