/** The fields of a P1 user that decide how LaunchDarkly targets them. */
export interface FlagTargetUser {
  id: string;
  email?: string;
}

/**
 * The key LaunchDarkly identifies a person by.
 *
 * The lowercased email, because LaunchDarkly matches individual targets on the key
 * alone and the rest of P1 identifies people to LaunchDarkly the same way. Keying on
 * anything else makes an email entered in the targeting UI match nothing, with no error
 * to say so.
 *
 * Falls back to the user id when email is absent, which a P1 user allows, so those
 * people stay individually targetable.
 */
export function p1UserFlagKey(user: FlagTargetUser | null | undefined): string | null {
  if (!user) {
    return null;
  }

  const email = user.email?.trim();
  return email ? email.toLowerCase() : user.id;
}
