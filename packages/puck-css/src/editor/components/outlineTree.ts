/**
 * outlineTree
 *
 * Turns Puck's document into the flat, depth-tagged row list the outline
 * renders, and works out what a drag-and-drop actually means. Kept free of
 * React so the index arithmetic — the part that is easy to get subtly wrong —
 * can be tested directly.
 */

import { humanizeComponentName } from '../thumbnails/humanizeComponentName.js';

/**
 * Puck's compound id for top-level content. Slots use `{componentId}:{slotName}`.
 * See PuckSelectionTracker.tsx for the same convention on the read side.
 */
export const ROOT_ZONE = 'root:default-zone';

export interface OutlineRow {
  /** Component id. Stable React key, and the unit a drag moves. */
  id: string;
  /** Puck component type, e.g. "HeadingBlock". */
  type: string;
  /** What the row displays: the config's label, else the humanized type. */
  label: string;
  /** Zone compound this row lives in. */
  zone: string;
  /** Position within `zone`. */
  index: number;
  /** Nesting depth; 0 for top-level. */
  depth: number;
}

interface ContentItem {
  type: string;
  props?: { id?: string } & Record<string, unknown>;
}

interface OutlineComponentConfig {
  label?: string;
  fields?: Record<string, { type?: string } | undefined>;
}

interface OutlineConfig {
  components?: Record<string, OutlineComponentConfig>;
}

/** Names of the component's slot fields — the only ones that hold children. */
function slotNames(config: OutlineConfig, type: string): string[] {
  const fields = config.components?.[type]?.fields ?? {};
  return Object.entries(fields)
    .filter(([, field]) => field?.type === 'slot')
    .map(([name]) => name);
}

/**
 * Depth-first flatten of `content` into rows, descending through slot fields.
 *
 * A component with no id falls back to a zone-and-index key. That only happens
 * for malformed data, but a duplicate React key would be worse than a synthetic
 * one.
 */
export function flattenOutline(
  content: ContentItem[] | undefined,
  config: OutlineConfig,
  zone: string = ROOT_ZONE,
  depth = 0,
): OutlineRow[] {
  const rows: OutlineRow[] = [];

  (content ?? []).forEach((item, index) => {
    const id = String(item.props?.id ?? `${zone}:${index}`);

    rows.push({
      id,
      type: item.type,
      label: config.components?.[item.type]?.label ?? humanizeComponentName(item.type),
      zone,
      index,
      depth,
    });

    for (const slot of slotNames(config, item.type)) {
      const children = item.props?.[slot];
      if (Array.isArray(children)) {
        rows.push(
          ...flattenOutline(children as ContentItem[], config, `${id}:${slot}`, depth + 1),
        );
      }
    }
  });

  return rows;
}

/**
 * What a drop means, or null when it means nothing.
 *
 * The rule is: **the dragged row ends up at the index it was dropped on**.
 * Puck's `reorder` removes then re-inserts (`splice(start,1)` then
 * `splice(end,0,item)`), which makes `destinationIndex: target.index` produce
 * exactly that in both directions. No off-by-one correction is needed.
 *
 * Cross-zone drops return null: moving a block between parents requires a
 * `move` action, which is a separate operation not handled here.
 */
export function resolveDrop(
  source: OutlineRow,
  target: OutlineRow,
): { zone: string; sourceIndex: number; destinationIndex: number } | null {
  if (source.zone !== target.zone) return null;
  if (source.index === target.index) return null;

  return {
    zone: source.zone,
    sourceIndex: source.index,
    destinationIndex: target.index,
  };
}
