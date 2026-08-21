/**
 * DocumentResolutionDetail Component
 *
 * Expanded view for a single document showing strategy options,
 * visual comparison via MergePreviewRenderer, cherry-pick visual panel,
 * and delete-type conflict messages.
 *
 * All visual styling uses inline React styles.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { DocumentConflictType, PuckData } from '@pantheon-systems/css-client';
import { InlineMessage } from '@pantheon-systems/pds-toolkit-react';
import { Render } from '@puckeditor/core';
import type { DocumentResolution, DocumentResolutionStrategy } from '../../useMergeResolution.js';
import type { ComponentDiffWithPosition } from '../../../core/types.js';
import { MergePreviewRenderer } from '../../../editor/components/merge-preview/MergePreviewRenderer.js';
import { ScaledContent } from '../../../editor/components/merge-preview/ScaledContent.js';
import { ViewModeSelector } from '../../../editor/components/merge-preview/ViewModeSelector.js';
import type { ViewMode } from '../../../editor/components/merge-preview/ViewModeSelector.js';
import { CherryPickVisualPanel } from './CherryPickVisualPanel.js';
import { ResolutionStrategyPicker } from './ResolutionStrategyPicker.js';

export interface DocumentResolutionDetailProps {
  document: DocumentResolution | null;
  sourceBranchName: string;
  targetBranchName: string;
  onSetStrategy: (documentId: string, strategy: DocumentResolutionStrategy) => void;
  onCherryPickSelection: (
    documentId: string,
    componentId: string,
    propName: string,
    choice: 'source' | 'target'
  ) => void;
  onAcceptAllComponentProps: (
    documentId: string,
    componentId: string,
    choice: 'source' | 'target'
  ) => void;
  /** Puck config for <Render> */
  config?: unknown;
  /** Pre-computed diffs for this document */
  diffs?: ComponentDiffWithPosition[];
}

const baseClass = 'document-resolution-detail';

// =============================================================================
// Inline Style Constants
// =============================================================================

const detailHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '16px',
  flexWrap: 'wrap',
};

const singlePanelContainerStyle: React.CSSProperties = {
  position: 'relative',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
  maxWidth: '50%',
};

const singlePanelLabelStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: '13px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
};

const singlePanelContentStyle: React.CSSProperties = {
  padding: '12px',
};

const overlayMessageStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.7)',
  fontSize: '16px',
  fontWeight: 600,
  color: '#6b7280',
  pointerEvents: 'none',
};

const noContentStyle: React.CSSProperties = {
  padding: '40px',
  textAlign: 'center',
  color: '#999',
  fontStyle: 'italic',
};

// =============================================================================
// Private Helper Components
// =============================================================================

function getDeleteMessage(conflictType: DocumentConflictType): string | null {
  if (conflictType === 'deleted-in-source') {
    return 'This document was deleted in Draft.';
  }
  if (conflictType === 'deleted-in-target') {
    return 'This document was deleted in Live.';
  }
  return null;
}

/**
 * StrategyEmphasisWrapper: wraps MergePreviewRenderer and applies visual
 * emphasis for accept-draft and accept-live strategies.
 * Uses DOM queries to position dimming overlays on the non-selected panel.
 */
