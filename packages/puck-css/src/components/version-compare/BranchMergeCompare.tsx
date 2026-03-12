/**
 * BranchMergeCompare Component
 *
 * Full-page view for comparing two branches of Puck data,
 * wrapping the VersionComparePage pattern for branch merge context.
 */

import React, { useState, useMemo } from 'react';
import { flushSync } from 'react-dom';
import type { ComponentDiffWithPosition, PropDiff } from '../../types.js';
import { diffProps } from '../../utils/diff.js';
import { BranchDiffHeader } from './BranchDiffHeader.js';
import { ComponentTree } from './ComponentTree.js';
import { PropDiffPanel } from './PropDiffPanel.js';

/**
 * Props for the BranchMergeCompare component.
 */
export interface BranchMergeCompareProps {
  /**
   * Name of the source branch.
   */
  sourceBranchName: string;

  /**
   * Name of the target branch.
   */
  targetBranchName: string;

  /**
   * Array of component diffs with position information.
   */
  diffs: ComponentDiffWithPosition[];

  /**
   * Callback when the comparison is closed.
   */
  onClose: () => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Counts diffs by type.
 */
function countDiffs(diffs: ComponentDiffWithPosition[]): {
  added: number;
  removed: number;
  modified: number;
  reordered: number;
} {
  const counts = { added: 0, removed: 0, modified: 0, reordered: 0 };
  for (const diff of diffs) {
    if (diff.type === 'added') counts.added++;
    else if (diff.type === 'removed') counts.removed++;
    else if (diff.type === 'modified') counts.modified++;
    else if (diff.type === 'reordered') counts.reordered++;
  }
  return counts;
}

/**
 * Renders a full-page branch merge comparison view with branch names,
 * component trees for both sides, and a prop diff panel for selected
 * components.
 *
 * @param props - {@link BranchMergeCompareProps}
 * @returns A React element with header, side-by-side component trees, and detail panel.
 */
export function BranchMergeCompare({
  sourceBranchName,
  targetBranchName,
  diffs,
  onClose,
  className = '',
}: BranchMergeCompareProps): React.ReactElement {
  const baseClass = 'branch-merge-compare';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);

  const counts = useMemo(() => countDiffs(diffs), [diffs]);
  const isEmpty = diffs.length === 0;

  // Find the selected diff
  const selectedDiff = useMemo(() => {
    if (!selectedComponentId) return null;
    return diffs.find((d) => d.componentId === selectedComponentId) ?? null;
  }, [diffs, selectedComponentId]);

  // Get prop diffs for the selected component
  const propDiffs: PropDiff[] = useMemo(() => {
    if (!selectedDiff) return [];
    if (selectedDiff.type === 'unchanged') return [];

    const beforeData = selectedDiff.before as { props?: Record<string, unknown> } | undefined;
    const afterData = selectedDiff.after as { props?: Record<string, unknown> } | undefined;
    const beforeProps = beforeData?.props ?? {};
    const afterProps = afterData?.props ?? {};

    return diffProps(beforeProps, afterProps);
  }, [selectedDiff]);

  const handleSelectComponent = (diff: ComponentDiffWithPosition) => {
    flushSync(() => {
      setSelectedComponentId(diff.componentId);
    });
  };

  return (
    <div className={classes}>
      <BranchDiffHeader
        sourceBranchName={sourceBranchName}
        targetBranchName={targetBranchName}
        added={counts.added}
        removed={counts.removed}
        modified={counts.modified}
        reordered={counts.reordered}
        onClose={onClose}
      />

      <div className={`${baseClass}__content`}>
        {isEmpty ? (
          <div className={`${baseClass}__empty`}>
            No changes between Drafts
          </div>
        ) : (
          <>
            <div className={`${baseClass}__trees`}>
              <ComponentTree
                diffs={diffs}
                side="before"
                selectedComponentId={selectedComponentId ?? undefined}
                onSelectComponent={handleSelectComponent}
              />
              <ComponentTree
                diffs={diffs}
                side="after"
                selectedComponentId={selectedComponentId ?? undefined}
                onSelectComponent={handleSelectComponent}
              />
            </div>

            {selectedDiff && (
              <div className={`${baseClass}__detail`}>
                <PropDiffPanel
                  componentType={selectedDiff.componentType}
                  componentId={selectedDiff.componentId}
                  diffs={propDiffs}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
