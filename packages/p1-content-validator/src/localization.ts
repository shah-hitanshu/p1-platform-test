import type { Authority } from './types.js';
import { isPlainObject } from './guards.js';

/**
 * Localization resolvers — the single source of truth for two independent
 * properties of the localization model:
 *
 *  - `translatable`: whether a prop holds natural-language text a human would
 *    translate. A per-(slotId, propName) flag that defaults to true, stored once
 *    on the canonical page (it applies to every language variant) and resolved
 *    via `resolveTranslatable`.
 *  - `authority`: a property of the RELATIONSHIP between a translation and its
 *    canonical. The per-slot default is declared on the template's
 *    `_localeAuthority` map and resolved via `resolveSlotAuthority`.
 */

/** Every authority a slot or prop can carry. */
export const AUTHORITIES = ['canonical', 'locale'] as const;

/** The authority a slot falls back to when the template declares none. */
export const DEFAULT_AUTHORITY: Authority = 'canonical';

/** Whether a value is one of the two authorities. */
export function isAuthority(value: unknown): value is Authority {
  return AUTHORITIES.includes(value as Authority);
}

/**
 * Reads one of the localization config maps off a snapshot's `root.props`. Absent
 * maps and malformed snapshots read as an empty map, so a resolver's fallback is
 * the same whether the map is missing or the snapshot is not content-shaped.
 */
function localeConfigMap(snapshot: unknown, key: string): Record<string, unknown> {
  if (!isPlainObject(snapshot)) {
    return {};
  }
  const root = snapshot.root;
  if (!isPlainObject(root) || !isPlainObject(root.props)) {
    return {};
  }
  const map = root.props[key];
  return isPlainObject(map) ? map : {};
}

/**
 * Resolves whether a prop is translatable from the canonical page snapshot's
 * `root.props._localeTranslatable` map, keyed by slot id then prop name. The flag
 * applies to every language variant, so it lives on the canonical only. A prop is
 * translatable unless an entry is explicitly stored as `false`; absent entries,
 * absent maps, malformed snapshots, and non-boolean stored values all resolve to
 * true.
 */
export function resolveTranslatable(
  snapshot: unknown,
  slotId: string,
  propName: string,
): boolean {
  const slot = localeConfigMap(snapshot, '_localeTranslatable')[slotId];
  if (!isPlainObject(slot)) {
    return true;
  }
  return slot[propName] !== false;
}

/**
 * Resolves the per-slot authority default from a template snapshot's
 * `root.props._localeAuthority` map, keyed by slot id. Slots with no declared
 * authority, absent maps, malformed snapshots, and unrecognized stored values
 * all resolve to `canonical`.
 */
export function resolveSlotAuthority(templateSnapshot: unknown, slotId: string): Authority {
  const value = localeConfigMap(templateSnapshot, '_localeAuthority')[slotId];
  return isAuthority(value) ? value : DEFAULT_AUTHORITY;
}

/**
 * Resolves a template's whole `root.props._localeAuthority` map, keyed by slot id.
 * Slots storing an unrecognized value are omitted, so a slot present in the result
 * carries a declared authority and a slot absent from it falls back to
 * `DEFAULT_AUTHORITY`. Absent maps and malformed snapshots resolve to no slots.
 */
export function resolveSlotAuthorityMap(templateSnapshot: unknown): Record<string, Authority> {
  return Object.fromEntries(
    Object.entries(localeConfigMap(templateSnapshot, '_localeAuthority')).filter((entry): entry is [string, Authority] =>
      isAuthority(entry[1]),
    ),
  );
}
