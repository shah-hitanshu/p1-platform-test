/**
 * DocumentResolutionDetail Component
 *
 * Expanded view for a single document showing strategy options,
 * cherry-pick field selection via ComponentConflictGroup, CRDT preview
 * via CrdtPreviewPanel, and delete-type conflict messages.
 */

import React from 'react';
import type { DocumentConflictType } from '@pantheon/css-client';
import type { DocumentResolution, DocumentResolutionStrategy } from '../../hooks/useMergeResolution.js';
import { groupFieldsByComponent } from '../../utils/puckFieldClassifier.js';
import { ResolutionStrategyPicker } from './ResolutionStrategyPicker.js';
import { CrdtPreviewPanel } from './CrdtPreviewPanel.js';
import { ComponentConflictGroup } from '../conflict-resolution/ComponentConflictGroup.js';

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
  onFetchCrdtPreview: (documentId: string) => void;
}

const baseClass = 'document-resolution-detail';

function getDeleteMessage(conflictType: DocumentConflictType): string | null {
  if (conflictType === 'deleted-in-source') {
    return 'This document was deleted in Draft.';
  }
  if (conflictType === 'deleted-in-target') {
    return 'This document was deleted in Live.';
  }
  return null;
}

export function DocumentResolutionDetail({
  document,
  sourceBranchName,
  targetBranchName,
  onSetStrategy,
  onCherryPickSelection,
  onAcceptAllComponentProps,
  onFetchCrdtPreview,
}: DocumentResolutionDetailProps): React.ReactElement {
  if (!document) {
    return (
      <div className={baseClass} data-testid="merge-resolution-detail">
        <p className={`${baseClass}__empty`}>Select a document to view details.</p>
      </div>
    );
  }

  const deleteMessage = getDeleteMessage(document.conflictType);
  const componentGroups = document.classifiedFields
    ? groupFieldsByComponent(document.classifiedFields)
    : [];

  // Count auto-merged (non-conflicting) fields
  const autoMergedCount = document.classifiedFields
    ? document.classifiedFields.filter((f) => f.classification !== 'conflicting').length
    : 0;

  return (
    <div className={baseClass} data-testid="merge-resolution-detail">
      <h3 className={`${baseClass}__path`}>{document.documentPath}</h3>

      <ResolutionStrategyPicker
        currentStrategy={document.strategy}
        conflictType={document.conflictType}
        onSelect={(strategy) => onSetStrategy(document.documentId, strategy)}
      />

      {deleteMessage && (
        <p className={`${baseClass}__delete-message`}>{deleteMessage}</p>
      )}

      {document.strategy === 'cherry-pick' && document.classifiedFields && (
        <div className={`${baseClass}__cherry-pick`}>
          {autoMergedCount > 0 && (
            <p className={`${baseClass}__auto-merged-count`}>
              {autoMergedCount} {autoMergedCount === 1 ? 'field' : 'fields'} auto-merged
            </p>
          )}

          {componentGroups.map((group) => (
            <div key={group.componentId} className={`${baseClass}__component-group`}>
              <div className={`${baseClass}__component-actions`}>
                <button
                  type="button"
                  className={`${baseClass}__component-accept-button`}
                  onClick={() =>
                    onAcceptAllComponentProps(document.documentId, group.componentId, 'source')
                  }
                >
                  Accept all from Draft
                </button>
                <button
                  type="button"
                  className={`${baseClass}__component-accept-button`}
                  onClick={() =>
                    onAcceptAllComponentProps(document.documentId, group.componentId, 'target')
                  }
                >
                  Accept all from Live
                </button>
              </div>
              <ComponentConflictGroup
                componentType={group.componentType}
                componentId={group.componentId}
                fields={group.fields}
                sourceBranchName={sourceBranchName}
                targetBranchName={targetBranchName}
                resolutions={document.cherryPickSelections}
                onResolutionChange={(componentId, propName, choice) =>
                  onCherryPickSelection(document.documentId, componentId, propName, choice)
                }
              />
            </div>
          ))}
        </div>
      )}

      {document.strategy === 'crdt-preview' && (
        <div className={`${baseClass}__crdt-preview`}>
          {!document.crdtPreviewSnapshot && !document.crdtPreviewLoading && !document.crdtPreviewError && (
            <button
              type="button"
              className={`${baseClass}__fetch-crdt-button`}
              onClick={() => onFetchCrdtPreview(document.documentId)}
            >
              Load CRDT preview
            </button>
          )}
          <CrdtPreviewPanel
            snapshot={document.crdtPreviewSnapshot}
            loading={document.crdtPreviewLoading}
            error={document.crdtPreviewError}
          />
        </div>
      )}
    </div>
  );
}
