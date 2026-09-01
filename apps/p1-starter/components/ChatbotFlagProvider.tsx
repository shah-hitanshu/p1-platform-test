"use client";

import React from "react";
import { LDProvider } from "launchdarkly-react-client-sdk";
import { useP1Auth } from "@pantheon-systems/puck-css";

import { buildFlagContext } from "../lib/chatbot-flag/flag-context";

/**
 * Wraps the editor with a LaunchDarkly client-side provider so the `p1-chatbot`
 * flag can be evaluated at runtime. The client-side ID is public by design.
 *
 * When NEXT_PUBLIC_LD_CLIENT_ID is unset (local dev / offline), LaunchDarkly is
 * not initialized and children render without a provider — `useFlags()` then
 * returns no flags, so the chatbot defaults to hidden.
 */
export function ChatbotFlagProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const clientSideID = process.env.NEXT_PUBLIC_LD_CLIENT_ID;
  const { user } = useP1Auth();

  if (!clientSideID) {
    return <>{children}</>;
  }

  // LaunchDarkly evaluates the flag for the context present at mount and does not
  // re-identify on context change. This provider mounts inside <P1App> (after
  // auth), so the authenticated user is available here; the anonymous fallback
  // only applies if it ever renders pre-auth.
  const context = buildFlagContext(user);

  return (
    <LDProvider
      clientSideID={clientSideID}
      context={context}
      reactOptions={{ useCamelCaseFlagKeys: false }}
    >
      {children}
    </LDProvider>
  );
}
