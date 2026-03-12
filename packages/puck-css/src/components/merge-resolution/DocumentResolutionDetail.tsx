/**
 * DocumentResolutionDetail Component
 *
 * Expanded view for a single document showing strategy options,
 * cherry-pick field selection via ComponentConflictGroup, CRDT preview
 * via CrdtPreviewPanel, and delete-type conflict messages.
 */

import React, { useEffect } from 'react';
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
  onFetchCrdtPreview: (documentId: string) => Promise<void> | void;
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

/**
 * Auto-fetches CRDT preview when strategy changes to crdt-preview.
 * Fires once when the component mounts (i.e., strategy just became crdt-preview)
 * and there is no existing snapshot, loading state, or error.
 */
function CrdtAutoFetcher({
  documentId,
  hasSnapshot,
  isLoading,
  hasError,
  onFetch,
}: {
  documentId: string;
  hasSnapshot: boolean;
  isLoading: boolean;
  hasError: boolean;
  onFetch: (documentId: string) => Promise<void> | void;
}): null {
  // Track whether we've already triggered a fetch for this documentId
  const hasFetchedRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (
      hasFetchedRef.current !== documentId &&
      !hasSnapshot &&
      !isLoading &&
      !hasError
    ) {
      hasFetchedRef.current = documentId;
      onFetch(documentId);
    }
  }, [documentId, hasSnapshot, isLoading, hasError, onFetch]);

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
                resolutions={
                  // Transform cherryPickSelections from "componentId:propName" keys
                  // to bare "propName" keys, filtered for this component group
                  Object.fromEntries(
                    Object.entries(document.cherryPickSelections)
                      .filter(([k]) => k.startsWith(`${group.componentId}:`))
                      .map(([k, v]) => [k.split(':').slice(1).join(':'), v])
                  )
                }
                onResolutionChange={(componentId, propName, choice) =>
                  onCherryPickSelection(document.documentId, componentId, propName, choice)
                }
              />
            </div>
          ))}
        </div>
      )}

      {document.strategy === 'crdt-preview' && (
        <CrdtAutoFetcher
          documentId={document.documentId}
          hasSnapshot={!!document.crdtPreviewSnapshot}
          isLoading={document.crdtPreviewLoading}
          hasError={!!document.crdtPreviewError}
          onFetch={onFetchCrdtPreview}
        />
      )}

      {document.strategy === 'crdt-preview' && (
        <div className={`${baseClass}__crdt-preview`}>
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
