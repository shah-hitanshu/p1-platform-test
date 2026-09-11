---
"@pantheon-systems/p1-next-sdk": minor
---

**[Feature]** The AI chatbot's rollout gate now lives in the SDK, behind a new
`@pantheon-systems/p1-next-sdk/chatbot` entry point, so an application no longer carries
feature-flag plumbing for it (`p1-migrate` applies the rewrite only to projects whose
installed P1 suite is at this version or newer).

### What Changed

- `P1ChatbotProvider` and `useP1Chatbot` replace the flag provider, flag key and gating
  helpers that starter projects used to keep in their own source. Whether the chatbot is
  available to a site is Pantheon's decision, so there is nothing left to branch on: an
  unavailable chatbot contributes no plugins, no `onGenerateWithAI` handler and an
  unchanged `<Puck>` remount key.
- Retiring the rollout no longer requires a change to your project.
- `p1-migrate` applies this rewrite to `editor-client.tsx` as part of the editor-layout
  migration, and bails rather than half-rewriting a file whose chatbot wiring you
  customized. Its output imports the new entry point, so on an older installed suite it
  says so and skips this one step, leaving your app-level gate in place and the rest of
  the migration unchanged.
- Nothing to configure, and nothing new to opt out of: an editor that has not been given
  an agent evaluates no rollout flag and initializes no rollout client.

### Migration / Action Required

Only if your project carries the old app-level gate. Run `npx @pantheon-systems/p1-next-sdk p1-migrate`,
or apply it by hand:

**Before**

```tsx
import { useFlags } from "launchdarkly-react-client-sdk";
import { ChatbotFlagProvider } from "../../../../components/ChatbotFlagProvider";
import { shouldShowChatbot, CHATBOT_FLAG_KEY } from "../../../../lib/chatbot-flag/feature-gate";

const chatbotEnabled = shouldShowChatbot(useFlags()[CHATBOT_FLAG_KEY], agentUrl);
```

**After**

```tsx
import { P1ChatbotProvider, useP1Chatbot } from "@pantheon-systems/p1-next-sdk/chatbot";

const chatbot = useP1Chatbot({ onPageCreated: handlePageCreated });
```

On `createP1EditorClient`, return that result from the `useExtensions` slot and pass
`wrapEditor: (editor) => <P1ChatbotProvider>{editor}</P1ChatbotProvider>`.

Then delete `lib/chatbot-flag/`, `components/ChatbotFlagProvider.tsx`, and the
`launchdarkly-react-client-sdk` and `@pantheon-systems/p1-ai-chat` entries in your
`package.json` — the codemod leaves those for you rather than deleting files it was not
asked to move.
