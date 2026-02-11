/**
 * VisualBranchCompare Component
 *
 * Side-by-side visual comparison of two branch snapshots with diff highlighting.
 * Supports multiple documents with a dropdown selector.
 * Uses Puck's Render component to display actual rendered content.
 */

import React, { useState, useMemo } from 'react';
import { Render } from '@puckeditor/core';
import type { DocumentDiffSummary } from '../../utils/branchDiff.js';
import { createBranchDocumentComparison } from '../../utils/branchDiff.js';
import { createDiffMap, createHighlightedConfig } from '../../utils/highlightConfig.js';
import type { PuckConfig } from '../../utils/highlightConfig.js';
import { BranchDiffHeader } from './BranchDiffHeader.js';

/**
 * Puck Data structure (flexible to accept various sources)
 */
interface PuckData {
  content: Array<{
    type: string;
    props: Record<string, unknown> & { id: string };
  }>;
  root: { props?: Record<string, unknown> };
}

export interface VisualBranchCompareProps {
  /**
   * Name of the source branch.
   */
  sourceBranchName: string;

  /**
   * Name of the target branch.
   */
  targetBranchName: string;

  /**
   * All documents with source/target snapshots to compare.
   */
  documents: DocumentDiffSummary[];

  /**
   * The Puck configuration for rendering components.
   */
  config: PuckConfig;

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
 * Renders a side-by-side visual comparison of two branches across multiple documents.
 */
export function VisualBranchCompare({
  sourceBranchName,
  targetBranchName,
  documents,
  config,
  onClose,
  className = '',
}: VisualBranchCompareProps): React.ReactElement {
  const baseClass = 'visual-version-compare';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  // Compute comparisons for all documents
  const comparisons = useMemo(() => {
    return documents.map((doc) =>
      createBranchDocumentComparison(
        doc.documentId,
        doc.documentPath,
        doc.sourceSnapshot,
        doc.targetSnapshot
      )
    );
  }, [documents]);

  // Find first document with changes, default to first document
  const firstChangedIndex = comparisons.findIndex(
    (c) => c.diffs.some((d) => d.type !== 'unchanged')
  );
  const defaultIndex = firstChangedIndex >= 0 ? firstChangedIndex : 0;

  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);

  const selectedComparison = comparisons[selectedIndex];
  const selectedDocument = documents[selectedIndex];

  // Compute total change counts across selected document
  const counts = selectedComparison
    ? selectedComparison.counts
    : { added: 0, removed: 0, modified: 0, unchanged: 0 };

  const totalChanges = counts.added + counts.removed + counts.modified;

  // Create diff map and highlighted configs for the selected document
  const diffMap = useMemo(
    () => (selectedComparison ? createDiffMap(selectedComparison.diffs) : new Map()),
    [selectedComparison]
  );

  const sourceConfig = useMemo(
    () => createHighlightedConfig(config, diffMap, 'before'),
    [config, diffMap]
  );
  const targetConfig = useMemo(
    () => createHighlightedConfig(config, diffMap, 'after'),
    [config, diffMap]
  );

  // Get source and target data for rendering
  const sourceData = selectedDocument?.sourceSnapshot as PuckData | null;
  const targetData = selectedDocument?.targetSnapshot as PuckData | null;

  const emptyData: PuckData = { content: [], root: { props: {} } };

  return (
    <div className={classes}>
      <BranchDiffHeader
        sourceBranchName={sourceBranchName}
        targetBranchName={targetBranchName}
        added={counts.added}
        removed={counts.removed}
        modified={counts.modified}
        onClose={onClose}
      />

      {/* Document selector and legend bar */}
      <div className={`${baseClass}__legend`}>
        {documents.length > 1 && (
          <select
            className="css-plugin-select"
            style={{ width: 'auto', maxWidth: '300px', marginRight: '1rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
          >
            {documents.map((doc, i) => {
              const comp = comparisons[i];
              const docChanges = comp
                ? comp.counts.added + comp.counts.removed + comp.counts.modified
                : 0;
              return (
                <option key={doc.documentId} value={i}>
                  {doc.documentPath}{docChanges > 0 ? ` (${docChanges} change${docChanges !== 1 ? 's' : ''})` : ''}
                </option>
              );
            })}
          </select>
        )}
        <span className={`${baseClass}__legend-item ${baseClass}__legend-item--added`}>
          <span className={`${baseClass}__legend-color`} /> Added
        </span>
        <span className={`${baseClass}__legend-item ${baseClass}__legend-item--removed`}>
          <span className={`${baseClass}__legend-color`} /> Removed
        </span>
        <span className={`${baseClass}__legend-item ${baseClass}__legend-item--modified`}>
          <span className={`${baseClass}__legend-color`} /> Modified
        </span>
      </div>

      <div className={`${baseClass}__content`}>
        {totalChanges === 0 ? (
          <div className={`${baseClass}__empty`}>No changes between branches</div>
        ) : (
          <div className={`${baseClass}__panels`}>
            {/* Source Branch Panel */}
            <div className={`${baseClass}__panel ${baseClass}__panel--before`}>
              <div className={`${baseClass}__panel-header`}>
                <span className={`${baseClass}__panel-label`}>Source branch</span>
                <span className={`${baseClass}__panel-version`}>{sourceBranchName}</span>
              </div>
              <div className={`${baseClass}__panel-content`}>
                <Render
                  config={sourceConfig as Parameters<typeof Render>[0]['config']}
                  data={(sourceData ?? emptyData) as Parameters<typeof Render>[0]['data']}
                />
              </div>
            </div>

            {/* Target Branch Panel */}
            <div className={`${baseClass}__panel ${baseClass}__panel--after`}>
              <div className={`${baseClass}__panel-header`}>
                <span className={`${baseClass}__panel-label`}>Target branch</span>
                <span className={`${baseClass}__panel-version`}>{targetBranchName}</span>
              </div>
              <div className={`${baseClass}__panel-content`}>
                <Render
                  config={targetConfig as Parameters<typeof Render>[0]['config']}
                  data={(targetData ?? emptyData) as Parameters<typeof Render>[0]['data']}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
