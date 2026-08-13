# @pantheon-systems/p1-ai-chat

## 0.4.1

### Patch Changes

- 74dda98: Adds a README to every published package. Each one rendered a blank page on npmjs.com, because
  no `README.md` existed in the package directory to be included in the tarball — npm renders the
  README from the published tarball, not from the source repository, so a private repo was never
  the cause.

  Also repoints every `repository` URL at `pantheon-systems/p1-platform` with the correct
  `directory`. They still referenced the pre-merge repositories (`puck-css-integration`,
  `collaborative-state-system`, `p1-media-r2`), so the "Repository" link on each npm page went
  nowhere. Adds a matching `homepage` for each package.

  No runtime code changes.

## 0.4.0

### Minor Changes

- 0077a4b: The chat panel now opens in the right-hand inspector rail instead of Puck's left plugin rail. There is no longer an "AI Builder" rail entry — open it from the Pantheon AI button in the editor header, which `@pantheon-systems/puck-css` renders when you pass `showAIPanelToggle`.

  Chat history is now one conversation per user per site rather than one per page, so it follows the user between pages and branches and a single session can build several pages. Each turn still carries its own site, branch and document, which is what the assistant acts on.

  `createAIChatPlugin` now contributes a `fields` override rather than a rail panel. While the panel is closed, the override renders your inspector untouched.

- d04d399: "Generate with AI" now starts a page from the page template that fits the brief, instead of always from a blank canvas. The assistant proposes a template, says why, and creates the page once the user agrees — so they can pick a different one, or ask for a blank page, before anything exists. A template can only be set as a page is created, which is why it is confirmed first. On a site with no templates, the assistant says so and offers a blank page.

  Asking for a new page directly in the chat works the same way. On a page that already follows a template, the assistant now fills the template's components in rather than replacing them, so the page keeps conforming.

  A brief handed over by the Create page dialog is labelled in the transcript with the page it asked for — **New page**, its title and its path — so it reads as a request rather than as something the user typed into the chat. Until the page is created, that label is the only place the title and path appear.

  Three API changes:

  - `DraftRequest` is a discriminated union on `kind` — `'fill-page'` for the existing "draft into this page" request, and `'create-page'` for a page that does not exist yet, carrying the title and path to create it at. Code that publishes draft requests should set `kind`; a request without one is still delivered as `'fill-page'`.
  - `createAIChatPlugin` accepts an `onPageCreated` callback, called with the path of a page the assistant has created. Wire it to your editor's navigation: each turn is built from whichever document the editor has open, so a conversation that stays on the old page will keep aiming later turns at it.
  - `SendMessageOptions.origin` marks a turn as seeded rather than typed, and surfaces as `ChatMessage.origin` on the turn it produced; the `MessageOrigin` type is exported for reading it. It is deliberately not persisted, so the label lasts for the session rather than reappearing in replayed history.

  Requires a chat agent deployment that supports page templates.

## 0.3.0

### Minor Changes

- 2ebb9af: Make the chat panel reliable and interruptible.

  **Stop a turn that's in progress.** While the agent is working, Send becomes Stop. Pressing it ends the turn straight away: the agent stops the model, skips any steps it hadn't started, and closes the page it had open for editing.

  **Replies stream as they're written.** Text appears as the model produces it, and each step the agent takes appears as it begins, rather than everything arriving at once when the turn ends. A spinner runs through the pauses in between, so a turn that is thinking no longer looks like one that has died.

  **See what the agent did, in the order it did it.** Prose and steps interleave the way they happened — "I'll read the page", then the step, then "that page is empty" — and a step stays where it was made instead of jumping to a summary once it finishes. Each step is named in plain language ("Applying changes · 3 edits") and shows its own outcome, with the underlying error kept behind a disclosure when one fails.

  **Replies render as formatted markdown.** Tables, task lists, strikethrough and bare links now display properly, where a table previously arrived as rows of literal pipes. Tables are sized to the panel with wrapping cells rather than needing to be scrolled row by row. Markdown that is still being written renders as what it will become, instead of flashing raw syntax as it arrives.

  **The panel no longer gets stuck.** Clearing the conversation mid-reply, a dropped connection, an agent that went quiet, and pressing Stop while signing in each used to leave the composer disabled. Connections now retry on their own, and a turn that fails offers "Try again", which replaces the failed exchange rather than stacking a second copy beneath it.

  **Conversations are kept.** Every turn after the first was being discarded once a conversation had been cleared, and a single page edit could push everything else out of storage — so reopening the panel showed one stale exchange no matter how much had been said. History is now retained, and a reopened conversation reads in the order it happened.

  **Accessibility.** The transcript is ordinary navigable content rather than a live region that read the entire conversation aloud on every streamed word; announcements now come from a single status line. Each turn names its speaker, which alignment alone never conveyed.

  **A more compact composer.** Send shares a row with the keyboard hint instead of taking one of its own, returning space to the transcript in a panel that has little to spare.

