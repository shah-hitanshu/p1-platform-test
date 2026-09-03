# @pantheon-systems/p1-ai-chat

## 0.6.0

### Minor Changes

- 1a2c908: **[Feature]** The chat panel now takes files: drop, paste or pick a brief or an image and it goes to the agent with your next message.

  ### What Changed
  - Attach a file by dropping it anywhere on the panel, pasting it, or picking it with the button beside Send. Up to four files per turn.
  - A document's text goes to the agent as what you are asking for. `.md`, `.txt`, `.csv` and anything `text/*` are read directly, and an `.html` page is read as the text it says rather than as its markup.
  - An image goes to the agent for it to look at, so you can ask what is wrong with a layout or what a design does. PNG, JPEG, GIF, WebP or AVIF. Nothing is uploaded and no file is kept, so an attached image is not on your site and cannot be placed on a page — add it to the media library for that.
  - Attached files show above the message box as cards: an image as itself, a document by name and kind. Open one to see exactly what will go to the agent, or take it off before you send.
  - Anything else is refused on the composer with a sentence saying why, and the turn will not send until you deal with it, so a message never quietly goes without the file you attached. PDF and Word ask you to export to `.md` or paste the text in.
  - The transcript shows a turn's files as cards rather than pasting a brief in as though you had typed it. Only the names are kept, so reopening the conversation later shows what each turn carried without being able to open it again.
  - Attaching files needs an up-to-date chat agent behind your `agentUrl`. Against an older one the cards still appear, and the reply simply will not have been given them.
  - Where the agent runs a model that cannot be shown images, it tells you it has not seen the image and asks you to describe it, rather than describing something it was never given.

### Patch Changes

- 61cb80e: **[Fix]** Public package builds no longer ship internal Jira ticket references, expanded internal service names, or backend implementation details (storage engine, compute primitive, real hostnames) in comments, JSDoc, `package.json` descriptions, or READMEs.

  ### What Changed
  - `css-client`, `p1-next-sdk`, `puck-css`, `p1-ai-chat`, and `p1-content-validator` now build in two `tsc` passes — one declarations-only, one comment-stripped `.js` — so implementation comments no longer survive into the published `.js`. JSDoc on exported symbols (which intentionally survives, for consumers' IDE tooltips) was hand-edited to drop internal ticket refs and backend rationale.
  - `p1-media`'s esbuild sourcemaps no longer inline `sourcesContent`; they previously shipped the entire original TypeScript source, comments included, regardless of any `.js`/`.d.ts` cleanup.
  - `puck-css`'s `files` allowlist no longer includes the bare `src/pds/theme` directory, which was shipping a raw test file and a 200KB generated `.ts` source file alongside the intended theme CSS (already covered by the existing `src/**/*.css` entry).
  - `create-p1-starter-kit`'s scaffolded template (copied from `apps/p1-starter`) had the same class of ticket-ref comments cleaned, including its example CI workflow.
  - Package `description` fields and `README.md` files (which npm always publishes regardless of the `files` field) no longer name the internal "CCR"/"Collaborative Content Repository" service.
  - `puck-css`'s `[ccr-store]` log tag and an internal Puck remount key are renamed (`[p1-store]` / `p1-<role>`); neither is persisted or part of any public contract.
  - A new CI guardrail (`.github/scripts/check-npm-leaks.sh`, wired into PR CI's hard gates and into `publish.yml`) packs each public package the way `npm publish` would and fails the build if any of these terms reappear. It fails closed — an unreadable tarball or a glob-free `files` entry whose build output is missing is an error, never a pass — and carries a `--self-test` mode, run first in both workflows, that verifies detection against fixtures.

  No public API or runtime behavior change.

  ### Deliberately out of scope
  - The bare `CCR` service name is deliberately still present in published output — most visibly `puck-css`'s exported `PRODUCTION_BASE_URL` (`https://ccr.p1.pantheon.io`, also referenced in `apps/p1-starter/.env.example`), the live default hostname every unconfigured consumer's SDK talks to, and ~200 local `ccr` variable bindings from `useP1Puck()`. Naming a service is not the leak this fix is about: the guardrail bans the architecture behind it — the expanded "Collaborative Content Repository"/"Collaborative State System" forms, storage engine, CRDT, compute primitive, ticket refs, and `.workers.dev` hostnames. Renaming those bindings is optional cleanup, not a release blocker.

## 0.5.1

### Patch Changes

- a16d921: Set `license` to `UNLICENSED` to match the rest of the suite. These packages had drifted
  to `MIT` (or had no `license` field at all), but they are closed-source and were never
  intended to be published under an open-source license.

## 0.5.0

### Minor Changes

- a5880d4: **[Feature]** The AI panel now shows what the agent can read and which pages it may change, and you decide that second list (requires `@pantheon-systems/puck-css` 0.9.0 or later).

  ### What Changed
  - A scope row under the panel header states that the agent reads the whole site, and lists the pages it may edit as removable chips with **+ Add page** beside them. It opens and collapses, and stays as you left it.
  - The agent refuses to change a page that is not on the list, and says which pages it may edit instead. It can still create new pages anywhere on the site.
  - The list follows the page you are on: opening a page adds it, and it drops off again when you move to another, while pages you added yourself stay.
  - The agent can read any page on the site, so it can answer questions about a page you do not have open.
  - The agent knows which block you have selected and calls it what the editor calls it.

  ### Migration / Action Required
  - Upgrade `@pantheon-systems/puck-css` to 0.9.0 or later. Earlier versions do not export everything this package imports.
  - Run an agent Worker built from this release or later. An older Worker ignores the list of editable pages; a newer Worker with an older client restricts the agent to the page you have open.

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
