---
"@pantheon-systems/puck-css": minor
---

**[Feature]** A comment trigger on every block, as the first piece of commenting in the editor. It is off unless Pantheon has enabled threads for the site, and while off nothing about the editor changes.

### What Changed

- With threads enabled, hovering or selecting a block shows a comment button pinned to the block's top right corner. A block with no thread shows a quiet button; a block with comments shows the count as a tally. Clicking it opens a placeholder panel beside the block, with a caret pointing back at the button that opened it — the thread itself lands in a later release.
- The trigger belongs to the block it is drawn on, so hovering one block while another is selected gives each its own trigger for its own block, and it stays a readable size however far the canvas is zoomed out.
- Only one thread is open at a time: opening a second closes the first, so two panels never sit on the canvas at once.
- An open thread keeps its block hovered, so the panel stays put and stays anchored once the pointer moves off to read it.
- An open panel is drawn over every block's overlay, so it stays readable where it reaches past its own block.
- Hovering the trigger keeps the block hovered, so the block's outline and the trigger hold steady instead of flickering while the pointer is on it.
- Block hover and drag behaviour are unchanged, and so is the block action bar.
- `BlockCommentTrigger` is exported for placing the same trigger on a block from a `componentOverlay` override of your own — pass the block's `componentId` as `blockId`.
- `CommentTrigger` is exported for placing a trigger on something other than a block: pass the `contextType` and `contextId` of the thing being discussed, optionally a `threadId` and `commentCount`, and an `onOpen` callback to render your own panel instead of the placeholder. `onOpenChange` reports the built-in panel opening and closing — including it being closed by another thread opening — for a host that has to keep the trigger on screen while it is up.
- `useP1Overrides` takes a `threadsEnabled` option, defaulting to off.

### Migration / Action Required

None. An application passing its own `componentOverlay` override to Puck will replace the one `createP1Overrides` installs, and the comment trigger will not appear.
