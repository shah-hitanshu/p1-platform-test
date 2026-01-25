/**
 * VersionComparePage Component
 *
 * Full-page view for comparing two versions of Puck data.
 */

import React, { useState, useMemo } from 'react';
import type { ComponentDiffWithPosition, PropDiff } from '../../types.js';
import { diffProps } from '../../utils/diff.js';
import { DiffHeader } from './DiffHeader.js';
import { ComponentTree } from './ComponentTree.js';
import { PropDiffPanel } from './PropDiffPanel.js';

export interface VersionComparePageProps {
  /**
   * The before version number.
   */
  beforeVersion: number;

  /**
   * The after version number.
   */
  afterVersion: number;

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
 * Renders a full-page version comparison view.
 */
export function VersionComparePage({
  beforeVersion,
  afterVersion,
  diffs,
  onClose,
  className = '',
}: VersionComparePageProps): React.ReactElement {
  const baseClass = 'version-compare-page';
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
    setSelectedComponentId(diff.componentId);
  };

  return (
    <div className={classes}>
      <DiffHeader
        beforeVersion={beforeVersion}
        afterVersion={afterVersion}
        added={counts.added}
        removed={counts.removed}
        modified={counts.modified}
        reordered={counts.reordered}
        onClose={onClose}
      />

      <div className={`${baseClass}__content`}>
        {isEmpty ? (
          <div className={`${baseClass}__empty`}>
            No changes between versions
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
