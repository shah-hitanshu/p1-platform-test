import { createUsePuck } from '@puckeditor/core';
import { humanizeComponentName } from '@pantheon-systems/puck-css';
import type { SelectedBlock } from '../types.js';

const usePuckSelection = createUsePuck();

function selectorToPath(zone: string, index: number): string {
  if (zone === 'root:default-zone' || zone === 'content') return `content.${String(index)}`;
  return `zones.${zone}.${String(index)}`;
}

const PREVIEW_LENGTH = 60;

// Newlines separate entries here and nowhere else: elsewhere they are just wrapped prose.
const ITEM_PROPS = ['items'];
const TEXT_PROPS = ['title', 'heading', 'text', 'label', 'content', 'body', 'caption', 'alt'];

function clean(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function shorten(text: string): string {
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

function entriesOf(value: unknown): string[] {
  if (typeof value === 'string') return value.split('\n').map(clean).filter(line => line !== '');
  if (!Array.isArray(value)) return [];
  return value
    .map(entry => {
      if (typeof entry === 'string') return clean(entry);
      const { label, title, text } = (entry ?? {}) as Record<string, unknown>;
      const first = [label, title, text].find(candidate => typeof candidate === 'string');
      return typeof first === 'string' ? clean(first) : '';
    })
    .filter(entry => entry !== '');
}

function describeContent(
  props: Record<string, unknown>,
): { preview?: string; itemCount?: number } {
  for (const key of ITEM_PROPS) {
    const entries = entriesOf(props[key]);
    if (entries.length === 0) continue;
    return entries.length > 1
      ? { preview: shorten(entries[0]), itemCount: entries.length }
      : { preview: shorten(entries[0]) };
  }

  for (const key of TEXT_PROPS) {
    const value = props[key];
    if (typeof value !== 'string') continue;
    const text = clean(value);
    if (text !== '') return { preview: shorten(text) };
  }

  return {};
}

export function useSelectedBlock(): SelectedBlock | null {
  const selectedItem = usePuckSelection(state => state.selectedItem);
  const itemSelector = usePuckSelection(state => state.appState.ui.itemSelector);
  const config = usePuckSelection(state => state.config) as {
    components?: Record<string, { label?: string }>;
  } | undefined;

  const id = selectedItem?.props?.id;
  const type = selectedItem?.type;
  if (typeof id !== 'string' || id === '' || typeof type !== 'string' || type === '') return null;
  if (!itemSelector || itemSelector.zone === undefined || itemSelector.index === undefined) {
    return null;
  }

  return {
    id,
    type,
    path: selectorToPath(itemSelector.zone, itemSelector.index),
    // As the outline panel derives it, so it matches the block's overlay.
    label: config?.components?.[type]?.label ?? humanizeComponentName(type),
    ...describeContent((selectedItem?.props ?? {}) as Record<string, unknown>),
  };
}
