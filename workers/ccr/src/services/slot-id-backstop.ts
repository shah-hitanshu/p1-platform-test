/**
 * Within-document props.id uniqueness backstop for the version-write path.
 *
 * A duplicate props.id reaching a persisted snapshot means an upstream
 * boundary missed re-minting. This is the last check before the database:
 * later duplicates are re-minted and a structured warning makes the miss
 * observable. Pin state (root.props._pinMap) is keyed by component id, so a
 * re-mint carries the previous id's pin entry to the new id.
 *
 * @see PROPOSAL-015 Design 3
 */

import { dedupeComponentIds } from './component-identity';

/**
 * Copies each re-minted component's `root.props._pinMap` entry from its
 * previous id to its new id, mutating the deduped snapshot in place. A
 * previous id with no pin entry leaves the new id unpinned.
 */
function carryPinState(
  snapshot: Record<string, unknown>,
  reminted: readonly { previousId: string; newId: string }[],
): void {
  const root = snapshot.root as { props?: { _pinMap?: unknown } } | undefined;
  const pinMap = root?.props?._pinMap;
  if (typeof pinMap !== 'object' || pinMap === null || Array.isArray(pinMap)) {
    return;
  }
  const map = pinMap as Record<string, unknown>;
  for (const { previousId, newId } of reminted) {
    if (Object.prototype.hasOwnProperty.call(map, previousId)) {
      map[newId] = map[previousId];
    }
  }
}

/**
 * Returns a snapshot whose component props.id values are unique within the
 * document. The first occurrence in walk order keeps its id; later duplicates
 * are re-minted, carrying their pin state to the new id. With no duplicates
 * the input reference is returned unchanged; when duplicates are re-minted a
 * structured warning names the document and each previous/new id pair.
 */
export function enforceUniqueSlotIds(
  documentId: string,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const { snapshot: deduped, reminted } = dedupeComponentIds(snapshot);
  if (reminted.length === 0) {
    return deduped as Record<string, unknown>;
  }
  console.warn('duplicate_component_ids_reminted', { documentId, reminted });
  const dedupedSnapshot = deduped as Record<string, unknown>;
  carryPinState(dedupedSnapshot, reminted);
  return dedupedSnapshot;
}
