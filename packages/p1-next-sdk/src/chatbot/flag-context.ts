import type { AuthUser } from "@pantheon-systems/puck-css";

export interface FlagContext {
  kind: "user";
  key: string;
  email?: string;
  anonymous?: boolean;
}

/**
 * Build the LaunchDarkly evaluation context for the signed-in user.
 *
 * Keyed on the lowercased email because LaunchDarkly matches individual targets on
 * the key alone, and the rest of P1 identifies people to LaunchDarkly the same way.
 * Keying on anything else makes an email entered in the targeting UI match nothing,
 * with no error to say so.
 *
 * Falls back to the user id when email is absent, which AuthUser allows, so those
 * users stay individually targetable instead of sharing the anonymous context.
 */
export function buildFlagContext(user: AuthUser | null): FlagContext {
  if (!user) {
    return { kind: "user", key: "anonymous", anonymous: true };
  }

  const email = user.email?.trim();
  return {
    kind: "user",
    key: email ? email.toLowerCase() : user.id,
    ...(email && { email }),
  };
}
