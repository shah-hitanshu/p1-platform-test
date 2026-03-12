/**
 * DocumentResolutionDetail Component
 *
 * Expanded view for a single document showing strategy options,
 * cherry-pick/CRDT preview, and delete-type conflict messages.
 */

import React from 'react';
import type { DocumentConflictType } from '@pantheon/css-client';
import type { DocumentResolution, DocumentResolutionStrategy } from '../../hooks/useMergeResolution.js';
import { ResolutionStrategyPicker } from './ResolutionStrategyPicker.js';

export interface DocumentResolutionDetailProps {
  document: DocumentResolution | null;
  onSetStrategy: (documentId: string, strategy: DocumentResolutionStrategy) => void;
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
  onSetStrategy,
}: DocumentResolutionDetailProps): React.ReactElement {
  if (!document) {
    return (
      <div className={baseClass} data-testid="merge-resolution-detail">
        <p className={`${baseClass}__empty`}>Select a document to view details.</p>
      </div>
    );
  }

  const deleteMessage = getDeleteMessage(document.conflictType);

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
          <p>Cherry-pick mode: select individual props from Draft or Live.</p>
        </div>
      )}

      {document.strategy === 'crdt-preview' && (
        <div className={`${baseClass}__crdt-preview`}>
          {document.crdtPreviewLoading && <p>Loading CRDT preview...</p>}
          {document.crdtPreviewError && (
            <p className={`${baseClass}__error`}>{document.crdtPreviewError}</p>
          )}
          {document.crdtPreviewSnapshot && (
            <p>CRDT merge preview loaded.</p>
          )}
        </div>
      )}
    </div>
  );
}