function StrategyEmphasisWrapper({
  strategy,
  children,
}: {
  strategy: 'accept-draft' | 'accept-live';
  children: React.ReactNode;
}): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [panelRects, setPanelRects] = useState<DOMRect[]>([]);

  const updatePanelRects = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const panels = wrapper.querySelectorAll('.merge-preview-renderer__panel');
    if (panels.length < 2) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const rects = Array.from(panels).map((panel) => {
      const r = panel.getBoundingClientRect();
      return new DOMRect(
        r.left - wrapperRect.left,
        r.top - wrapperRect.top,
        r.width,
        r.height,
      );
    });
    setPanelRects(rects);
  }, []);

  useEffect(() => {
    updatePanelRects();
    window.addEventListener('resize', updatePanelRects);
    return () => window.removeEventListener('resize', updatePanelRects);
  }, [updatePanelRects]);

  // Panel 0 = source (Draft), Panel 1 = target (Live)
  // accept-draft: highlight panel 0 (Draft), dim panel 1 (Live)
  // accept-live: highlight panel 1 (Live), dim panel 0 (Draft)
  const highlightIndex = strategy === 'accept-draft' ? 0 : 1;
  const dimIndex = strategy === 'accept-draft' ? 1 : 0;

  return (
    <div
      ref={wrapperRef}
      className="strategy-emphasis-wrapper"
      style={{ position: 'relative' }}
    >
      {children}

      {/* Dimming overlay on non-selected panel */}
      {panelRects[dimIndex] && (
        <div
          className="strategy-emphasis-wrapper__dim-overlay"
          data-testid="strategy-dim-overlay"
          style={{
            position: 'absolute',
            top: panelRects[dimIndex].y,
            left: panelRects[dimIndex].x,
            width: panelRects[dimIndex].width,
            height: panelRects[dimIndex].height,
            background: 'rgba(255,255,255,0.5)',
            pointerEvents: 'none',
            borderRadius: '8px',
          }}
        />
      )}

      {/* Highlight border on selected panel */}
      {panelRects[highlightIndex] && (
        <div
          className="strategy-emphasis-wrapper__highlight"
          data-testid="strategy-highlight"
          style={{
            position: 'absolute',
            top: panelRects[highlightIndex].y,
            left: panelRects[highlightIndex].x,
            width: panelRects[highlightIndex].width,
            height: panelRects[highlightIndex].height,
            border: '2px solid #22c55e',
            borderRadius: '8px',
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function DocumentResolutionDetail({
  document: doc,
  sourceBranchName,
  targetBranchName,
  onSetStrategy,
  onCherryPickSelection,
  onAcceptAllComponentProps,
  config,
  diffs = [],
}: DocumentResolutionDetailProps): React.ReactElement {
  const hasConfig = config != null;
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');

  if (!doc) {
    return (
      <div className={baseClass} data-testid="merge-resolution-detail" style={{ padding: 0 }}>
        <p className={`${baseClass}__empty`} style={{
          color: '#999',
          fontStyle: 'italic',
          textAlign: 'center',
          padding: '40px 20px',
        }}>
          Select a document to view details.
        </p>
      </div>
    );
  }

  const isConflicting = doc.changeType === 'conflicting';
  const isDeletedOnMain = doc.changeType === 'deleted-on-main';
  const isDraftChanged = doc.changeType === 'draft-changed';
  const isNewOnDraft = doc.changeType === 'new-on-draft';
  const isDeletedOnDraft = doc.changeType === 'deleted-on-draft';

  const deleteMessage = isConflicting ? getDeleteMessage(doc.conflictType) : null;
  // Tombstone snapshots ({ _deleted: true }) have no Puck content — treat them
  // as absent so the single-panel "Deleted in Draft/Live" view fires correctly.
  const hasPuckContent = (s: unknown): boolean =>
    !!s && typeof s === 'object' && Array.isArray((s as { content?: unknown }).content);
  const hasBothSnapshots = hasPuckContent(doc.sourceSnapshot) && hasPuckContent(doc.targetSnapshot);
  const hasSourceOnly = hasPuckContent(doc.sourceSnapshot) && !hasPuckContent(doc.targetSnapshot);
  const hasTargetOnly = !hasPuckContent(doc.sourceSnapshot) && hasPuckContent(doc.targetSnapshot);
  const hasNeitherSnapshot = !hasPuckContent(doc.sourceSnapshot) && !hasPuckContent(doc.targetSnapshot);

  // Show ViewModeSelector for comparisons (conflicts and non-conflicting changes with both snapshots)
  const showViewModeSelector = hasBothSnapshots && (isConflicting || isDraftChanged);

  return (
    <div className={baseClass} data-testid="merge-resolution-detail" style={{ padding: 0 }}>
      {/* Header with path, change type indicator, and view mode selector */}
      <div className={`${baseClass}__header`} style={detailHeaderStyle}>
        <h3 className={`${baseClass}__path`} style={{
          fontSize: '18px',
          fontWeight: 600,
          margin: 0,
          color: '#333',
          flex: '1 1 auto',
        }}>
          {doc.documentPath}
        </h3>

        {showViewModeSelector && (
          <ViewModeSelector
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        )}
      </div>

      {/* ================================================================= */}
      {/* CONFLICTING documents: full resolution UI                         */}
      {/* ================================================================= */}
      {(isConflicting || isDeletedOnMain) && (
        <>
          <ResolutionStrategyPicker
            currentStrategy={doc.strategy}
            conflictType={doc.conflictType}
            onSelect={(strategy) => onSetStrategy(doc.documentId, strategy)}
          />

          {deleteMessage && (
            <InlineMessage type="warning" title={deleteMessage} />
          )}

          {/* Strategy banners */}
          {doc.strategy === 'accept-draft' && hasBothSnapshots && (
            <InlineMessage type="success" title="Draft version will be kept." />
          )}
          {doc.strategy === 'accept-live' && hasBothSnapshots && (
            <InlineMessage type="info" title="Live version will be kept." />
          )}
          {doc.strategy === 'unresolved' && hasBothSnapshots && (
            <InlineMessage type="warning" title="Select a resolution strategy above." />
          )}

          {/* accept-draft / accept-live with emphasis */}
          {(doc.strategy === 'accept-draft' || doc.strategy === 'accept-live') && hasBothSnapshots && hasConfig && (
            <StrategyEmphasisWrapper strategy={doc.strategy}>
              <MergePreviewRenderer
                sourceData={doc.sourceSnapshot as PuckData}
                targetData={doc.targetSnapshot as PuckData}
                diffs={diffs}
                config={config}
                viewMode={viewMode}
                sourceBranchName={sourceBranchName}
                targetBranchName={targetBranchName}
              />
            </StrategyEmphasisWrapper>
          )}

          {/* unresolved: MergePreviewRenderer without emphasis */}
          {doc.strategy === 'unresolved' && hasBothSnapshots && hasConfig && (
            <MergePreviewRenderer
              sourceData={doc.sourceSnapshot as PuckData}
              targetData={doc.targetSnapshot as PuckData}
              diffs={diffs}
              config={config}
              viewMode={viewMode}
              sourceBranchName={sourceBranchName}
              targetBranchName={targetBranchName}
            />
          )}

          {/* cherry-pick */}
          {doc.strategy === 'cherry-pick' && hasBothSnapshots && hasConfig && (
            <CherryPickVisualPanel
              document={doc}
              config={config}
              diffs={diffs}
              sourceBranchName={sourceBranchName}
              targetBranchName={targetBranchName}
              onCherryPickSelection={onCherryPickSelection}
              onAcceptAllComponentProps={onAcceptAllComponentProps}
            />
          )}

          {/* cherry-pick without config: fallback */}
          {doc.strategy === 'cherry-pick' && !hasConfig && doc.classifiedFields && (
            <div className={`${baseClass}__cherry-pick-fallback`} style={{ marginTop: '16px' }}>
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
                {doc.classifiedFields.filter((f) => f.classification !== 'conflicting').length > 0 &&
                  `${doc.classifiedFields.filter((f) => f.classification !== 'conflicting').length} fields auto-merged`}
              </p>
            </div>
          )}

          {/* Single snapshot views for delete conflicts */}
          {hasTargetOnly && hasConfig && (
            <div className={`${baseClass}__single-panel`} style={singlePanelContainerStyle}>
              <div className={`${baseClass}__single-panel-label`} style={singlePanelLabelStyle}>
                {targetBranchName}
              </div>
              <div className={`${baseClass}__single-panel-content`} style={singlePanelContentStyle}>
                <ScaledContent>
                  <Render
                    config={config as Parameters<typeof Render>[0]['config']}
                    data={doc.targetSnapshot as Parameters<typeof Render>[0]['data']}
                  />
                </ScaledContent>
              </div>
              <div className={`${baseClass}__overlay-message`} style={overlayMessageStyle}>
                Deleted in Draft
              </div>
            </div>
          )}

          {hasSourceOnly && hasConfig && (
            <div className={`${baseClass}__single-panel`} style={singlePanelContainerStyle}>
              <div className={`${baseClass}__single-panel-label`} style={singlePanelLabelStyle}>
                {sourceBranchName}
              </div>
              <div className={`${baseClass}__single-panel-content`} style={singlePanelContentStyle}>
                <ScaledContent>
                  <Render
                    config={config as Parameters<typeof Render>[0]['config']}
                    data={doc.sourceSnapshot as Parameters<typeof Render>[0]['data']}
                  />
                </ScaledContent>
              </div>
              <div className={`${baseClass}__overlay-message`} style={overlayMessageStyle}>
                New document
              </div>
            </div>
          )}

          {hasNeitherSnapshot && (
            <div className={`${baseClass}__no-content`} style={noContentStyle}>
              No content available
            </div>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* CHANGED documents: comparison tools, no resolution needed          */}
      {/* ================================================================= */}
      {isDraftChanged && (
        <>
          <InlineMessage type="info" title="Changed on Draft. No conflict to resolve." />

          {hasBothSnapshots && hasConfig && (
            <MergePreviewRenderer
              sourceData={doc.sourceSnapshot as PuckData}
              targetData={doc.targetSnapshot as PuckData}
              diffs={diffs}
              config={config}
              viewMode={viewMode}
              sourceBranchName={sourceBranchName}
              targetBranchName={targetBranchName}
            />
          )}

          {hasSourceOnly && hasConfig && (
            <div className={`${baseClass}__single-panel`} style={singlePanelContainerStyle}>
              <div className={`${baseClass}__single-panel-label`} style={singlePanelLabelStyle}>
                {sourceBranchName}
              </div>
              <div className={`${baseClass}__single-panel-content`} style={singlePanelContentStyle}>
                <ScaledContent>
                  <Render
                    config={config as Parameters<typeof Render>[0]['config']}
                    data={doc.sourceSnapshot as Parameters<typeof Render>[0]['data']}
                  />
                </ScaledContent>
              </div>
            </div>
          )}

          {!hasBothSnapshots && !hasSourceOnly && !doc.targetSnapshot && (
            <div className={`${baseClass}__no-content`} style={noContentStyle}>
              Document preview not available
            </div>
          )}

          {!hasBothSnapshots && !hasSourceOnly && doc.targetSnapshot && hasConfig && (
            <div className={`${baseClass}__single-panel`} style={singlePanelContainerStyle}>
              <div className={`${baseClass}__single-panel-label`} style={singlePanelLabelStyle}>
                {targetBranchName}
              </div>
              <div className={`${baseClass}__single-panel-content`} style={singlePanelContentStyle}>
                <ScaledContent>
                  <Render
                    config={config as Parameters<typeof Render>[0]['config']}
                    data={doc.targetSnapshot as Parameters<typeof Render>[0]['data']}
                  />
                </ScaledContent>
              </div>
            </div>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* ADDED documents: preview only                                     */}
      {/* ================================================================= */}
      {isNewOnDraft && (
        <>
          <InlineMessage type="success" title="New document created on Draft." />

          {doc.sourceSnapshot && hasConfig && (
            <div className={`${baseClass}__single-panel`} style={singlePanelContainerStyle}>
              <div className={`${baseClass}__single-panel-label`} style={singlePanelLabelStyle}>
                {sourceBranchName} (new)
              </div>
              <div className={`${baseClass}__single-panel-content`} style={singlePanelContentStyle}>
                <ScaledContent>
                  <Render
                    config={config as Parameters<typeof Render>[0]['config']}
                    data={doc.sourceSnapshot as Parameters<typeof Render>[0]['data']}
                  />
                </ScaledContent>
              </div>
            </div>
          )}

          {!doc.sourceSnapshot && (
            <div className={`${baseClass}__no-content`} style={noContentStyle}>
              Document preview not available
            </div>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* DELETED documents: path only                                      */}
      {/* ================================================================= */}
      {isDeletedOnDraft && (
        <>
          <InlineMessage type="warning" title="Deleted on Draft. This document will be removed from Live." />

          {doc.targetSnapshot && hasConfig && (
            <div className={`${baseClass}__single-panel`} style={singlePanelContainerStyle}>
              <div className={`${baseClass}__single-panel-label`} style={singlePanelLabelStyle}>
                {targetBranchName} (will be deleted)
              </div>
              <div className={`${baseClass}__single-panel-content`} style={singlePanelContentStyle}>
                <ScaledContent>
                  <Render
                    config={config as Parameters<typeof Render>[0]['config']}
                    data={doc.targetSnapshot as Parameters<typeof Render>[0]['data']}
                  />
                </ScaledContent>
              </div>
            </div>
          )}

          {!doc.targetSnapshot && (
            <div className={`${baseClass}__no-content`} style={noContentStyle}>
              Published version preview not available
            </div>
          )}
        </>
      )}
    </div>
  );
}
