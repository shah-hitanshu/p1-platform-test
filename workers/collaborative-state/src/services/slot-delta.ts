/**
 * Slot-id-keyed template deltas.
 *
 * A slot delta is an id-keyed diff of two template snapshots: components
 * added (carried with their full props), removed, and moved, each placed by
 * its destination list and the slot ids that precede it there. Applying a
 * delta to a document matches components by slot id, so document-local
 * components keep their position and anchors degrade to the nearest
 * preceding surviving slot.
 *
 * @see PROPOSAL-015 Design 5, 8
 */

import { walkComponents, type DocumentComponent } from './component-identity';

/**
 * A component's destination list. `null` is the top-level `content[]`; any
 * other value is a `zones` key.
 */
export type SlotZone = string | null;

/**
 * Where a component sits in a list. `precedingIds` are the slot ids that come
 * before it in that list in the target snapshot, nearest first.
 */
export interface SlotPlacement {
  zone: SlotZone;
  precedingIds: string[];
}

/**
 * A component that exists in `to` but not `from`, carried with a deep copy of
 * its full props and its placement in the target.
 */
export interface SlotAdd {
  component: DocumentComponent;
  placement: SlotPlacement;
}

/**
 * A slot id that survives from `from` to `to` but whose list or position
 * within a list changed, with its placement in the target.
 */
export interface SlotMove {
  id: string;
  placement: SlotPlacement;
}

/**
 * An id-keyed diff of two template snapshots. `templateIds` is the union of
 * slot ids present in either snapshot.
 */
export interface SlotDelta {
  added: SlotAdd[];
  removed: string[];
  moved: SlotMove[];
  templateIds: string[];
}

/**
 * A snapshot indexed by slot id: the component instance, its list, and each
 * list's ordered slot ids. Only components with a string `props.id` appear,
 * and the first occurrence of a repeated id wins.
 */
interface IndexedSnapshot {
  componentById: Map<string, DocumentComponent>;
  zoneById: Map<string, SlotZone>;
  lists: Map<SlotZone, string[]>;
}

function slotId(component: DocumentComponent): string | undefined {
  const id = component.props.id;
  return typeof id === 'string' ? id : undefined;
}

function indexSnapshot(snapshot: unknown): IndexedSnapshot {
  const componentById = new Map<string, DocumentComponent>();
  const zoneById = new Map<string, SlotZone>();
  const lists = new Map<SlotZone, string[]>();

  for (const ref of walkComponents(snapshot)) {
    const id = slotId(ref.component);
    if (id === undefined || componentById.has(id)) {
      continue;
    }
    const zone: SlotZone = ref.location === 'content' ? null : ref.zoneKey ?? null;
    componentById.set(id, ref.component);
    zoneById.set(id, zone);
    const list = lists.get(zone);
    if (list) {
      list.push(id);
    } else {
      lists.set(zone, [id]);
    }
  }

  return { componentById, zoneById, lists };
}

/**
 * Indices into `seq` of one longest strictly-increasing subsequence, in
 * increasing order.
 */
function longestIncreasingSubsequence(seq: number[]): number[] {
  const tails: number[] = [];
  const predecessor: number[] = seq.map(() => -1);

  for (const [i, value] of seq.entries()) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const tailIndex = tails[mid];
      const tailValue = tailIndex === undefined ? value : seq[tailIndex];
      if (tailValue !== undefined && tailValue < value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const prior = lo > 0 ? tails[lo - 1] : undefined;
    if (prior !== undefined) {
      predecessor[i] = prior;
    }
    if (lo === tails.length) {
      tails.push(i);
    } else {
      tails[lo] = i;
    }
  }

  const result: number[] = [];
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cursor !== undefined && cursor !== -1) {
    result.push(cursor);
    cursor = predecessor[cursor];
  }
  return result.reverse();
}

/**
 * Slot ids that keep their relative order within a list and so are not moves.
 * Candidates are the shared ids that stay in the same list; the longest
 * increasing subsequence of their source positions, taken in target order,
 * is stationary and the rest move.
 */
