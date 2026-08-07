---
"@pantheon-systems/puck-css": minor
---

Adds a **Pantheon AI** button to the editor header. It opens the AI chat panel in the right-hand inspector rail, in place of the Page and Blocks tabs, and reveals the rail if it was collapsed.

Enable it with `showAIPanelToggle` on `useP1Editor`'s `pluginOptions`; it is hidden by default. The panel itself comes from `@pantheon-systems/p1-ai-chat`.

New exports: `useAIPanelOpen()` reads whether the panel is open, and `aiPanelStore` opens, closes or toggles it.
