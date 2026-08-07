---
"@pantheon-systems/p1-ai-chat": minor
---

"Generate with AI" now starts a page from the page template that fits the brief, instead of always from a blank canvas. The assistant proposes a template, says why, and creates the page once the user agrees — so they can pick a different one, or ask for a blank page, before anything exists. A template can only be set as a page is created, which is why it is confirmed first. On a site with no templates, the assistant says so and offers a blank page.

Asking for a new page directly in the chat works the same way. On a page that already follows a template, the assistant now fills the template's components in rather than replacing them, so the page keeps conforming.

A brief handed over by the Create page dialog is labelled in the transcript with the page it asked for — **New page**, its title and its path — so it reads as a request rather than as something the user typed into the chat. Until the page is created, that label is the only place the title and path appear.

Three API changes:

- `DraftRequest` is a discriminated union on `kind` — `'fill-page'` for the existing "draft into this page" request, and `'create-page'` for a page that does not exist yet, carrying the title and path to create it at. Code that publishes draft requests should set `kind`; a request without one is still delivered as `'fill-page'`.
- `createAIChatPlugin` accepts an `onPageCreated` callback, called with the path of a page the assistant has created. Wire it to your editor's navigation: each turn is built from whichever document the editor has open, so a conversation that stays on the old page will keep aiming later turns at it.
- `SendMessageOptions.origin` marks a turn as seeded rather than typed, and surfaces as `ChatMessage.origin` on the turn it produced; the `MessageOrigin` type is exported for reading it. It is deliberately not persisted, so the label lasts for the session rather than reappearing in replayed history.

Requires a chat agent deployment that supports page templates.
