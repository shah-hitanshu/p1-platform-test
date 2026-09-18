import type { ProposedOperation } from '@pantheon-systems/css-client';

import { humanizeComponentName } from '../../editor/thumbnails/humanizeComponentName.js';

interface PreviewFieldConfig {
  label?: string;
}

interface PreviewComponentConfig {
  label?: string;
  fields?: Record<string, PreviewFieldConfig | undefined>;
}

/** The parts of the editor's config and data a proposal preview reads. */
export interface ProposalPreviewSource {
  data?: unknown;
  config?: { components?: Record<string, PreviewComponentConfig | undefined> };
}

/** How one proposed operation reads to a person: which block and field, and what changes. */
export interface ProposalChange {
  kind: ProposedOperation['op'];
  /** The block the change lands in, named the way the outline names it. */
  block?: string;
  /** The field being changed, named the way the editor's form names it. */
  field?: string;
  before?: string;
  after?: string;
}

interface BlockLike {
  type: string;
  props?: Record<string, unknown>;
}

function isBlock(value: unknown): value is BlockLike {
  return typeof value === 'object' && value !== null && typeof (value as BlockLike).type === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function step(parent: unknown, key: string): unknown {
  if (Array.isArray(parent)) return parent[Number(key)];
  return isRecord(parent) ? parent[key] : undefined;
}

/** Walks a dot path, remembering the innermost block passed through and the field entered under it. */
function walk(data: unknown, path: string): { value: unknown; block?: BlockLike; fieldKey?: string } {
  let value = data;
  let block: BlockLike | undefined;
  let fieldKey: string | undefined;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    value = step(value, part);
    if (isBlock(value)) {
      block = value;
      fieldKey = undefined;
    } else if (block && part === 'props' && fieldKey === undefined && i + 1 < parts.length) {
      fieldKey = parts[i + 1];
    }
  }
  return { value, block, fieldKey };
}

function fieldKeyFromPath(path: string): string | undefined {
  const parts = path.split('.');
  const at = parts.lastIndexOf('props');
  return at >= 0 ? parts[at + 1] : undefined;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

/** Entities are decoded in one pass, so `&amp;lt;` reads as the `&lt;` the author wrote and not as `<`. */
function stripMarkup(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|br)\s*>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function blockName(block: BlockLike | undefined, source: ProposalPreviewSource): string | undefined {
  if (!block) return undefined;
  return source.config?.components?.[block.type]?.label ?? humanizeComponentName(block.type);
}

function fieldName(block: BlockLike | undefined, key: string | undefined, source: ProposalPreviewSource): string | undefined {
  if (key === undefined) return undefined;
  const label = block ? source.config?.components?.[block.type]?.fields?.[key]?.label : undefined;
  return label ?? humanizeComponentName(key.charAt(0).toUpperCase() + key.slice(1));
}

/** A value as a person would read it in the preview; nothing for a value that has no short reading. */
export function readValue(value: unknown, source: ProposalPreviewSource = {}): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return stripMarkup(value) || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isBlock(value)) return blockName(value, source);
  if (Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`;
  return undefined;
}

/** Reads one operation against the page as it stands, or against the path alone when the page is not to hand. */
export function describeChange(op: ProposedOperation, source: ProposalPreviewSource = {}): ProposalChange {
  const { value, block, fieldKey } = walk(source.data, op.path);
  const key = fieldKey ?? fieldKeyFromPath(op.path);
  const before = op.op === 'add' ? undefined : readValue(value, source);
  const after = op.op === 'remove' ? undefined : op.op === 'move' ? before : readValue(op.value, source);
  return {
    kind: op.op,
    block: blockName(block, source) ?? (isBlock(op.value) ? blockName(op.value, source) : undefined),
    field: fieldName(block, key, source),
    before,
    after,
  };
}

export function describeChanges(
  operations: readonly ProposedOperation[],
  source: ProposalPreviewSource = {},
): ProposalChange[] {
  return operations.map((op) => describeChange(op, source));
}
