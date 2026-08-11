# @pantheon-systems/p1-ai-chat

AI chat panel for the P1 Puck editor. Renders in the editor's inspector rail and can draft or
fill pages against the document currently open.

> Part of Pantheon's **P1** platform. It is published publicly so P1 applications can install
> it, but it requires the Pantheon-hosted chat agent Worker and is not a general-purpose chat
> component. Pre-1.0: minor versions may carry breaking changes.

## Install

```bash
npm install @pantheon-systems/p1-ai-chat
```

Peer dependencies:

```bash
npm install @pantheon-systems/puck-css @puckeditor/core react \
            @pantheon-systems/pds-toolkit-react
```

## Usage

```tsx
import { createAIChatPlugin } from "@pantheon-systems/p1-ai-chat";

const aiChatPlugin = createAIChatPlugin({
  agentUrl: process.env.NEXT_PUBLIC_AGENT_URL,
});
```

Pass the plugin to `useP1Editor` via `additionalPlugins`, and set `showAIPanelToggle: true` in
its `pluginOptions` to reveal the header button that opens the panel.

`createDraftRequestChannel` gives the host application a channel for asking the panel to draft
a page; when supplied as `draftRequests`, each request auto-submits against its target
document.

Conversation history is scoped per user and site by default. Override `getAgentId` to change
that scoping.