function stationaryIds(from: IndexedSnapshot, to: IndexedSnapshot): Set<string> {
  const stationary = new Set<string>();

  for (const [zone, targetList] of to.lists) {
    const sourceList = from.lists.get(zone) ?? [];
    const sourcePosition = new Map<string, number>();
    sourceList.forEach((id, position) => sourcePosition.set(id, position));

    const candidates = targetList.filter(
      (id) => from.componentById.has(id) && from.zoneById.get(id) === zone,
    );
    const sequence = candidates.map((id) => sourcePosition.get(id) ?? -1);
    for (const index of longestIncreasingSubsequence(sequence)) {
      const id = candidates[index];
      if (id !== undefined) {
        stationary.add(id);
      }
    }
  }

  return stationary;
}

function placementOf(id: string, to: IndexedSnapshot): SlotPlacement {
  const zone = to.zoneById.get(id) ?? null;
  const list = to.lists.get(zone) ?? [];
  const position = list.indexOf(id);
  const precedingIds = list.slice(0, position).reverse();
  return { zone, precedingIds };
}

/**
 * Diffs two template snapshots by slot id. Components without a string
 * `props.id` are invisible: they never appear in the delta. A survivor is a
 * move only when its list changed or it must be repositioned relative to the
 * other ids its list shares with the source version.
 */
export function buildSlotDelta(from: unknown, to: unknown): SlotDelta {
  const fromIndex = indexSnapshot(from);
  const toIndex = indexSnapshot(to);
  const stationary = stationaryIds(fromIndex, toIndex);

  const added: SlotAdd[] = [];
  const moved: SlotMove[] = [];
  const removed: string[] = [];

  for (const [id, component] of toIndex.componentById) {
    if (!fromIndex.componentById.has(id)) {
      added.push({ component: structuredClone(component), placement: placementOf(id, toIndex) });
      continue;
    }
    const listChanged = fromIndex.zoneById.get(id) !== toIndex.zoneById.get(id);
    if (listChanged || !stationary.has(id)) {
      moved.push({ id, placement: placementOf(id, toIndex) });
    }
  }

  for (const id of fromIndex.componentById.keys()) {
    if (!toIndex.componentById.has(id)) {
      removed.push(id);
    }
  }

  const templateIds: string[] = [...fromIndex.componentById.keys()];
  const seen = new Set(templateIds);
  for (const id of toIndex.componentById.keys()) {
    if (!seen.has(id)) {
      seen.add(id);
      templateIds.push(id);
    }
  }

  return { added, removed, moved, templateIds };
}