## 0.2.0

### Minor Changes

- 401ad1a: Wire the agent into the "Generate with AI" option in the Create a New Page modal. The modal's brief is handed to the chat sidebar, which drafts the new page immediately instead of asking what to put on it.

  New public surface for the host app to drive that flow: `DraftRequest` and `DraftRequestChannel` types, a `createDraftRequestChannel()` factory, an optional `draftRequests` on `AIChatPluginOptions`, and on `useAgentChat` both `sendMessage(text, { documentPath, newPage })` for programmatic turns and a `ready` flag for when the socket is usable. When `draftRequests` is supplied the panel subscribes and auto-submits each request against its target document. Omitting it leaves behavior unchanged.

  `newPage` marks a turn as targeting a page that was just created empty for it, which changes the brief's contract: the user has already said what they want and named the page, so the agent drafts rather than opening with "which page would you like me to use?" on a brief as thin as "I want a pricing page". The flag is declared by whoever publishes the request rather than inferred, so a future caller aiming at an existing page does not silently inherit the behavior. It travels in the turn's context rather than appended to the brief, so the transcript still shows exactly what the user typed.

  A page drafted this way also gets an SEO meta description. Nothing upstream has one to supply, and the agent is the only party that knows what the page ends up saying, so it writes the content first and the description second, from what it actually built, both inside the same edit session. Ordering it first would describe a page that does not exist yet, so a build that then fails or is stopped would leave a confidently wrong description behind.

  Chat state now lives in a session store keyed by agent id rather than in component state, so a conversation and an in-progress streamed reply survive the panel remounting. Creating a page and navigating to it rebuilds the editor's plugin panels while the page hydrates, which previously cleared the chat mid-draft. Idle sessions are released shortly after their last viewer detaches, and history is still restored from the agent on reconnect.

  A failed send now distinguishes an auth session that has not settled from a socket that could not connect, instead of reporting both as "Connection failed". The first is the likelier one right after a navigation, and reporting it as a network problem sent people looking in the wrong place.

## 0.1.2

### Patch Changes

- 9406365: fix(PCC-3399): align exported plugin type with @puckeditor/core's real `Plugin`

  `createAIChatPlugin()` and the exported `PuckPlugin` type now reuse `@puckeditor/core`'s `Plugin` type directly instead of a hand-maintained local interface that declared an invalid `mobilePanelHeight: 'full'` value (the real union is `'toggle' | 'min-content'`). This lets consuming apps drop the `as`-cast workaround when merging the plugin into Puck's `additionalPlugins`, and prevents future drift from the upstream type.

## 0.1.1

### Patch Changes

- e13ebba: Add automated release workflow using changesets. Merging changesets to `main`
  now opens a "Version Packages" PR; merging that PR publishes to npm via OIDC
  trusted publishing.
- 9494997: Widen the pds-toolkit-react peer range to >=2.0.0-alpha.0 and migrate the plugin
  to the alpha.43 Icon/Badge API (iconSize->size, gaia->success), so the plugin
  installs cleanly in workspaces on newer PDS alphas.
