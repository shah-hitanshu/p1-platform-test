---
"@pantheon-systems/p1-ai-chat": minor
---

The chat panel now opens in the right-hand inspector rail instead of Puck's left plugin rail. There is no longer an "AI Builder" rail entry — open it from the Pantheon AI button in the editor header, which `@pantheon-systems/puck-css` renders when you pass `showAIPanelToggle`.

Chat history is now one conversation per user per site rather than one per page, so it follows the user between pages and branches and a single session can build several pages. Each turn still carries its own site, branch and document, which is what the assistant acts on.

`createAIChatPlugin` now contributes a `fields` override rather than a rail panel. While the panel is closed, the override renders your inspector untouched.
