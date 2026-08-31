import {
  remintComponentIdsInValue,
  componentPositionFromPath,
  componentAtPosition,
  slotId,
  type ComponentPosition,
} from '../../shared/component-ids.js';
import { type EditOperationShape } from './shared-schemas.js';

type RemintResult =
  | { ok: true; operations: EditOperationShape[] }
  | { ok: false; reason: string };

const BAIL_ADVICE =
  'Split index-shifting operations and whole-component replaces into separate ' +
  'apply_document_edits calls, or retry once the current content can be read.';

function isIndexSegment(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/** A component slot's list key: `content` for content slots, `zones.<zoneKey>` for zone slots. */
function positionListKey(position: ComponentPosition): string {
  return position.location === 'content' ? 'content' : `zones.${position.zoneKey}`;
}

/**
 * The list key a path addresses at list level (`content`, or `zones.KEY` with no
 * element index). Element and deeper paths return undefined.
 */
function listPathKey(path: string): string | undefined {
  const parts = path.split('.');
  if (parts.length === 1 && parts[0] === 'content') {
    return 'content';
  }
  if (parts[0] === 'zones' && parts.length >= 2 && !parts.slice(1).some(isIndexSegment)) {
    return `zones.${parts.slice(1).join('.')}`;
  }
  return undefined;
}

/**
 * The list key a path addresses at list level or element level: `content` and
 * `content.N` resolve to `content`; `zones.KEY` and `zones.KEY.N` resolve to
 * `zones.KEY`. Deeper paths (into a component's props) address no list.
 */
function listKeyContaining(path: string): string | undefined {
  const parts = path.split('.');
  if (parts[0] === 'content') {
    if (parts.length === 1) {
      return 'content';
    }
    return parts.length === 2 && isIndexSegment(parts[1]) ? 'content' : undefined;
  }
  if (parts[0] === 'zones' && parts.length >= 2) {
    const indexAt = parts.findIndex((part, i) => i >= 2 && isIndexSegment(part));
    if (indexAt === -1) {
      return `zones.${parts.slice(1).join('.')}`;
    }
    return indexAt === parts.length - 1 ? `zones.${parts.slice(1, indexAt).join('.')}` : undefined;
  }
  return undefined;
}

/**
 * The list an op renumbers for later ops in the same batch, or undefined if it
 * leaves indices intact. `add`, `remove`, `move`, and `reorder` shift the list
 * their path resolves into; a whole-array `replace` shifts the list it swaps.
 * A whole-component `replace` keeps the index count, so it shifts nothing.
 */
function shiftedListKey(op: EditOperationShape): string | undefined {
  if (op.type === 'replace') {
    return Array.isArray(op.content) ? listPathKey(op.path) : undefined;
  }
  return listKeyContaining(op.path);
}

function currentListItems(
  snapshot: Record<string, unknown> | undefined,
  listKey: string,
): unknown[] | undefined {
  if (snapshot === undefined) {
    return undefined;
  }
  if (listKey === 'content') {
    return Array.isArray(snapshot.content) ? snapshot.content : undefined;
  }
  const zones = snapshot.zones;
  if (typeof zones !== 'object' || zones === null) {
    return undefined;
  }
  const items = (zones as Record<string, unknown>)[listKey.slice('zones.'.length)];
  return Array.isArray(items) ? items : undefined;
}

/**
 * The reason a whole-component or whole-array replace at `listKey` cannot read a
 * reliable current occupant, or undefined when the read is reliable. Reads are
 * unreliable when the snapshot was never fetched, or when an earlier op in the
 * batch renumbered that list.
 */
function unreliableOccupantReason(
  listKey: string,
  snapshot: Record<string, unknown> | undefined,
  shiftedBy: Map<string, EditOperationShape>,
): string | undefined {
  if (snapshot === undefined) {
    return `Cannot resolve the current occupant at "${listKey}": the document snapshot ` +
      `was unavailable. ${BAIL_ADVICE}`;
  }
  const shifter = shiftedBy.get(listKey);
  if (shifter !== undefined) {
    return `Cannot resolve the current occupant at "${listKey}": an earlier "${shifter.type}" ` +
      `at "${shifter.path}" shifted that list. ${BAIL_ADVICE}`;
  }
  return undefined;
}

/** A whole-component replace forwards its content untouched when the incoming id
 * already occupies the slot, so nested ids the agent read back survive; otherwise
 * the content is fresh injection and every component id is re-minted. */
function remintWholeComponentReplace(
  op: EditOperationShape,
  snapshot: Record<string, unknown> | undefined,
  position: ComponentPosition,
): EditOperationShape {
  const incomingId = slotId(op.content);
  const currentId = slotId(componentAtPosition(snapshot, position));
  if (incomingId !== undefined && incomingId === currentId) {
    return op;
  }
  return { ...op, content: remintComponentIdsInValue(op.content) };
}

/** A whole-array replace forwards elements whose id already appears in that list
 * untouched and re-mints the rest, which are fresh injection. */
function remintWholeArrayReplace(
  op: EditOperationShape,
  snapshot: Record<string, unknown> | undefined,
  listKey: string,
): EditOperationShape {
  const currentIds = new Set(
    (currentListItems(snapshot, listKey) ?? [])
      .map((item) => slotId(item))
      .filter((id): id is string => id !== undefined),
  );
  const elements = op.content as unknown[];
  const remapped = elements.map((element) => {
    const id = slotId(element);
    return id !== undefined && currentIds.has(id) ? element : remintComponentIdsInValue(element);
  });
  return { ...op, content: remapped };
}

/**
 * Re-mint component ids in agent-supplied op content at the injection boundary
 * (PROPOSAL-015 Design 3), processing ops in batch order.
 *
 * An `add` mints fresh ids for every component in its content. `remove`, `move`,
 * and `reorder` carry no component content and pass through.
 *
 * A `replace` that targets a whole component position (`content.N` / `zones.KEY.N`)
 * or a whole array (`content` / `zones.KEY` with array content) requires a reliable
 * read of the current occupant: the snapshot must have been fetched and the target
 * list must not have been renumbered by an earlier op in the batch. When the read is
 * unreliable the whole request is rejected (no op is forwarded) and the caller
 * receives the reason. With a reliable read, a whole-component replace forwards its
 * content untouched when the incoming id matches the current occupant and re-mints
 * it otherwise; a whole-array replace forwards elements whose id already appears in
 * that list and re-mints the rest. Deeper replaces, and non-array content at a list
 * path, pass through unchanged.
 */
export function remintOperationIds(
  operations: EditOperationShape[],
  snapshot: Record<string, unknown> | undefined,
): RemintResult {
  const shiftedBy = new Map<string, EditOperationShape>();
  const operationsOut: EditOperationShape[] = [];

  for (const op of operations) {
    if (op.type === 'add') {
      operationsOut.push(
        op.content === undefined ? op : { ...op, content: remintComponentIdsInValue(op.content) },
      );
    } else if (op.type === 'replace') {
      const position = componentPositionFromPath(op.path);
      if (position !== undefined) {
        const reason = unreliableOccupantReason(positionListKey(position), snapshot, shiftedBy);
        if (reason !== undefined) {
          return { ok: false, reason };
        }
        operationsOut.push(remintWholeComponentReplace(op, snapshot, position));
      } else {
        const listKey = listPathKey(op.path);
        if (listKey !== undefined && Array.isArray(op.content)) {
          const reason = unreliableOccupantReason(listKey, snapshot, shiftedBy);
          if (reason !== undefined) {
            return { ok: false, reason };
          }
          operationsOut.push(remintWholeArrayReplace(op, snapshot, listKey));
        } else {
          operationsOut.push(op);
        }
      }
    } else {
      operationsOut.push(op);
    }

    const shifted = shiftedListKey(op);
    if (shifted !== undefined && !shiftedBy.has(shifted)) {
      shiftedBy.set(shifted, op);
    }
  }

  return { ok: true, operations: operationsOut };
}
