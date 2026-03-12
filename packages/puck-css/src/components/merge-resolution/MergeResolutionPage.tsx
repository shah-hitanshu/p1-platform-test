/**
 * MergeResolutionPage Component
 *
 * Top-level page for multi-document merge conflict resolution.
 * Composes toolbar, document list, and detail panel.
 */

import React, { useEffect } from 'react';
import type { CSSClient } from '@pantheon/css-client';
import { useMergeResolution } from '../../hooks/useMergeResolution.js';
import { MergeResolutionToolbar } from './MergeResolutionToolbar.js';
import { DocumentResolutionList } from './DocumentResolutionList.js';
import { DocumentResolutionDetail } from './DocumentResolutionDetail.js';

export interface MergeResolutionPageProps {
  client: CSSClient;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  sourceBranchName: string;
  targetBranchName: string;
  /** Puck config for rendering previews. Reserved for future Puck Render integration. */
  config: unknown;
  onClose: () => void;
  onMergeComplete?: () => void;
}

const baseClass = 'merge-resolution-page';

export function MergeResolutionPage({
  client,
  siteId,
  sourceBranchId,
  targetBranchId,
  sourceBranchName,
  targetBranchName,
  // config is accepted for future Puck Render integration
  config: _config,
  onClose,
  onMergeComplete,
}: MergeResolutionPageProps): React.ReactElement {
  // Suppress unused variable lint error for config
  void _config;

  const hook = useMergeResolution({
    client,
    siteId,
    sourceBranchId,
    targetBranchId,
    sourceBranchName,
    targetBranchName,
  });

  // Load preview on mount
  useEffect(() => {
    hook.loadPreview();
  }, [hook.loadPreview]);

  // Notify parent on successful merge
  useEffect(() => {
    if (hook.mergeSuccess && onMergeComplete) {
      onMergeComplete();
    }
  }, [hook.mergeSuccess, onMergeComplete]);

  // Loading state
  if (hook.previewLoading) {
    return (
      <div className={baseClass}>
        <MergeResolutionToolbar
          sourceBranchName={sourceBranchName}
          targetBranchName={targetBranchName}
          resolvedCount={0}
          totalCount={0}
          allResolved={false}
          mergeExecuting={false}
          onClose={onClose}
          onExecuteMerge={() => {}}
          onSetAllStrategy={() => {}}
        />
        <p className={`${baseClass}__loading`}>Loading merge preview...</p>
      </div>
    );
  }

  // Error state
  if (hook.previewError) {
    return (
      <div className={baseClass}>
        <MergeResolutionToolbar
          sourceBranchName={sourceBranchName}
          targetBranchName={targetBranchName}
          resolvedCount={0}
          totalCount={0}
          allResolved={false}
          mergeExecuting={false}
          onClose={onClose}
          onExecuteMerge={() => {}}
          onSetAllStrategy={() => {}}
        />
        <p className={`${baseClass}__error`}>{hook.previewError}</p>
      </div>
    );
  }

  return (
    <div className={baseClass}>
      <MergeResolutionToolbar
        sourceBranchName={sourceBranchName}
        targetBranchName={targetBranchName}
        resolvedCount={hook.resolvedCount}
        totalCount={hook.totalCount}
        allResolved={hook.allResolved}
        mergeExecuting={hook.mergeExecuting}
        onClose={onClose}
        onExecuteMerge={() => hook.executeMerge()}
        onSetAllStrategy={hook.setAllStrategy}
      />

      {hook.mergeError && (
        <p className={`${baseClass}__merge-error`} role="alert">
          {hook.mergeError}
        </p>
      )}

      <div className={`${baseClass}__content`}>
        <div className={`${baseClass}__list`}>
          <DocumentResolutionList
            documents={hook.documents}
            currentIndex={hook.currentIndex}
            goToNext={hook.goToNext}
            goToPrevious={hook.goToPrevious}
            goToNextUnresolved={hook.goToNextUnresolved}
            goToDocument={hook.goToDocument}
            setStrategy={hook.setStrategy}
            setRemainingStrategy={hook.setRemainingStrategy}
          />
        </div>

        <div className={`${baseClass}__detail`}>
          <DocumentResolutionDetail
            document={hook.currentDocument}
            sourceBranchName={sourceBranchName}
            targetBranchName={targetBranchName}
            onSetStrategy={hook.setStrategy}
            onCherryPickSelection={hook.setCherryPickSelection}
            onAcceptAllComponentProps={hook.acceptAllComponentProps}
            onFetchCrdtPreview={hook.fetchCrdtPreview}
          />
        </div>
      </div>
    </div>
  );
}
