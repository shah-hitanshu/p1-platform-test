import React, { useCallback } from 'react';
import { ActionBar, createUsePuck } from '@puckeditor/core';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import type { TemplateSummary } from '../types.js';

const usePuckState = createUsePuck();

interface ContentItem {
  type: string;
  props: { id: string; [key: string]: unknown };
}

type PinMapRecord = Record<string, boolean>;

/**
 * Resolve the template being edited in template mode (document path
 * `_registry/templates/<name>`). Pinning is a template-authoring capability,
 * so ordinary pages (including template-bound ones) resolve to null.
 */
function resolveTemplate(ccr: {
  currentDocument: { path: string } | null;
  templates: TemplateSummary[];
}): TemplateSummary | null {
  const path = ccr.currentDocument?.path;
  if (!path) return null;

  const match = path.match(/^_registry\/templates\/(.+)$/);
  if (!match) return null;

  return ccr.templates.find((t) => t.name === match[1]) ?? null;
}

export function ActionBarPinButton(): React.ReactElement | null {
  const ccr = useP1PuckOptional();
  const selectedItem = usePuckState((s) => s.selectedItem) as ContentItem | null;
  const rootProps = usePuckState(
    (s) => (s as unknown as { appState: { data: { root: { props: Record<string, unknown> } } } }).appState?.data?.root?.props
  );

  const dispatch = usePuckState((s) => s.dispatch) as (action: unknown) => void;

  const template = ccr ? resolveTemplate(ccr) : null;

  const pinMap: PinMapRecord = (rootProps?._pinMap as PinMapRecord) ?? {};

  // Pin state lives in the document's root props (_pinMap) and persists
  // through the normal document autosave.
  const handleTogglePin = useCallback(() => {
    if (!ccr || !template || !selectedItem || ccr.isViewingHistoricalVersion) return;

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
  }, [ccr, template, selectedItem, pinMap, dispatch]);

  if (!ccr || !template || !selectedItem) {
    return null;
  }

  const isAdmin = ccr.userRole === 'admin';
  const isPinned = pinMap[selectedItem.props.id] ?? false;

  return (
    <ActionBar.Action
      label={isPinned ? 'Unpin component' : 'Pin component'}
      onClick={handleTogglePin}
      active={isPinned}
      // Historical versions are read-only; a toggle there would never persist.
      disabled={!isAdmin || ccr.isViewingHistoricalVersion}
    >
      <Icon
        iconName={isPinned ? 'lock' : 'lockOpen'}
        size="s"
        aria-hidden="true"
      />
    </ActionBar.Action>
  );
}
