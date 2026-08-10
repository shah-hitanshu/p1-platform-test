/**
 * OutlinePanel
 *
 * The page's block structure, replacing Puck's stock LayerTree at the `outline`
 * override key.
 *
 */

import React from 'react';
import { createUsePuck } from '@puckeditor/core';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { GripHandleIcon } from '../icons/index.js';
import { DraggableRow } from './DraggableRow.js';
import { PanelShell } from './PanelShell.js';
import { PreviewPanelOverlay } from './PreviewPanelOverlay.js';
import { flattenOutline, resolveDrop, ROOT_ZONE, type OutlineRow } from './outlineTree.js';
import { getIconForComponent } from './componentIconName.js';
import { useDragReorder } from './useDragReorder.js';
import styles from './OutlinePanel.module.css';

const usePuckOutline = createUsePuck();

export function OutlinePanel(): React.ReactElement {
  const p1Puck = useP1PuckOptional();
  const isViewingHistoricalVersion = p1Puck?.isViewingHistoricalVersion ?? false;
  const viewingVersion = p1Puck?.viewingVersion ?? null;
  const returnToLatest = p1Puck?.returnToLatest ?? (() => {});

  const content = usePuckOutline(
    (s) => s.appState.data.content,
  ) as Parameters<typeof flattenOutline>[0];
  const config = usePuckOutline((s) => s.config) as Parameters<typeof flattenOutline>[1];
  const itemSelector = usePuckOutline((s) => s.appState.ui.itemSelector) as
    | { index: number; zone?: string }
    | null;
  const dispatch = usePuckOutline((s) => s.dispatch) as (action: unknown) => void;

  const rows = React.useMemo(() => flattenOutline(content, config), [content, config]);

  const isSelected = (row: OutlineRow) =>
    !!itemSelector &&
    itemSelector.index === row.index &&
    (itemSelector.zone ?? ROOT_ZONE) === row.zone;

  const select = (row: OutlineRow) => {
    dispatch({ type: 'setUi', ui: { itemSelector: { index: row.index, zone: row.zone } } });
  };

  const remove = (row: OutlineRow) => {
    dispatch({ type: 'remove', index: row.index, zone: row.zone });
  };

  const { dropTargetId, getDragHandlers } = useDragReorder<OutlineRow>({
    getId: (row) => row.id,
    onReorder: (source, target) => {
      const move = resolveDrop(source, target);
      if (move) {
        dispatch({
          type: 'reorder',
          sourceIndex: move.sourceIndex,
          destinationIndex: move.destinationIndex,
          destinationZone: move.zone,
        });
      }
    },
  });

  return (
    <PreviewPanelOverlay
      isViewingHistoricalVersion={isViewingHistoricalVersion}
      versionNumber={viewingVersion?.versionNumber ?? undefined}
      onExitPreview={returnToLatest}
    >
      <PanelShell title="Outline">
        {rows.length === 0 ? (
          <div className={styles.empty}>No blocks yet. Add one from the Blocks panel.</div>
        ) : (
          <>
            <div className={styles.eyebrow}>Page structure</div>
            {rows.map((row) => (
              <DraggableRow
                key={row.id}
                depth={row.depth}
                isSelected={isSelected(row)}
                isDropTarget={dropTargetId === row.id}
                onSelect={() => select(row)}
                dragHandlers={getDragHandlers(row)}
              >
                <span className={styles.grip} aria-hidden="true">
                  <GripHandleIcon />
                </span>
                <span className={styles.icon} aria-hidden="true">
                  <Icon iconName={getIconForComponent(row.type, row.label) as never} size="s" />
                </span>
                <span className={styles.label}>{row.label}</span>
                <button
                  type="button"
                  className={styles.delete}
                  aria-label={`Delete ${row.label}`}
                  // stopPropagation on both onClick and onKeyDown: the row div's
                  // onKeyDown fires on Space/Enter bubbling up from this button,
                  // which would call select(row) for a block being deleted.
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(row);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Icon iconName="trash" size="s" />
                </button>
              </DraggableRow>
            ))}
          </>
        )}
      </PanelShell>
    </PreviewPanelOverlay>
  );
}
