---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The editor header's toggle is now labelled for Zappy, and takes the black-and-grey treatment of the header controls beside it, in place of blue.

### What Changed

- The assistant is called Zappy; the icon-only toggle that opens it announces as "Zappy AI Assistant", replacing "Pantheon AI".
- Its icon is black in both states — the colour the neighbouring external-link button already used — and drops from 20px to 16px, so it no longer fills the button edge to edge.
- Active, the button sits on a neutral grey chip under that black icon, in place of a filled blue square under a white one. The chip matches the hover surface, so an active toggle and a hovered one now look alike.

### Migration / Action Required

Update anything that selects the toggle by its old accessible name — `getByLabelText('Pantheon AI')`, `getByRole('button', { name: 'Pantheon AI' })` — to "Zappy AI Assistant". Its `data-testid="ai-panel-toggle"` and the `showAIPanelToggle` prop are unchanged.

Nothing else is required, unless you were overriding `--pds-color-interactive-background-current` to tint the toggle — it no longer reaches it. The toggle now reads `--pds-color-foreground-default` and `--pds-color-surface-default-secondary`, which also apply well beyond this button.
