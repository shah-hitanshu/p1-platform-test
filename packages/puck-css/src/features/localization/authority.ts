/**
 * Prop Authority Resolution
 *
 * A prop on a translation is either inherited from the canonical page
 * ('canonical') or owned by the translation ('locale'). That answer comes from
 * three places, in precedence order: the prop's own override, the default its
 * slot's template declares, and a site-wide fallback. The server resolves the
 * same chain when it judges a write, so a client that stops at the override map
 * shows an authority the server disagrees with.
 */

import type { AuthorityOverridesResult, PropAuthority } from '@pantheon-systems/css-client';

/**
 * Slot ids and prop names are author-chosen keys read out of parsed JSON, so a
 * lookup can surface an `Object.prototype` member ('constructor', 'toString')
 * instead of missing. Only the two authority strings count as an answer.
 */
function isAuthority(value: unknown): value is PropAuthority {
  return value === 'canonical' || value === 'locale';
}

/**
 * The authority a slot's props take when no override names them.
 */
export function slotAuthority(
  result: AuthorityOverridesResult | null,
  slotId: string,
): PropAuthority {
  const declared = result?.slotDefaults?.[slotId];
  if (isAuthority(declared)) return declared;
  return isAuthority(result?.defaultAuthority) ? result.defaultAuthority : 'canonical';
}

/**
 * The effective authority of a single prop.
 */
export function resolveAuthority(
  result: AuthorityOverridesResult | null,
  slotId: string,
  propName: string,
): PropAuthority {
  const override = result?.authorityOverrides?.[slotId]?.[propName];
  return isAuthority(override) ? override : slotAuthority(result, slotId);
}

/**
 * Whether moving a prop to `target` needs an override stored, or is reached by
 * dropping the one it has. Storing an override that repeats the slot default
 * would survive a later change to that default and silently pin the prop.
 */
export function needsOverride(
  result: AuthorityOverridesResult | null,
  slotId: string,
  target: PropAuthority,
): boolean {
  return slotAuthority(result, slotId) !== target;
}
