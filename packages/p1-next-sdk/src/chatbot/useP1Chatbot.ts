"use client";

import { useMemo } from "react";
import { useFlags } from "launchdarkly-react-client-sdk";
import { createAIChatPlugin } from "@pantheon-systems/p1-ai-chat";
import type { Plugin } from "@puckeditor/core";

import { createGenerateWithAIHandler } from "./ai-generate";
import { getDraftRequestChannel } from "./draft-request-channel";
import { CHATBOT_FLAG_KEY, shouldShowChatbot } from "./feature-gate";

export interface P1ChatbotOptions {
  /**
   * Called with the path of a page the chat created. Send the editor there: it is also
   * what keeps later turns aimed at the new page, whose context is built from whichever
   * document is open.
   */
  onPageCreated: (path: string) => void;
}

export interface P1Chatbot {
  /** Append to `useP1Editor`'s `additionalPlugins`. Empty when the chatbot is off. */
  plugins: Plugin[];
  /** Spread into `useP1Editor`'s `pluginOptions`. */
  pluginOptions: {
    onGenerateWithAI:
      | ((brief: string, page: { path: string; title?: string }) => void)
      | undefined;
    showAIPanelToggle: boolean;
  };
  /**
   * Append to the `key` given to `<Puck>`. Puck reads its plugin list once per mount, so
   * a chatbot that becomes available without the key changing would not appear until the
   * next navigation.
   */
  editorKeySuffix: string;
}

/**
 * Resolve whether the AI chatbot is available to this editor, and everything needed to
 * mount it. Call it under a {@link P1ChatbotProvider}.
 *
 * Availability is Pantheon's to decide, so an application wires the result through
 * without branching on it: an empty plugin list, an absent handler and an unchanged key
 * suffix are what "off" looks like.
 */
export function useP1Chatbot(options: P1ChatbotOptions): P1Chatbot {
  const { onPageCreated } = options;
  const flags = useFlags();
  const enabled = shouldShowChatbot(flags[CHATBOT_FLAG_KEY]);
  const draftRequests = getDraftRequestChannel();

  const plugins = useMemo(
    () =>
      enabled
        ? [
            createAIChatPlugin({
              agentUrl: process.env.NEXT_PUBLIC_AGENT_URL,
              draftRequests,
              onPageCreated,
            }),
          ]
        : [],
    [enabled, draftRequests, onPageCreated],
  );

  return useMemo(
    () => ({
      plugins,
      pluginOptions: {
        onGenerateWithAI: createGenerateWithAIHandler(draftRequests, enabled),
        showAIPanelToggle: enabled,
      },
      editorKeySuffix: enabled ? "-ai" : "-no-ai",
    }),
    [plugins, draftRequests, enabled],
  );
}
