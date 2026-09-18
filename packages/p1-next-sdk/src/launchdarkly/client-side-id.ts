// Pantheon's own client-side ID, shipped as the default so enabling a feature for a
// site is a flag change rather than an edit to that site's repository. Client-side IDs
// are browser-public by design and can only read flag values.
export const DEFAULT_CLIENT_SIDE_ID = "67e2bd97a0bc670d1d4fb736";

/**
 * The client-side ID rollout checks evaluate against.
 *
 * `NEXT_PUBLIC_LD_CLIENT_ID` overrides the built-in default, and an explicitly empty
 * value opts out of rollout checks entirely — hence `??` rather than `||`, which would
 * read the opt-out as a request for the default.
 */
export function resolveClientSideId(): string {
  return process.env.NEXT_PUBLIC_LD_CLIENT_ID ?? DEFAULT_CLIENT_SIDE_ID;
}
