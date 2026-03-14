/**
 * MergeResolutionPage Component
 *
 * Top-level page for multi-document merge conflict resolution.
 * Composes toolbar, document list, and detail panel.
 *
 * Computes per-document diffs and threads config + diffs to children.
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import type { CSSClient } from '@pantheon/css-client';
import { useMergeResolution } from '../../hooks/useMergeResolution.js';
import { diffPuckDataWithPositions } from '../../utils/diff.js';
import type { ComponentDiffWithPosition } from '../../types.js';
import { MergeResolutionToolbar } from './MergeResolutionToolbar.js';
import { DocumentResolutionList } from './DocumentResolutionList.js';
import type { DiffCounts } from './DocumentResolutionList.js';
import { DocumentResolutionDetail } from './DocumentResolutionDetail.js';

export interface MergeResolutionPageProps {
  client: CSSClient;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  sourceBranchName: string;
  targetBranchName: string;
  /** Puck config for rendering previews. */
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
  config,
  onClose,
  onMergeComplete,
}: MergeResolutionPageProps): React.ReactElement {
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

  // Stable callbacks to avoid re-renders
  const handleExecuteMerge = useCallback(() => {
    hook.executeMerge();
  }, [hook.executeMerge]);

  const handleCreateMergeRequest = useCallback(() => {
    hook.createMergeRequest();
  }, [hook.createMergeRequest]);

  const handleApproveMergeRequest = useCallback(() => {
    hook.approveMergeRequest();
  }, [hook.approveMergeRequest]);

  // Count actual conflicts (not auto-merged changes)
  const conflictCount = useMemo(
    () => hook.documents.filter((d) => d.changeType === 'conflicting' || d.changeType === 'deleted-on-main').length,
    [hook.documents]
  );

  // Notify parent on successful merge
  useEffect(() => {
    if (hook.mergeSuccess && onMergeComplete) {
      onMergeComplete();
    }
  }, [hook.mergeSuccess, onMergeComplete]);

  // Compute per-document diffs
  const documentDiffs = useMemo(() => {
    const diffsMap = new Map<string, ComponentDiffWithPosition[]>();
    for (const doc of hook.documents) {
      if (doc.sourceSnapshot && doc.targetSnapshot) {
        diffsMap.set(
          doc.documentId,
          diffPuckDataWithPositions(doc.sourceSnapshot, doc.targetSnapshot)
        );
      }
    }
    return diffsMap;
  }, [hook.documents]);

  // Derive diff counts for the list
  const diffCounts = useMemo(() => {
    const counts = new Map<string, DiffCounts>();
    for (const [docId, diffs] of documentDiffs) {
      const count: DiffCounts = { added: 0, removed: 0, modified: 0 };
      for (const diff of diffs) {
        if (diff.type === 'added') count.added++;
        else if (diff.type === 'removed') count.removed++;
        else if (diff.type === 'modified') count.modified++;
      }
      counts.set(docId, count);
    }
    return counts;
  }, [documentDiffs]);

  // Get diffs for the currently selected document
  const currentDiffs = hook.currentDocument
    ? documentDiffs.get(hook.currentDocument.documentId) || []
    : [];

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
        conflictCount={conflictCount}
        allResolved={hook.allResolved}
        mergeExecuting={hook.mergeExecuting}
        onClose={onClose}
        onExecuteMerge={handleExecuteMerge}
        onSetAllStrategy={hook.setAllStrategy}
        onSetRemainingStrategy={hook.setRemainingStrategy}
        mergeRequest={hook.mergeRequest}
        mergeRequestCreating={hook.mergeRequestCreating}
        mergeRequestError={hook.mergeRequestError}
        onCreateMergeRequest={handleCreateMergeRequest}
        onApproveMergeRequest={handleApproveMergeRequest}
      />

      {hook.mergeError && (
        <p className={`${baseClass}__merge-error`} role="alert" style={{ background: '#fde8e8', color: '#c53030', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {hook.mergeError}
        </p>
      )}

      {hook.mergeSuccess && (
        <p className={`${baseClass}__merge-success`} role="status" style={{ background: '#d4edda', color: '#155724', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          Merge completed successfully.
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
            diffCounts={diffCounts}
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
            config={config}
            diffs={currentDiffs}
          />
        </div>
      </div>
    </div>
  );
}
