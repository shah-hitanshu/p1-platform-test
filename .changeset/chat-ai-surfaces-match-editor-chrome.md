---
"@pantheon-systems/p1-ai-chat": patch
---

**[Fix]** The chat panel is now Zappy, and its surfaces render in the editor's black-and-white palette instead of blue, so the panel no longer reads as a separate product sitting inside the editor chrome.

### What Changed

- The assistant is called Zappy: the panel title reads "Zappy" and the composer placeholder reads "Ask Zappy…".
- The title shows a plain 16px sparkle icon in the default foreground colour, in place of a 12px glyph inside a filled blue chip.
- A divider separates the title and description from the scope row beneath them.
- Your own messages sit in a neutral grey bubble with default-foreground text, in place of white text on blue. Bubble shape, alignment, and the assistant's unbubbled prose are unchanged.

### Migration / Action Required

Update anything that selects the panel by its old name — `getByText('Pantheon AI')` and the like — to "Zappy".

Nothing else is required, unless you were overriding `--pds-color-interactive-background-current` to tint the title chip or the message bubble — it no longer reaches either. They now read `--pds-color-foreground-default` and `--pds-color-surface-default-secondary`, which also apply well beyond the chat panel.
