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

  useEffect(() => {
    hook.loadPreview();
  }, [hook.loadPreview]);

  const handleExecuteMerge = useCallback(() => {
    hook.executeMerge();
  }, [hook.executeMerge]);

  const handleCreateMergeRequest = useCallback(() => {
    hook.createMergeRequest();
  }, [hook.createMergeRequest]);

  const handleApproveMergeRequest = useCallback(() => {
    hook.approveMergeRequest();
  }, [hook.approveMergeRequest]);

  const conflictCount = useMemo(
    () =>
      hook.documents.filter(
        (d) => d.changeType === 'conflicting' || d.changeType === 'deleted-on-main',
      ).length,
    [hook.documents],
  );

  useEffect(() => {
    if (hook.mergeSuccess && onMergeComplete) {
      onMergeComplete();
    }
  }, [hook.mergeSuccess, onMergeComplete]);

  const documentDiffs = useMemo(() => {
    const diffsMap = new Map<string, ComponentDiffWithPosition[]>();
    for (const doc of hook.documents) {
      if (doc.sourceSnapshot && doc.targetSnapshot) {
        diffsMap.set(
          doc.documentId,
          diffPuckDataWithPositions(doc.sourceSnapshot, doc.targetSnapshot),
        );
      }
    }
    return diffsMap;
  }, [hook.documents]);

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

  const currentDiffs = hook.currentDocument
    ? documentDiffs.get(hook.currentDocument.documentId) ?? []
    : [];

  const toolbarProps = {
    sourceBranchName,
    targetBranchName,
    resolvedCount: hook.resolvedCount,
    totalCount: hook.totalCount,
    conflictCount,
    allResolved: hook.allResolved,
    mergeExecuting: hook.mergeExecuting,
    onClose,
    onExecuteMerge: handleExecuteMerge,
    onSetAllStrategy: hook.setAllStrategy,
    onSetRemainingStrategy: hook.setRemainingStrategy,
    mergeRequest: hook.mergeRequest,
    mergeRequestCreating: hook.mergeRequestCreating,
    mergeRequestError: hook.mergeRequestError,
    onCreateMergeRequest: handleCreateMergeRequest,
    onApproveMergeRequest: handleApproveMergeRequest,
  };

  if (hook.previewLoading) {
    return (
      <div className={baseClass} data-testid="merge-resolution-page">
        <MergeResolutionToolbar
          {...toolbarProps}
          resolvedCount={0}
          totalCount={0}
          allResolved={false}
          mergeExecuting={false}
          onExecuteMerge={() => {}}
          onSetAllStrategy={() => {}}
        />
        <p className={`${baseClass}__loading`}>Loading merge preview…</p>
      </div>
    );
  }

  if (hook.previewError) {
    return (
      <div className={baseClass} data-testid="merge-resolution-page">
        <MergeResolutionToolbar
          {...toolbarProps}
          resolvedCount={0}
          totalCount={0}
          allResolved={false}
          mergeExecuting={false}
          onExecuteMerge={() => {}}
          onSetAllStrategy={() => {}}
        />
        <p className={`${baseClass}__error`}>{hook.previewError}</p>
      </div>
    );
  }

  return (
    <div className={baseClass} data-testid="merge-resolution-page">
      <MergeResolutionToolbar {...toolbarProps} />

      {hook.mergeError && (
        <p className={`${baseClass}__merge-error`} role="alert">
          {hook.mergeError}
        </p>
      )}

      {hook.mergeSuccess && (
        <p className={`${baseClass}__merge-success`} role="status">
          Merge completed successfully.
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
            diffCounts={diffCounts}
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
            config={config}
            diffs={currentDiffs}
          />
        </div>
      </div>
    </div>
  );
}
