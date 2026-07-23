/**
 * Structural Validation
 *
 * Validates that a document conforms to its template's structural requirements.
 */

import type { Data } from '@puckeditor/core';
import type { Template } from '../types.js';

export type ValidationErrorCode =
  | 'MISSING_PINNED_COMPONENT'
  | 'PINNED_COMPONENT_OUT_OF_ORDER'
  | 'UNEXPECTED_COMPONENT_AT_PINNED_SLOT';

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  componentType?: string;
  expectedIndex?: number;
  actualIndex?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Read a component instance's slot id (`props.id`) if it is a string.
 */
function slotId(item: unknown): string | undefined {
  const id = (item as { props?: { id?: unknown } })?.props?.id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Read a component instance's type if it is a string.
 */
function componentTypeOf(item: unknown): string | undefined {
  const type = (item as { type?: unknown })?.type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * A pinned slot the template requires, tagged with the list that holds it
 * ('content' or a zone key).
 */
interface PinnedSlot {
  id: string;
  type: string;
  list: string;
}

/**
 * A document's component slot ids: per list, and flattened for membership tests.
 */
interface DocumentSlots {
  all: Set<string>;
  byList: Map<string, string[]>;
}

/**
 * Pinned slots held by one list, in list order.
 */
function pinnedSlotsIn(
  items: unknown,
  list: string,
  pinMap: Record<string, boolean>
): PinnedSlot[] {
  if (!Array.isArray(items)) return [];

  const slots: PinnedSlot[] = [];
  for (const item of items) {
    const id = slotId(item);
    const type = componentTypeOf(item);
    if (id !== undefined && type !== undefined && pinMap[id] === true) {
      slots.push({ id, type, list });
    }
  }
  return slots;
}

/**
 * Every pinned slot a template requires, content first, then zones.
 */
function collectPinnedSlots(template: Template): PinnedSlot[] {
  const pinMap = template.root?.props?._pinMap ?? {};

  const slots = pinnedSlotsIn(template.content, 'content', pinMap);
  for (const [zoneKey, zoneItems] of Object.entries(template.zones ?? {})) {
    slots.push(...pinnedSlotsIn(zoneItems, zoneKey, pinMap));
  }
  return slots;
}

/**
 * Slot ids held by one list, in list order.
 */
function slotIdsIn(items: unknown): string[] {
  if (!Array.isArray(items)) return [];

  const ids: string[] = [];
  for (const item of items) {
    const id = slotId(item);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/**
 * Index a document's slot ids by the list that holds them.
 */
function collectDocumentSlots(data: Data): DocumentSlots {
  const byList = new Map<string, string[]>();
  byList.set('content', slotIdsIn(data.content));

  const zones = (data.zones ?? {}) as Record<string, unknown>;
  for (const [zoneKey, zoneItems] of Object.entries(zones)) {
    byList.set(zoneKey, slotIdsIn(zoneItems));
  }

  const all = new Set<string>();
  for (const ids of byList.values()) {
    for (const id of ids) all.add(id);
  }

  return { all, byList };
}

/**
 * Presence: a pinned slot may sit in any list, but its id must appear
 * somewhere in the document.
 */
function findMissingSlots(pinnedSlots: PinnedSlot[], documentIds: Set<string>): ValidationError[] {
  return pinnedSlots
    .filter((slot) => !documentIds.has(slot.id))
    .map((slot) => ({
      code: 'MISSING_PINNED_COMPONENT' as const,
      message: `Missing required pinned component: ${slot.type}`,
      componentType: slot.type,
    }));
}

/**
 * Order: within each list, the pinned slots found in that list keep the
 * template's relative order. A slot found in a different list than the
 * template placed it in does not advance that list's chain.
 */
function findOutOfOrderSlots(
  pinnedSlots: PinnedSlot[],
  idsByList: Map<string, string[]>
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const list of new Set(pinnedSlots.map((slot) => slot.list))) {
    const documentListIds = idsByList.get(list) ?? [];
    let lastIndex = -1;

    for (const slot of pinnedSlots) {
      if (slot.list !== list) continue;

      const index = documentListIds.indexOf(slot.id);
      if (index === -1) continue;

      if (index < lastIndex) {
        errors.push({
          code: 'PINNED_COMPONENT_OUT_OF_ORDER',
          message: `Pinned component out of order: ${slot.type}`,
          componentType: slot.type,
          actualIndex: index,
        });
      } else {
        lastIndex = index;
      }
    }
  }

  return errors;
}

/**
 * Validate that document data conforms to template structure.
 *
 * Conformance resolves by slot-id membership: every pinned slot must be
 * present somewhere in the document, and the pinned slots that share a list
 * must hold the template's relative order there. Components carrying non-slot
 * ids are allowed anywhere. A template with no pinned slots imposes nothing.
 */
export function validateStructure(data: Data, template: Template): ValidationResult {
  const pinnedSlots = collectPinnedSlots(template);
  if (pinnedSlots.length === 0) {
    return { valid: true, errors: [] };
  }

  const { all, byList } = collectDocumentSlots(data);
  const errors = [
    ...findMissingSlots(pinnedSlots, all),
    ...findOutOfOrderSlots(pinnedSlots, byList),
  ];

  return {
    valid: errors.length === 0,
    errors,
  };
}
