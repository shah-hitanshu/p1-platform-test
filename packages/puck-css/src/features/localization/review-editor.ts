/** Live review reads and writes use Puck's component index, including nested slots. */
import { createUsePuck, type PuckApi } from '@puckeditor/core';
import isEqual from 'lodash.isequal';
import { ROOT_SLOT_ID } from './prop-target.js';
import { readPropValue, recoveryPointer, writePropValue, type PropValue } from './prop-value.js';

const useEditor = createUsePuck();

function targetItem(editor: PuckApi, componentId: string) {
  try {
    return editor.getItemById(componentId);
  } catch (error) {
    // Puck 0.21's getItemById throws for absent nodes; getSelectorForId returns undefined.
    if (!editor.getSelectorForId(componentId)) return undefined;

    throw error;
  }
}

function targetProps(editor: PuckApi, componentId: string): Record<string, unknown> | undefined {
  if (componentId === ROOT_SLOT_ID) {
    return editor.appState.data.root.props;
  }

  return targetItem(editor, componentId)?.props;
}

export function useReviewValue(componentId: string, pointer: string | undefined): PropValue {
  // Select existence and value separately: allocating a PropValue inside a selector
  // would give Puck a different result on every store notification.
  const exists = useEditor((editor) => {
    if (pointer === undefined) return false;

    return readPropValue(targetProps(editor, componentId), pointer).exists;
  });

  const value = useEditor((editor) => {
    if (pointer === undefined) return undefined;

    const field = readPropValue(targetProps(editor, componentId), pointer);
    return field.exists ? field.value : undefined;
  });

  return exists ? { exists: true, value } : { exists: false };
}

export function useReviewTarget(componentId: string, pointer: string | undefined) {
  const available = useEditor((editor) => targetProps(editor, componentId) !== undefined);
  const field = useReviewValue(componentId, pointer);
  const type = useEditor((editor) => {
    if (componentId === ROOT_SLOT_ID) return undefined;

    return targetItem(editor, componentId)?.type;
  });
  const config = useEditor((editor) => editor.config);

  return { available, field, type, config };
}

/**
 * Selects the block a change belongs to and brings it into view on the canvas.
 *
 * Puck renders the page into an iframe, so the block is reached through that
 * document rather than the editor's own. Selection is component-level: Puck
 * exposes no way to put the caret in a single field.
 */
export function revealReviewTarget(editor: PuckApi, componentId: string): void {
  // Root props belong to the page rather than to a block on it.
  if (componentId === ROOT_SLOT_ID) return;

  const selector = editor.getSelectorForId(componentId);
  if (!selector) return;

  editor.dispatch({ type: 'setUi', ui: { itemSelector: selector } });

  if (typeof document === 'undefined') return;

  const frame = document.querySelector('#preview-frame');
  const canvas = frame instanceof HTMLIFrameElement ? frame.contentDocument : frame?.ownerDocument;
  const block = canvas?.querySelector(`[data-puck-component="${componentId}"]`);
  if (block instanceof HTMLElement) block.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

interface AppliedReplacement {
  pointer: string;
  before: PropValue;
  inserted: PropValue;
}

/** Returns null when the target is absent or no longer holds the expected value. */
export function replaceReviewValue(
  editor: PuckApi,
  componentId: string,
  pointer: string,
  value: PropValue,
  expected?: PropValue,
): AppliedReplacement | null {
  const props = targetProps(editor, componentId);
  if (props === undefined) return null;

  const before = readPropValue(props, pointer);
  if (expected !== undefined && !isEqual(before, expected)) return null;

  // Arrays shift on deletion; missing ancestors are created by nested writes.
  // Recovery compares and restores the smallest enclosing value affected by either.
  const restorePointer = recoveryPointer(props, pointer);
  const nextProps = writePropValue(props, pointer, value);

  if (componentId === ROOT_SLOT_ID) {
    editor.dispatch({
      type: 'setData',
      recordHistory: true,
      data: (previous) => ({
        ...previous,
        root: {
          ...previous.root,
          props: writePropValue(previous.root.props ?? {}, pointer, value),
        },
      }),
    });
  } else {
    const selector = editor.getSelectorForId(componentId);
    const item = editor.getItemById(componentId);
    if (!selector || !item) return null;

    editor.dispatch({
      type: 'replace',
      recordHistory: true,
      destinationIndex: selector.index,
      destinationZone: selector.zone,
      data: { ...item, props: { ...nextProps, id: item.props.id } },
    });
  }

  return {
    pointer: restorePointer,
    before: readPropValue(props, restorePointer),
    inserted: readPropValue(nextProps, restorePointer),
  };
}
