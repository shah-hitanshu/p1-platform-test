/**
 * Resolve Change Label
 *
 * Turns a change entry's raw componentId/propPath into the label an editor
 * would recognize on the canvas, reading the same config-driven labels
 * outlineTree.ts uses for the block outline. A structural addition has no
 * component in this document to read a type off, so its type is recovered
 * from the slot id itself: Puck's default id shape is `${type}-${uuid}`.
 */

import { humanizeComponentName } from '../../editor/thumbnails/humanizeComponentName.js';
import { ROOT_SLOT_ID } from './prop-target.js';
import { pointerSegments } from './prop-value.js';

interface FieldConfig {
  label?: string;
  objectFields?: Record<string, FieldConfig | undefined>;
  arrayFields?: Record<string, FieldConfig | undefined>;
}

interface ComponentConfig {
  label?: string;
  fields?: Record<string, FieldConfig | undefined>;
}

export interface ChangeLabelConfig {
  components?: Record<string, ComponentConfig | undefined>;
  root?: { fields?: Record<string, FieldConfig | undefined> };
}

const TRAILING_UUID = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function typeFromSlotId(componentId: string): string | null {
  const match = TRAILING_UUID.exec(componentId);
  return match ? componentId.slice(0, match.index) : null;
}

function humanizeField(name: string): string {
  return humanizeComponentName(name.charAt(0).toUpperCase() + name.slice(1));
}

/** A human label for the block a structural or field-level change concerns. */
export function resolveComponentLabel(
  config: ChangeLabelConfig,
  componentId: string,
  componentType?: string,
): string {
  if (componentId === ROOT_SLOT_ID) return 'Page settings';

  const type = componentType ?? typeFromSlotId(componentId);
  if (type === null) return componentId;

  return config.components?.[type]?.label ?? humanizeComponentName(type);
}

/** A human label for the specific field a prop-level change concerns. */
export function resolveFieldLabel(
  config: ChangeLabelConfig,
  componentId: string,
  propPath: string,
  componentType?: string,
): string {
  const type = componentType ?? typeFromSlotId(componentId);
  let fields = componentId === ROOT_SLOT_ID
    ? config.root?.fields
    : type === null ? undefined : config.components?.[type]?.fields;

  const labels: string[] = [];

  for (const segment of pointerSegments(propPath)) {
    if (/^\d+$/.test(segment)) {
      labels.push(`Item ${Number(segment) + 1}`);
      continue;
    }

    const field: FieldConfig | undefined = fields?.[segment];
    labels.push(field?.label ?? humanizeField(segment));
    fields = field?.objectFields ?? field?.arrayFields;
  }

  return labels.join(' → ') || 'All fields';
}
