/**
 * MergeResolutionPage Component
 *
 * Top-level page for multi-document merge conflict resolution.
 * Composes toolbar, document list, and detail panel.
 */

import React, { useEffect, useCallback } from 'react';
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

  // Stable callback for execute merge to avoid re-renders
  const handleExecuteMerge = useCallback(() => {
    hook.executeMerge();
  }, [hook.executeMerge]);

  // Notify parent on successful merge
  useEffect(() => {
    if (hook.mergeSuccess && onMergeComplete) {
      onMergeComplete();
    }
  }, [hook.mergeSuccess, onMergeComplete]);

  // Loading state
  if (hook.previewLoading) {
    return (
      <div className={baseClass} style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24 }}>
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
        <p className={`${baseClass}__loading`} style={{ textAlign: 'center', color: '#666' }}>Loading merge preview...</p>
      </div>
    );
  }

  // Error state
  if (hook.previewError) {
    return (
      <div className={baseClass} style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24 }}>
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
        <p className={`${baseClass}__error`} style={{ background: '#fde8e8', color: '#c53030', padding: '12px 16px', borderRadius: 6 }}>{hook.previewError}</p>
      </div>
    );
  }

  return (
    <div className={baseClass} style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24 }}>
      <MergeResolutionToolbar
        sourceBranchName={sourceBranchName}
        targetBranchName={targetBranchName}
        resolvedCount={hook.resolvedCount}
        totalCount={hook.totalCount}
        allResolved={hook.allResolved}
        mergeExecuting={hook.mergeExecuting}
        onClose={onClose}
        onExecuteMerge={handleExecuteMerge}
        onSetAllStrategy={hook.setAllStrategy}
        onSetRemainingStrategy={hook.setRemainingStrategy}
      />

      {hook.mergeError && (
        <p className={`${baseClass}__merge-error`} role="alert" style={{ background: '#fde8e8', color: '#c53030', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {hook.mergeError}
        </p>
      )}

      <div className={`${baseClass}__content`} style={{ display: 'flex', flexDirection: 'row', gap: 0 }}>
        <div className={`${baseClass}__list`} style={{ width: 320, flexShrink: 0, overflowY: 'auto', maxHeight: 'calc(100vh - 200px)', borderRight: '1px solid #e5e7eb' }}>
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

        <div className={`${baseClass}__detail`} style={{ flexGrow: 1, overflowY: 'auto', paddingLeft: 24 }}>
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
