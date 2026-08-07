---
"@pantheon-systems/puck-css": minor
---

The Create Page dialog's "Generate with AI" no longer creates a page before handing the brief over. It calls `onGenerateWithAI` with the brief plus the title and path that were typed, then closes, and the assistant creates the page once the page template is settled.

`onGenerateWithAI` no longer requires `onNavigate` alongside it, since the dialog no longer navigates. The tile still falls back to a placeholder when `onGenerateWithAI` is not passed.
