/**
 * Upstream apply helper
 *
 * Sets a single upstream prop value into Puck data at the component addressed by
 * a slot id (or '__root__' for root props), using a JSON Pointer relative to
 * that component's props. The component is found in the top-level content or in
 * any zone, since a change can land on either. Returns a new data object; the input is never mutated,
 * so the result can be handed straight to the editor's setData dispatch.
 */

import { ROOT_SLOT_ID } from './prop-target.js';

interface PuckProps extends Record<string, unknown> {
  id?: string;
}
interface PuckComponent {
  type: string;
  props: PuckProps;
}
export interface PuckDataShape {
  content: PuckComponent[];
  root: { props: Record<string, unknown> };
  zones?: Record<string, PuckComponent[]>;
  [key: string]: unknown;
}

/** Decode a JSON Pointer into its unescaped path segments. */
function pointerSegments(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return [];
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Immutably set `value` at `segments` within `target`, cloning along the path. */
function setAtPointer(target: unknown, segments: string[], value: unknown): unknown {
  const [head, ...rest] = segments;
  if (head === undefined) return value;

  if (Array.isArray(target)) {
    const index = Number(head);
    const next = target.slice();
    next[index] = setAtPointer(target[index], rest, value);
    return next;
  }

  const obj = (target ?? {}) as Record<string, unknown>;
  return { ...obj, [head]: setAtPointer(obj[head], rest, value) };
}

/**
 * Apply an upstream prop value to Puck data. The prop is addressed by
 * `componentId` (a slot id or '__root__') and a JSON Pointer into that
 * component's props. When the component is not present the data is returned
 * unchanged.
 */
export function applyUpstreamProp(
  data: PuckDataShape,
  componentId: string,
  propPath: string,
  value: unknown,
): PuckDataShape {
  const segments = pointerSegments(propPath);

  if (componentId === ROOT_SLOT_ID) {
    return {
      ...data,
      root: {
        ...data.root,
        props: setAtPointer(data.root.props, segments, value) as Record<string, unknown>,
      },
    };
  }

  const index = data.content.findIndex((c) => c.props?.id === componentId);
  if (index !== -1) {
    const target = data.content[index] as PuckComponent;
    const nextContent = data.content.slice();
    nextContent[index] = {
      ...target,
      props: setAtPointer(target.props, segments, value) as PuckProps,
    };
    return { ...data, content: nextContent };
  }

  // A component dropped into a slot lives under its zone, not in content.
  for (const [zoneKey, zone] of Object.entries(data.zones ?? {})) {
    const zoneIndex = zone.findIndex((c) => c.props?.id === componentId);
    if (zoneIndex === -1) continue;
    const target = zone[zoneIndex] as PuckComponent;
    const nextZone = zone.slice();
    nextZone[zoneIndex] = {
      ...target,
      props: setAtPointer(target.props, segments, value) as PuckProps,
    };
    return { ...data, zones: { ...data.zones, [zoneKey]: nextZone } };
  }

  return data;
}
