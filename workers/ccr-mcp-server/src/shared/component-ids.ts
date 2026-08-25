/**
 * Component id minting for the injection boundary (PROPOSAL-015 Design 3).
 *
 * A component's id is its `props.id` in `Type-uuid` form. Agent-supplied
 * content is re-minted before it reaches the backend: these helpers mint that id
 * and re-mint every component in a tree.
 */

/** A component: a `type` string paired with a `props` object holding its id. */
export interface Component {
  type: string;
  props: Record<string, unknown>;
}

export function isComponent(value: unknown): value is Component {
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

export function mintComponentId(type: string): string {
  return `${type}-${crypto.randomUUID()}`;
}

/**
 * Return a deep copy of `value` with a freshly minted `props.id` on every
 * component reachable through arrays and plain objects, including components
 * nested inside props. Client-supplied ids are discarded.
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
    return { ...value, props: { ...props, id: mintComponentId(value.type) } };
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = remintComponentIdsInValue(entry);
  }
  return out;
}

/** A whole-component slot in a document: an index into the `content` list or a zone's list. */
export type ComponentPosition =
  | { location: 'content'; index: number }
  | { location: 'zone'; zoneKey: string; index: number };

/**
 * A normalized op path names a whole component position when it is `content.N`
 * or `zones.KEY.N` with a numeric final segment. Deeper paths (e.g.
 * `content.0.props.title`) address a value inside a component, not the slot.
 */
export function componentPositionFromPath(path: string): ComponentPosition | undefined {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  if (!/^\d+$/.test(last)) {
    return undefined;
  }
  const index = Number(last);
  if (parts.length === 2 && parts[0] === 'content') {
    return { location: 'content', index };
  }
  if (parts.length >= 3 && parts[0] === 'zones') {
    return { location: 'zone', zoneKey: parts.slice(1, -1).join('.'), index };
  }
  return undefined;
}

export function componentAtPosition(
  snapshot: Record<string, unknown> | undefined,
  position: ComponentPosition,
): unknown {
  if (snapshot === undefined) {
    return undefined;
  }
  if (position.location === 'content') {
    const content = snapshot.content;
    return Array.isArray(content) ? content[position.index] : undefined;
  }
  const zones = snapshot.zones;
  if (typeof zones !== 'object' || zones === null) {
    return undefined;
  }
  const items = (zones as Record<string, unknown>)[position.zoneKey];
  return Array.isArray(items) ? items[position.index] : undefined;
}

export function slotId(component: unknown): string | undefined {
  return isComponent(component) && typeof component.props.id === 'string'
    ? component.props.id
    : undefined;
}
