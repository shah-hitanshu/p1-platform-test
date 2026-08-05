import React, { useCallback } from 'react';
import { ActionBar, createUsePuck, usePuck } from '@puckeditor/core';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import type { TemplateSummary } from '../types.js';

const usePuckState = createUsePuck();

interface ContentItem {
  type: string;
  props: { id: string; [key: string]: unknown };
}

interface PinMapRecord {
  [componentId: string]: boolean;
}

/**
 * Resolve the template being edited in template mode (document path
 * `_registry/templates/<name>`). Pinning is a template-authoring capability,
 * so ordinary pages (including template-bound ones) resolve to null.
 */
function resolveTemplate(css: {
  currentDocument: { path: string } | null;
  templates: TemplateSummary[];
}): TemplateSummary | null {
  const path = css.currentDocument?.path;
  if (!path) return null;

  const match = path.match(/^_registry\/templates\/(.+)$/);
  if (!match) return null;

  return css.templates.find((t) => t.name === match[1]) ?? null;
}

export function ActionBarPinButton(): React.ReactElement | null {
  const css = useP1PuckOptional();
  const selectedItem = usePuckState((s) => s.selectedItem) as ContentItem | null;
  const rootProps = usePuckState(
    (s) => (s as unknown as { appState: { data: { root: { props: Record<string, unknown> } } } }).appState?.data?.root?.props
  );

  const { dispatch } = usePuck();

  const template = css ? resolveTemplate(css) : null;

  const pinMap: PinMapRecord = (rootProps?._pinMap as PinMapRecord) ?? {};

  // Pin state lives in the document's root props (_pinMap) and persists
  // through the normal document autosave.
  const handleTogglePin = useCallback(() => {
    if (!css || !template || !selectedItem || css.isViewingHistoricalVersion) return;

    const compId = selectedItem.props.id;
    const newPinned = !pinMap[compId];

    const updatedPinMap = { ...pinMap, [compId]: newPinned };
    dispatch({
      type: 'setData',
      data: (prev: Record<string, unknown>) => ({
        ...prev,
        root: {
          ...(prev.root as Record<string, unknown>),
          props: {
            ...((prev.root as Record<string, unknown>).props as Record<string, unknown>),
            _pinMap: updatedPinMap,
          },
        },
      }),
    } as never);
  }, [css, template, selectedItem, pinMap, dispatch]);

  if (!css || !template || !selectedItem) {
    return null;
  }

  const isAdmin = css.userRole === 'admin';
  const isPinned = pinMap[selectedItem.props.id] ?? false;

  return (
    <ActionBar.Action
      label={isPinned ? 'Unpin component' : 'Pin component'}
      onClick={handleTogglePin}
      active={isPinned}
      // Historical versions are read-only; a toggle there would never persist.
      disabled={!isAdmin || css.isViewingHistoricalVersion}
    >
      <Icon
        iconName={isPinned ? 'lock' : 'lockOpen'}
        size="s"
        aria-hidden="true"
      />
    </ActionBar.Action>
  );
}
