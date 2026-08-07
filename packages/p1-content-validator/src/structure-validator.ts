import type {
  StructuralConformanceError,
  ValidateStructureInput,
} from './types.js';
import { isPlainObject } from './guards.js';

interface Slot {
  id: string;
  type: string;
}

function asComponentList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function componentId(component: unknown): string | undefined {
  if (!isPlainObject(component)) {
    return undefined;
  }
  const props = component.props;
  if (!isPlainObject(props)) {
    return undefined;
  }
  return typeof props.id === 'string' ? props.id : undefined;
}

function componentType(component: unknown): string {
  if (isPlainObject(component) && typeof component.type === 'string') {
    return component.type;
  }
  return '';
}

function zonesOf(snapshot: unknown): Record<string, unknown> {
  if (!isPlainObject(snapshot)) {
    return {};
  }
  return isPlainObject(snapshot.zones) ? snapshot.zones : {};
}

function pinMapOf(template: Record<string, unknown>): Record<string, unknown> {
  const root = template.root;
  if (!isPlainObject(root)) {
    return {};
  }
  const props = root.props;
  if (!isPlainObject(props)) {
    return {};
  }
  return isPlainObject(props._pinMap) ? props._pinMap : {};
}

// A pinned slot is a component with a string props.id whose _pinMap entry is strictly true.
function pinnedSlots(list: unknown[], pinMap: Record<string, unknown>): Slot[] {
  const slots: Slot[] = [];
  for (const component of list) {
    const id = componentId(component);
    if (id !== undefined && pinMap[id] === true) {
      slots.push({ id, type: componentType(component) });
    }
  }
  return slots;
}

// Document content is the top-level content[]; when absent it falls back to root.props.content.
function documentContentOf(documentSnapshot: unknown): unknown[] {
  if (!isPlainObject(documentSnapshot)) {
    return [];
  }
  if (Array.isArray(documentSnapshot.content)) {
    return documentSnapshot.content;
  }
  const root = documentSnapshot.root;
  if (!isPlainObject(root)) {
    return [];
  }
  const props = root.props;
  if (!isPlainObject(props)) {
    return [];
  }
  return asComponentList(props.content);
}

function collectIds(list: unknown[], ids: Set<string>): void {
  for (const component of list) {
    const id = componentId(component);
    if (id !== undefined) {
      ids.add(id);
    }
  }
}

function indexOfId(list: unknown[], id: string): number {
  for (let i = 0; i < list.length; i++) {
    if (componentId(list[i]) === id) {
      return i;
    }
  }
  return -1;
}

// Within one list, pinned slots must keep their template-relative order. A slot absent
// from this document list (present elsewhere or missing) neither errors nor advances the chain.
function checkListOrder(
  slots: Slot[],
  documentList: unknown[],
  errors: StructuralConformanceError[],
): void {
  let lastFoundIndex = -1;
  slots.forEach((slot, expectedIndex) => {
    const actualIndex = indexOfId(documentList, slot.id);
    if (actualIndex === -1) {
      return;
    }
    if (actualIndex < lastFoundIndex) {
      errors.push({
        code: 'pinned_component_out_of_order',
        componentType: slot.type,
        expectedIndex,
        actualIndex,
        message:
          `Pinned component "${slot.type}" appears out of order. ` +
          `Expected after index ${lastFoundIndex} but found at index ${actualIndex}.`,
      });
      return;
    }
    lastFoundIndex = actualIndex;
  });
}

/**
 * Validates a document snapshot against a content-shaped template by slot-id membership.
 *
 * A template component is a pinned slot when it has a string `props.id` and
 * `root.props._pinMap[id]` is strictly `true`. Slots are read from the template's
 * `content[]` and each `zones[key][]`. A document conforms when:
 *
 * 1. Presence: every pinned slot id appears among the document's component ids,
 *    collected from the top-level `content[]` (or `root.props.content` when the
 *    top-level array is absent) and every `zones[key][]`.
 * 2. Order: within each list, the pinned slots found in that list keep the template's
 *    relative order. A pinned slot found in a different list than the template placed it
 *    in raises no order error and does not advance that list's order chain.
 *
 * Matching is by id, so a same-typed local component never satisfies a pinned slot and a
 * duplicated type cannot mask a missing one. A template that is not a content-shaped
 * snapshot (missing `content` array, malformed `root`/`_pinMap`, or the legacy
 * `{ components }` manifest) pins nothing, and every document conforms.
 *
 * Never throws: every property access is type-guarded, and malformed input yields an
 * empty error list rather than an exception.
 *
 * @param input - Document snapshot and the template snapshot to validate against
 * @returns Object with an array of structural conformance errors (empty when valid)
 */
export function validateDocumentStructure(
  input: ValidateStructureInput,
): { errors: StructuralConformanceError[] } {
  const { documentSnapshot, templateSnapshot } = input;
  const errors: StructuralConformanceError[] = [];

  // Only a content-shaped snapshot pins slots; anything else conforms unconditionally.
  if (!isPlainObject(templateSnapshot) || !Array.isArray(templateSnapshot.content)) {
    // A template bound to live documents that is not content-shaped disables
    // structural validation for all of them; surface it so operators can catch
    // a broken template deployment rather than have every document silently pass.
    console.warn(
      '[p1-content-validator] Template snapshot is not content-shaped; skipping structural validation and treating the document as conforming.',
    );
    return { errors };
  }

  const pinMap = pinMapOf(templateSnapshot);
  const contentSlots = pinnedSlots(templateSnapshot.content, pinMap);

  const templateZones = zonesOf(templateSnapshot);
  const zoneSlots: { key: string; slots: Slot[] }[] = [];
  for (const key of Object.keys(templateZones)) {
    zoneSlots.push({
      key,
      slots: pinnedSlots(asComponentList(templateZones[key]), pinMap),
    });
  }

  const allSlots = [...contentSlots, ...zoneSlots.flatMap((zone) => zone.slots)];
  if (allSlots.length === 0) {
    return { errors };
  }

  const documentContent = documentContentOf(documentSnapshot);
  const documentZones = zonesOf(documentSnapshot);

  const documentIds = new Set<string>();
  collectIds(documentContent, documentIds);
  for (const key of Object.keys(documentZones)) {
    collectIds(asComponentList(documentZones[key]), documentIds);
  }

  for (const slot of allSlots) {
    if (!documentIds.has(slot.id)) {
      errors.push({
        code: 'missing_pinned_component',
        componentType: slot.type,
        message: `Required component "${slot.type}" is missing from the document.`,
      });
    }
  }

  checkListOrder(contentSlots, documentContent, errors);
  for (const zone of zoneSlots) {
    checkListOrder(zone.slots, asComponentList(documentZones[zone.key]), errors);
  }

  return { errors };
}
