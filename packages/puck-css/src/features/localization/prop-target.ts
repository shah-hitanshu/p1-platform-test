/**
 * Prop Addressing
 *
 * Authority, translatability, and change classification are all keyed by the
 * (slotId, propName) pair of a top-level prop on a component. Root props belong
 * to no component, so they key on `__root__`.
 */

/** The slot id root props are keyed by. */
export const ROOT_SLOT_ID = '__root__';

/** A prop, addressed the way the stored maps key it. */
export interface PropTarget {
  slotId: string;
  propName: string;
}

/**
 * The prop a fields-panel field acts on, or null when the field addresses no
 * prop the stored maps can key.
 *
 * Puck composes a field id as `${slotId}_${fieldType}_${propName}`, using the
 * literal `root` for a root prop, and appends `_${subName}` for each level below
 * the top-level prop — where `name` becomes a path (`meta.title`,
 * `items[0].title`). The maps key on the top-level prop, so a nested subfield
 * has no address of its own and its controls belong on the prop above it.
 */
export function resolvePropTarget(
  id: string | undefined,
  fieldType: string | undefined,
  name: string,
): PropTarget | null {
  if (!id) return null;
  if (name.includes('.') || name.includes('[')) return null;

  const suffix = `_${fieldType ?? ''}_${name}`;
  if (!id.endsWith(suffix)) return null;
  const slotId = id.slice(0, -suffix.length);
  if (!slotId) return null;

  return { slotId: slotId === 'root' ? ROOT_SLOT_ID : slotId, propName: name };
}
