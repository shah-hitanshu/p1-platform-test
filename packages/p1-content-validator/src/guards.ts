/**
 * Shape guards and path reads shared by the validators. Every entry point takes
 * `unknown` — snapshots, templates, and operations all arrive as parsed JSON.
 */

/** A component in a content-shaped snapshot: a type and a props bag. */
export interface ComponentShape {
  type: string;
  props: Record<string, unknown>;
  [key: string]: unknown;
}

/** Whether a value is a non-null, non-array object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Whether a value has the shape of a component: a string `type` and a props object. */
export function isComponentShape(value: unknown): value is ComponentShape {
  return isPlainObject(value) && typeof value.type === 'string' && isPlainObject(value.props);
}

/**
 * Reads the value at a dot-notation path (`content.0.props.title`), treating a
 * numeric segment as an array index. An empty path reads the root. Resolves to
 * undefined when a segment is absent or the path runs into a non-object.
 */
export function getAtPath(obj: unknown, path: string): unknown {
  if (path === '') return obj;
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = parseInt(key, 10);
      return isNaN(idx) ? undefined : cur[idx];
    }
    if (typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

/** The component a prop-path op targets, and where its props begin in the path. */
export interface ResolvedPropPath {
  component: ComponentShape;
  componentPath: string;
  propsIdx: number;
  parts: string[];
}

/**
 * Resolves the component whose prop a path writes to.
 *
 * Components nest through their slot props, so a path can carry several `props`
 * segments (`content.0.props.items.1.props.title`). The last one belongs to the
 * component being written; the earlier ones are its ancestors.
 *
 * Resolves to undefined when the path names no component before its props, or when
 * the snapshot holds something other than a component there.
 */
export function resolvePropPath(path: string, snapshot: unknown): ResolvedPropPath | undefined {
  const parts = path.split('.');
  const propsIdx = parts.lastIndexOf('props');
  // A prop write has at least one segment before 'props' (the component path).
  if (propsIdx <= 0) {
    return undefined;
  }
  const componentPath = parts.slice(0, propsIdx).join('.');
  const component = getAtPath(snapshot, componentPath);
  if (!isComponentShape(component)) {
    return undefined;
  }
  return { component, componentPath, propsIdx, parts };
}
