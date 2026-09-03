/**
 * Translatability Storage
 *
 * Per-prop translatability lives on the CANONICAL page snapshot at
 * root.props._localeTranslatable, shape { [slotId]: { [propName]: boolean } }.
 * Absence means translatable (true); only an explicit false is non-translatable.
 * The map applies to all languages, so it lives on the canonical document and is
 * edited as part of that document's content, travelling with the editor's own
 * saves rather than out of band.
 */

type Snapshot = Record<string, unknown>;
type TranslatableMap = Record<string, Record<string, boolean>>;

/** Read `root.props._localeTranslatable` from a snapshot, if present. */
function readMap(snapshot: Snapshot): TranslatableMap {
  const root = (snapshot.root ?? {}) as Record<string, unknown>;
  const props = (root.props ?? {}) as Record<string, unknown>;
  return (props._localeTranslatable as TranslatableMap) ?? {};
}

/**
 * Whether a prop is translatable. Defaults to true; false only when an explicit
 * false is stored for the (slotId, propName) pair.
 */
export function isPropTranslatable(map: unknown, slotId: string, propName: string): boolean {
  return (map as TranslatableMap | undefined)?.[slotId]?.[propName] !== false;
}

/**
 * Return a new snapshot with the prop's translatability set. A false is stored
 * explicitly; setting it back to true prunes the entry (and any emptied slot),
 * keeping the map minimal. The input snapshot is not mutated.
 */
export function applyTranslatable(
  snapshot: Snapshot,
  slotId: string,
  propName: string,
  translatable: boolean,
): Snapshot {
  const root = (snapshot.root ?? {}) as Record<string, unknown>;
  const props = (root.props ?? {}) as Record<string, unknown>;
  const map = readMap(snapshot);

  const currentSlot = map[slotId] ?? {};
  const nextSlot: Record<string, boolean> = translatable
    ? Object.fromEntries(Object.entries(currentSlot).filter(([key]) => key !== propName))
    : { ...currentSlot, [propName]: false };

  const nextMap: TranslatableMap = Object.fromEntries(
    Object.entries(map).filter(([key]) => key !== slotId),
  );
  if (Object.keys(nextSlot).length > 0) {
    nextMap[slotId] = nextSlot;
  }

  // An emptied map is removed rather than stored as `{}`, so returning every
  // prop to translatable leaves the document as it was found.
  const nextProps = { ...props };
  if (Object.keys(nextMap).length > 0) {
    nextProps._localeTranslatable = nextMap;
  } else {
    delete nextProps._localeTranslatable;
  }

  return { ...snapshot, root: { ...root, props: nextProps } };
}
