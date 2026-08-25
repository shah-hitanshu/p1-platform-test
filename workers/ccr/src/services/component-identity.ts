import { createHash } from 'node:crypto';

/**
 * Walks a document snapshot's components and manages their identity.
 *
 * Every component carries an id at `props.id` in `Type-uuid` form, and the
 * backend keys migration, pinning, and conformance on it. This module is the
 * single shared walker over a snapshot's `content[]` and `zones[*][]` arrays,
 * used to extract, mint, dedupe, and re-mint those ids.
 *
 * @see PROPOSAL-015 Design 1, 3, 8
 */

/**
 * A component instance as stored in a document snapshot.
 */
export interface DocumentComponent {
  type: string;
  props: Record<string, unknown>;
}

/**
 * A component found while walking a snapshot, tagged with where it lives.
 * `zoneKey` is present only when `location` is `'zone'`.
 */
export interface ComponentRef {
  component: DocumentComponent;
  location: 'content' | 'zone';
  index: number;
  zoneKey?: string;
}

interface RemintedComponentId {
  type: string;
  previousId: string;
  newId: string;
}

interface DedupeComponentIdsResult {
  snapshot: unknown;
  reminted: RemintedComponentId[];
}

function isComponent(value: unknown): value is DocumentComponent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { type, props } = value as { type?: unknown; props?: unknown };
  return (
    typeof type === 'string' &&
    typeof props === 'object' &&
    props !== null &&
    !Array.isArray(props)
  );
}

/**
 * Walks a snapshot's `content[]` first, then each `zones[*][]` in
 * `Object.keys` insertion order. Non-component entries are skipped.
 */
export function walkComponents(snapshot: unknown): ComponentRef[] {
  const refs: ComponentRef[] = [];
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return refs;
  }

  const { content, zones } = snapshot as { content?: unknown; zones?: unknown };

  if (Array.isArray(content)) {
    content.forEach((entry, index) => {
      if (isComponent(entry)) {
        refs.push({ component: entry, location: 'content', index });
      }
    });
  }

  if (typeof zones === 'object' && zones !== null && !Array.isArray(zones)) {
    for (const [zoneKey, zoneEntries] of Object.entries(zones as Record<string, unknown>)) {
      if (!Array.isArray(zoneEntries)) {
        continue;
      }
      zoneEntries.forEach((entry, index) => {
        if (isComponent(entry)) {
          refs.push({ component: entry, location: 'zone', zoneKey, index });
        }
      });
    }
  }

  return refs;
}

/**
 * Returns every `props.id` found while walking a snapshot, in walk order,
 * including duplicates.
 */
export function extractComponentIds(snapshot: unknown): string[] {
  const ids: string[] = [];
  for (const ref of walkComponents(snapshot)) {
    const id = ref.component.props.id;
    if (typeof id === 'string') {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Mints a component id in `Type-uuid` format.
 */
export function mintComponentId(type: string): string {
  return `${type}-${crypto.randomUUID()}`;
}

/**
 * Same duplicate in the same snapshot always heals to the same id, so
 * repeated flushes of an unhealed document converge instead of churning.
 */
function deriveStableReplacementId(type: string, previousId: string, duplicateOrdinal: number): string {
  const seed = `${previousId} ${type} ${String(duplicateOrdinal)}`;
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  const uuidShaped = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
  return `${type}-${uuidShaped}`;
}

/**
 * Keeps the first occurrence of each `props.id` and re-mints every later
 * duplicate from its own component type. Returns the same snapshot
 * reference when there are no duplicates; otherwise returns a deep clone
 * with the duplicates re-minted, leaving the input untouched.
 */
export function dedupeComponentIds(snapshot: unknown): DedupeComponentIdsResult {
  const refs = walkComponents(snapshot);
  const seenIds = new Set<string>();
  const duplicateOrdinals = new Map<number, number>();
  const duplicateCounts = new Map<string, number>();

  refs.forEach((ref, index) => {
    const id = ref.component.props.id;
    if (typeof id !== 'string') {
      return;
    }
    if (seenIds.has(id)) {
      const ordinal = duplicateCounts.get(id) ?? 0;
      duplicateOrdinals.set(index, ordinal);
      duplicateCounts.set(id, ordinal + 1);
    } else {
      seenIds.add(id);
    }
  });

  if (duplicateOrdinals.size === 0) {
    return { snapshot, reminted: [] };
  }

  const clonedSnapshot = structuredClone(snapshot);
  const clonedRefs = walkComponents(clonedSnapshot);
  const reminted: RemintedComponentId[] = [];

  for (const [index, duplicateOrdinal] of duplicateOrdinals) {
    const ref = clonedRefs[index];
    if (!ref) {
      continue;
    }
    const previousId = ref.component.props.id as string;
    const newId = deriveStableReplacementId(ref.component.type, previousId, duplicateOrdinal);
    ref.component.props.id = newId;
    reminted.push({ type: ref.component.type, previousId, newId });
  }

  return { snapshot: clonedSnapshot, reminted };
}

/**
 * Deep-clones a value and mints a fresh `props.id` for every component in
 * it, recursing into arrays, plain objects, and component props (so a
 * component nested in another component's props is re-minted).
 * Non-component values pass through unchanged.
 */
export function remintComponentIdsInValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => remintComponentIdsInValue(entry));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (isComponent(value)) {
    const props = remintComponentIdsInValue(value.props) as Record<string, unknown>;
    return {
      ...value,
      props: { ...props, id: mintComponentId(value.type) },
    };
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = remintComponentIdsInValue(entry);
  }
  return result;
}
