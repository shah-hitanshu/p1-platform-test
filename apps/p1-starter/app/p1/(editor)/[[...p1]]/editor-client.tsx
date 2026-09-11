"use client";

import { useMemo } from "react";
import {
  createP1EditorClient,
  type P1EditorContext,
  type P1EditorExtensions,
} from "@pantheon-systems/p1-next-sdk";
import { P1ChatbotProvider, useP1Chatbot } from "@pantheon-systems/p1-next-sdk/chatbot";
import { createMediaPlugin } from "@pantheon-systems/p1-media";
import type { Checkpoint } from "@pantheon-systems/puck-css";

import "@pantheon-systems/p1-next-sdk/editor.css";

import { P1SignInPage } from "../../../../components/p1-sign-in-page";
import config from "../../../../puck.config";
import { P1_ASSETS } from "../../../../constants/assets";

function useEditorExtensions({ openDocument }: P1EditorContext): P1EditorExtensions {
  const mediaPlugin = useMemo(() => createMediaPlugin({}), []);
  const chatbot = useP1Chatbot({ onPageCreated: openDocument });

  const plugins = useMemo(
    () => [mediaPlugin, ...chatbot.plugins],
    [mediaPlugin, chatbot.plugins],
  );

  return {
    plugins,
    pluginOptions: chatbot.pluginOptions,
    editorKeySuffix: chatbot.editorKeySuffix,
  };
}

export const EditorClientWrapper = createP1EditorClient({
  puckConfig: config,
  signInPage: <P1SignInPage />,
  wrapEditor: (editor) => <P1ChatbotProvider>{editor}</P1ChatbotProvider>,
  roleSwitcher: process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === "true",
  useExtensions: useEditorExtensions,
  pluginOptions: {
    logoUrl: P1_ASSETS.LOGO_URL,
  },
  overrideOptions: {
    onPublishSuccess: (checkpoint: Checkpoint) => {
      alert(`Published: ${checkpoint.name ?? checkpoint.id}`);
    },
    onPublishError: (err: Error) => {
      alert(`Publish failed: ${err.message}`);
    },
  },
});
