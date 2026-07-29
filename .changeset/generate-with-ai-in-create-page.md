---
"@pantheon-systems/p1-ai-chat": minor
---

Wire the agent into the "Generate with AI" option in the Create a New Page modal. The modal's brief is handed to the chat sidebar, which drafts the new page immediately instead of asking what to put on it.

New public surface for the host app to drive that flow: `DraftRequest` and `DraftRequestChannel` types, a `createDraftRequestChannel()` factory, an optional `draftRequests` on `AIChatPluginOptions`, and on `useAgentChat` both `sendMessage(text, { documentPath, newPage })` for programmatic turns and a `ready` flag for when the socket is usable. When `draftRequests` is supplied the panel subscribes and auto-submits each request against its target document. Omitting it leaves behavior unchanged.

`newPage` marks a turn as targeting a page that was just created empty for it, which changes the brief's contract: the user has already said what they want and named the page, so the agent drafts rather than opening with "which page would you like me to use?" on a brief as thin as "I want a pricing page". The flag is declared by whoever publishes the request rather than inferred, so a future caller aiming at an existing page does not silently inherit the behavior. It travels in the turn's context rather than appended to the brief, so the transcript still shows exactly what the user typed.

A page drafted this way also gets an SEO meta description. Nothing upstream has one to supply, and the agent is the only party that knows what the page ends up saying, so it writes the content first and the description second, from what it actually built, both inside the same edit session. Ordering it first would describe a page that does not exist yet, so a build that then fails or is stopped would leave a confidently wrong description behind.

Chat state now lives in a session store keyed by agent id rather than in component state, so a conversation and an in-progress streamed reply survive the panel remounting. Creating a page and navigating to it rebuilds the editor's plugin panels while the page hydrates, which previously cleared the chat mid-draft. Idle sessions are released shortly after their last viewer detaches, and history is still restored from the agent on reconnect.

A failed send now distinguishes an auth session that has not settled from a socket that could not connect, instead of reporting both as "Connection failed". The first is the likelier one right after a navigation, and reporting it as a network problem sent people looking in the wrong place.
