/**
 * Which of a template's slots are pinned. Two other places answer this from the same fields and
 * must keep agreeing: `createPuckPermissions` in puck-css, which locks drag and delete, and the
 * validator's `validateDocumentStructure`, which checks presence and relative order.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A component's slot id: what `_pinMap` is keyed by. */
function slotId(component: unknown): string | undefined {
  if (!isRecord(component)) return undefined;
  const props = component.props;
  if (!isRecord(props)) return undefined;
  return typeof props.id === 'string' ? props.id : undefined;
}

/**
 * The pinned slot ids of a template, in the order the template places them: the snapshot must be
 * content-shaped, the id `true` in `root.props._pinMap`, and the id must name a component the
 * template actually places.
 *
 * A shape this doesn't recognize — a legacy `{ components }` manifest, a missing pin map — pins
 * nothing, matching the validator's own fallback rather than guessing stricter.
 */
export function pinnedSlotIds(template: unknown): string[] {
  if (!isRecord(template) || !Array.isArray(template.content)) return [];

  const root = isRecord(template.root) ? template.root : undefined;
  const rootProps = root !== undefined && isRecord(root.props) ? root.props : undefined;
  const pinMap = rootProps !== undefined && isRecord(rootProps._pinMap) ? rootProps._pinMap : undefined;
  if (pinMap === undefined) return [];

  const zones = isRecord(template.zones) ? Object.values(template.zones) : [];
  const pinned: string[] = [];
  for (const list of [template.content, ...zones]) {
    if (!Array.isArray(list)) continue;
    for (const component of list) {
      const id = slotId(component);
      if (id !== undefined && pinMap[id] === true) pinned.push(id);
    }
  }
  return pinned;
}
