# @pantheon-systems/p1-ai-chat

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
