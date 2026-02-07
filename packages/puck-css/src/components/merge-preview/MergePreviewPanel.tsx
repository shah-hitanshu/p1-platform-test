/**
 * MergePreviewPanel Component
 *
 * Plugin panel that displays a list of documents with diff summaries.
 * Selecting a document expands it to show the ViewModeSelector and
 * MergePreviewRenderer with visual diff highlighting.
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { DocumentDiffSummary } from '../../utils/branchDiff.js';
import { createBranchDocumentComparison } from '../../utils/branchDiff.js';
import type { PuckData } from '@pantheon/css-client';
import { ViewModeSelector } from './ViewModeSelector.js';
import type { ViewMode } from './ViewModeSelector.js';
import { MergePreviewRenderer } from './MergePreviewRenderer.js';

/**
 * Props for the MergePreviewPanel component.
 */
export interface MergePreviewPanelProps {
  /** Array of document summaries to display for comparison. */
  documents: DocumentDiffSummary[];

  /** Name of the source branch. */
  sourceBranchName: string;

  /** Name of the target branch. */
  targetBranchName: string;

  /** Puck configuration for rendering components. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;

  /** Callback when a document is selected. */
  onDocumentSelect?: (documentId: string) => void;
}

/**
 * Panel component for previewing merge diffs across multiple documents.
 *
 * Shows a list of documents with their paths. Clicking a document expands
 * it to show a view mode selector and the rendered diff preview.
 *
 * @example
 * ```tsx
 * <MergePreviewPanel
 *   documents={documents}
 *   sourceBranchName="feature"
 *   targetBranchName="main"
 *   config={puckConfig}
 *   onDocumentSelect={(id) => console.log('Selected:', id)}
 * />
 * ```
 */
export function MergePreviewPanel({
  documents,
  sourceBranchName,
  targetBranchName,
  config,
  onDocumentSelect,
}: MergePreviewPanelProps): React.ReactElement {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');

  const handleDocumentClick = useCallback(
    (documentId: string) => {
      setSelectedDocumentId(documentId);
      onDocumentSelect?.(documentId);
    },
    [onDocumentSelect],
  );

  const selectedDocument = useMemo(
    () => documents.find((doc) => doc.documentId === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );

  const comparison = useMemo(() => {
    if (!selectedDocument) return null;
    return createBranchDocumentComparison(
      selectedDocument.documentId,
      selectedDocument.documentPath,
      selectedDocument.sourceSnapshot,
      selectedDocument.targetSnapshot,
    );
  }, [selectedDocument]);

  return (
    <div className="merge-preview-panel">
      <h3 className="merge-preview-panel__title">Merge Preview</h3>
      <div className="merge-preview-panel__branch-info">
        <span className="merge-preview-panel__branch">{sourceBranchName}</span>
        <span className="merge-preview-panel__arrow">{'\u2192'}</span>
        <span className="merge-preview-panel__branch">{targetBranchName}</span>
      </div>

      {documents.length === 0 ? (
        <div className="merge-preview-panel__empty">No documents</div>
      ) : (
        <ul className="merge-preview-panel__document-list">
          {documents.map((doc) => {
            const isExpanded = selectedDocumentId === doc.documentId;

            return (
              <li key={doc.documentId} className="merge-preview-document">
                <button
                  type="button"
                  className={`merge-preview-document__row ${
                    isExpanded ? 'merge-preview-document__row--expanded' : ''
                  }`}
                  onClick={() => handleDocumentClick(doc.documentId)}
                >
                  <span className="merge-preview-document__path">
                    {doc.documentPath}
                  </span>
                </button>

                {isExpanded && comparison && (
                  <div className="merge-preview-document__detail">
                    <ViewModeSelector
                      viewMode={viewMode}
                      onViewModeChange={setViewMode}
                    />
                    <MergePreviewRenderer
                      sourceData={selectedDocument!.sourceSnapshot as PuckData}
                      targetData={selectedDocument!.targetSnapshot as PuckData}
                      diffs={comparison.diffs}
                      config={config}
                      viewMode={viewMode}
                      sourceBranchName={sourceBranchName}
                      targetBranchName={targetBranchName}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
