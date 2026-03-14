/**
 * MergeReviewPage Component
 *
 * Self-contained merge entry point for consuming apps. Handles branch
 * selection, authentication, and transitions to MergeResolutionPage.
 *
 * Must be rendered inside a CSSApp (provides auth context and CSSPuckProvider).
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useCSSPuck } from '../../CSSPuckContext.js';
import { useBranches } from '../../hooks/useBranches.js';
import { MergeResolutionPage } from './MergeResolutionPage.js';

export interface MergeReviewPageProps {
  /** Puck config for rendering previews. */
  config: unknown;
  /** Called when user navigates away from the merge page. */
  onClose?: () => void;
  /** Called after a successful merge execution. */
  onMergeComplete?: () => void;
}

const baseClass = 'merge-review-page';

export function MergeReviewPage({
  config,
  onClose,
  onMergeComplete,
}: MergeReviewPageProps): React.ReactElement {
  const { client, siteId, branchId } = useCSSPuck();
  const { branches, loading, error, mainBranch } = useBranches({
    client,
    siteId,
    initialBranchId: branchId,
  });

  const [sourceBranchId, setSourceBranchId] = useState('');
  const [showResolveConflicts, setShowResolveConflicts] = useState(false);

  // Auto-select branches once loaded
  const targetBranchId = mainBranch?.id ?? '';
  const nonMainBranches = useMemo(
    () => branches.filter((b) => !b.isMain && b.name !== 'main'),
    [branches],
  );

  // Auto-select first non-main branch if none selected
  const effectiveSourceBranchId = sourceBranchId || nonMainBranches[0]?.id || '';
  const sourceBranch = branches.find((b) => b.id === effectiveSourceBranchId);
  const sourceName = sourceBranch?.name ?? 'Draft';
  const targetName = 'Live';

  const canReview =
    !loading &&
    effectiveSourceBranchId &&
    targetBranchId &&
    effectiveSourceBranchId !== targetBranchId;

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    }
  }, [onClose]);

  const handleMergeComplete = useCallback(() => {
    setShowResolveConflicts(false);
    if (onMergeComplete) {
      onMergeComplete();
    }
  }, [onMergeComplete]);

  // Resolve conflicts view
  if (showResolveConflicts && canReview) {
    return (
      <MergeResolutionPage
        client={client}
        siteId={siteId}
        sourceBranchId={effectiveSourceBranchId}
        targetBranchId={targetBranchId}
        sourceBranchName={sourceName}
        targetBranchName={targetName}
        config={config}
        onClose={() => setShowResolveConflicts(false)}
        onMergeComplete={handleMergeComplete}
      />
    );
  }

  return (
    <div
      className={baseClass}
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: 1200,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <header
        className={`${baseClass}__header`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {onClose && (
          <button
            type="button"
            className={`${baseClass}__back-button`}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: 'white',
              cursor: 'pointer',
              fontSize: 14,
            }}
            onClick={handleClose}
          >
            Back
          </button>
        )}
        <h1
          className={`${baseClass}__title`}
          style={{ fontSize: 24, fontWeight: 600, margin: 0 }}
        >
          Merge review
        </h1>
      </header>

      {/* Branch selectors */}
      <div
        className={`${baseClass}__branch-selectors`}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label
            className={`${baseClass}__label`}
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#666',
              textTransform: 'uppercase',
            }}
          >
            Draft
          </label>
          <select
            className={`${baseClass}__source-select`}
            value={effectiveSourceBranchId}
            onChange={(e) => setSourceBranchId(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #ccc',
              fontSize: 14,
              minWidth: 200,
            }}
          >
            <option value="">Select Draft</option>
            {nonMainBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <span
          className={`${baseClass}__arrow`}
          style={{ fontSize: 20, color: '#666', paddingBottom: 6 }}
        >
          {'\u2192'}
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label
            className={`${baseClass}__label`}
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#666',
              textTransform: 'uppercase',
            }}
          >
            Live
          </label>
          <div
            className={`${baseClass}__target-display`}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #ccc',
              fontSize: 14,
              minWidth: 200,
              background: '#f5f5f5',
              color: '#666',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            Live
          </div>
        </div>

        <button
          type="button"
          className={`${baseClass}__review-button`}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: '#0066cc',
            color: 'white',
            cursor: !canReview ? 'not-allowed' : 'pointer',
            fontSize: 14,
            fontWeight: 600,
            opacity: !canReview ? 0.5 : 1,
          }}
          disabled={!canReview}
          onClick={() => setShowResolveConflicts(true)}
        >
          {loading ? 'Loading...' : 'Review and merge'}
        </button>
      </div>

      {error && (
        <div
          className={`${baseClass}__error`}
          style={{
            background: '#fde8e8',
            color: '#c53030',
            padding: '12px 16px',
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          {error.message}
        </div>
      )}
    </div>
  );
}
