import type { AuthUser } from "@pantheon-systems/puck-css";

import { p1UserFlagKey } from "../launchdarkly/user-key";

export interface FlagContext {
  kind: "user";
  key: string;
  email?: string;
  anonymous?: boolean;
}

/**
 * Build the LaunchDarkly evaluation context for the signed-in user.
 *
 * Keyed by {@link p1UserFlagKey}, so the chatbot's targeting agrees with every other
 * rollout check. A user with no key at all is pre-auth, and shares the anonymous
 * context rather than being targetable.
 */
export function buildFlagContext(user: AuthUser | null): FlagContext {
  const key = p1UserFlagKey(user);
  if (!key) {
    return { kind: "user", key: "anonymous", anonymous: true };
  }

  const email = user?.email?.trim();
  return {
    kind: "user",
    key,
    ...(email && { email }),
  };
}
