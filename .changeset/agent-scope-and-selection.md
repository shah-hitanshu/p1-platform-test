---
"@pantheon-systems/p1-ai-chat": minor
---

**[Feature]** The AI panel now shows what the agent can read and which pages it may change, and you decide that second list (requires `@pantheon-systems/puck-css` 0.9.0 or later).

### What Changed

- A scope row under the panel header states that the agent reads the whole site, and lists the pages it may edit as removable chips with **+ Add page** beside them. It opens and collapses, and stays as you left it.
- The agent refuses to change a page that is not on the list, and says which pages it may edit instead. It can still create new pages anywhere on the site.
- The list follows the page you are on: opening a page adds it, and it drops off again when you move to another, while pages you added yourself stay.
- The agent can read any page on the site, so it can answer questions about a page you do not have open.
- The agent knows which block you have selected and calls it what the editor calls it.

### Migration / Action Required

- Upgrade `@pantheon-systems/puck-css` to 0.9.0 or later. Earlier versions do not export everything this package imports.
- Run an agent Worker built from this release or later. An older Worker ignores the list of editable pages; a newer Worker with an older client restricts the agent to the page you have open.
