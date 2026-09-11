"use client";

import React from "react";
import { LDProvider } from "launchdarkly-react-client-sdk";
import { useP1Auth } from "@pantheon-systems/puck-css";

import { buildFlagContext } from "./flag-context";

// Pantheon's own client-side ID, shipped as the default so enabling the chatbot for a
// site is a flag change rather than an edit to that site's repository. Client-side IDs
// are browser-public by design and can only read flag values.
export const DEFAULT_CLIENT_SIDE_ID = "67e2bd97a0bc670d1d4fb736";

/**
 * Wraps the editor so the chatbot's rollout flag can be evaluated at runtime.
 *
 * Mount it inside `<P1App>`, above whatever calls {@link useP1Chatbot}, so the
 * authenticated user is available as the evaluation context.
 *
 * Nothing here is the application's to configure. `NEXT_PUBLIC_LD_CLIENT_ID` overrides
 * the built-in client-side ID, and an empty value opts out of rollout checks entirely.
 */
export function P1ChatbotProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // `??`, not `||`: an explicitly empty value is the opt-out, not a request for the default.
  const clientSideID = process.env.NEXT_PUBLIC_LD_CLIENT_ID ?? DEFAULT_CLIENT_SIDE_ID;
  const { user } = useP1Auth();

  if (!clientSideID) {
    return children;
  }

  // The flag is evaluated for the context present at mount and is not re-identified on
  // context change. Mounted after auth, so the authenticated user is available here; the
  // anonymous fallback only applies if it ever renders pre-auth.
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