function entryId(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return undefined;
  }
  const props = (entry as { props?: unknown }).props;
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return undefined;
  }
  const id = (props as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function isTemplateSlot(entry: unknown, templateIds: Set<string>): boolean {
  const id = entryId(entry);
  return id !== undefined && templateIds.has(id);
}

function ensureList(snapshot: Record<string, unknown>, zone: SlotZone): unknown[] {
  if (zone === null) {
    if (!Array.isArray(snapshot.content)) {
      snapshot.content = [];
    }
    return snapshot.content as unknown[];
  }
  let zones = snapshot.zones;
  if (typeof zones !== 'object' || zones === null || Array.isArray(zones)) {
    zones = {};
    snapshot.zones = zones;
  }
  const zoneMap = zones as Record<string, unknown>;
  if (!Array.isArray(zoneMap[zone])) {
    zoneMap[zone] = [];
  }
  return zoneMap[zone] as unknown[];
}

/**
 * Inserts `entry` after the nearest resolvable anchor in its destination list,
 * skipping past any immediately following non-template components so document
 * -local components stay beside their anchor. With no resolvable anchor the
 * entry lands at the head, after any leading run of non-template components.
 */
function insertPlaced(
  snapshot: Record<string, unknown>,
  placement: SlotPlacement,
  entry: unknown,
  templateIds: Set<string>,
): void {
  const list = ensureList(snapshot, placement.zone);

  let position = 0;
  for (const anchorId of placement.precedingIds) {
    const anchorIndex = list.findIndex((candidate) => entryId(candidate) === anchorId);
    if (anchorIndex !== -1) {
      position = anchorIndex + 1;
      break;
    }
  }

  while (position < list.length && !isTemplateSlot(list[position], templateIds)) {
    position++;
  }
  list.splice(position, 0, entry);
}

function documentHasId(snapshot: Record<string, unknown>, id: string): boolean {
  if (Array.isArray(snapshot.content)) {
    if ((snapshot.content as unknown[]).some((entry) => entryId(entry) === id)) {
      return true;
    }
  }
  const zones = snapshot.zones;
  if (typeof zones === 'object' && zones !== null && !Array.isArray(zones)) {
    for (const entries of Object.values(zones as Record<string, unknown>)) {
      if (Array.isArray(entries) && entries.some((entry) => entryId(entry) === id)) {
        return true;
      }
    }
  }
  return false;
}

function removeById(snapshot: Record<string, unknown>, id: string): unknown {
  if (Array.isArray(snapshot.content)) {
    const list = snapshot.content as unknown[];
    const index = list.findIndex((entry) => entryId(entry) === id);
    if (index !== -1) {
      return list.splice(index, 1)[0];
    }
  }
  const zones = snapshot.zones;
  if (typeof zones === 'object' && zones !== null && !Array.isArray(zones)) {
    for (const entries of Object.values(zones as Record<string, unknown>)) {
      if (!Array.isArray(entries)) {
        continue;
      }
      const index = entries.findIndex((entry) => entryId(entry) === id);
      if (index !== -1) {
        return entries.splice(index, 1)[0];
      }
    }
  }
  return undefined;
}

function dropIds(snapshot: Record<string, unknown>, ids: Set<string>): void {
  const keep = (entry: unknown): boolean => {
    const id = entryId(entry);
    return id === undefined || !ids.has(id);
  };
  if (Array.isArray(snapshot.content)) {
    snapshot.content = (snapshot.content as unknown[]).filter(keep);
  }
  const zones = snapshot.zones;
  if (typeof zones === 'object' && zones !== null && !Array.isArray(zones)) {
    const zoneMap = zones as Record<string, unknown>;
    for (const [key, entries] of Object.entries(zoneMap)) {
      if (Array.isArray(entries)) {
        zoneMap[key] = entries.filter(keep);
      }
    }
  }
}

/**
 * Applies a delta to a document snapshot without mutating the input, in the
 * order removes, adds, then moves. Adds insert a deep copy of the delta's
 * component and are skipped when the id already exists anywhere in the
 * document. Moves reposition the document's own instance and are skipped when
 * its id is absent. Root and unrelated snapshot keys are preserved.
 */
export function applySlotDelta(
  snapshot: Record<string, unknown>,
  delta: SlotDelta,
): Record<string, unknown> {
  const result = structuredClone(snapshot);
  const templateIds = new Set(delta.templateIds);

  dropIds(result, new Set(delta.removed));

  for (const add of delta.added) {
    const id = entryId(add.component);
    if (id !== undefined && documentHasId(result, id)) {
      continue;
    }
    insertPlaced(result, add.placement, structuredClone(add.component), templateIds);
  }

  for (const move of delta.moved) {
    const instance = removeById(result, move.id);
    if (instance === undefined) {
      continue;
    }
    insertPlaced(result, move.placement, instance, templateIds);
  }

  return result;
}

/**
 * The slot ids a delta touches: added, removed, and moved.
 */
export function touchedSlotIds(delta: SlotDelta): string[] {
  return [
    ...delta.added.map((add) => entryId(add.component) ?? ''),
    ...delta.removed,
    ...delta.moved.map((move) => move.id),
  ].filter((id) => id !== '');
}

/**
 * Narrows an unknown value to a `SlotDelta`. Every one of the four keys must
 * be an array, so legacy action-array payloads and partial objects are
 * rejected.
 */
export function isSlotDelta(value: unknown): value is SlotDelta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.added) &&
    Array.isArray(candidate.removed) &&
    Array.isArray(candidate.moved) &&
    Array.isArray(candidate.templateIds)
  );
}
