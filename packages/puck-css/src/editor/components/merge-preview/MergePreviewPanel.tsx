import React, { useState, useCallback, useMemo } from 'react';
import { IconButton } from '@pantheon-systems/pds-toolkit-react';
import type { PuckData } from '@pantheon-systems/css-client';
import type { DocumentDiffSummary } from '../../../versioning/utils/branchDiff.js';
import { createBranchDocumentComparison, isPuckData, EMPTY_PUCK_DATA } from '../../../versioning/utils/branchDiff.js';
import { ViewModeSelector } from './ViewModeSelector.js';
import type { ViewMode } from './ViewModeSelector.js';
import { MergePreviewRenderer } from './MergePreviewRenderer.js';

export interface MergePreviewPanelProps {
  documents: DocumentDiffSummary[];
  sourceBranchName: string;
  targetBranchName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  onDocumentSelect?: (documentId: string) => void;
  /** Hide the internal "Merge preview" title and branch info (for use in a host with its own header). */
  hideHeader?: boolean;
}

export function MergePreviewPanel({
  documents,
  sourceBranchName,
  targetBranchName,
  config,
  onDocumentSelect,
  hideHeader = false,
}: MergePreviewPanelProps): React.ReactElement {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');

  const handleDocumentClick = useCallback(
    (documentId: string) => {
      setSelectedDocumentId((prev) => {
        const next = prev === documentId ? null : documentId;
        if (next !== null) onDocumentSelect?.(documentId);
        return next;
      });
    },
    [onDocumentSelect],
  );

  const handleClose = useCallback(() => {
    setSelectedDocumentId(null);
  }, []);

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
      {!hideHeader && (
        <>
          <h3 className="merge-preview-panel__title">Merge preview</h3>
          <div className="merge-preview-panel__branch-info">
            <span className="merge-preview-panel__branch">{sourceBranchName}</span>
            <span className="merge-preview-panel__arrow">{'\u2192'}</span>
            <span className="merge-preview-panel__branch">{targetBranchName}</span>
          </div>
        </>
      )}

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
                    <div className="merge-preview-document__detail-header">
                      <span className="merge-preview-document__detail-path">
                        {doc.documentPath}
                      </span>
                      <IconButton
                        ariaLabel="Close preview"
                        iconName="xmark"
                        size="s"
                        hasTooltip={false}
                        hasBorder={false}
                        onClick={handleClose}
                      />
                    </div>
                    <div className="merge-preview-document__detail-body">
                      <ViewModeSelector
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                      />
                      <MergePreviewRenderer
                        sourceData={selectedDocument && isPuckData(selectedDocument.sourceSnapshot) ? selectedDocument.sourceSnapshot as PuckData : EMPTY_PUCK_DATA}
                        targetData={selectedDocument && isPuckData(selectedDocument.targetSnapshot) ? selectedDocument.targetSnapshot as PuckData : EMPTY_PUCK_DATA}
                        diffs={comparison.diffs}
                        config={config}
                        viewMode={viewMode}
                        sourceBranchName={sourceBranchName}
                        targetBranchName={targetBranchName}
                      />
                    </div>
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
