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
  const allComparisons = useMemo(() => {
    return documents.map((doc) =>
      createBranchDocumentComparison(
        doc.documentId,
        doc.documentPath,
        doc.sourceSnapshot,
        doc.targetSnapshot
      )
    );
  }, [documents]);

  // Filter to only documents with actual changes (new, deleted, or modified)
  const changedEntries = useMemo(() => {
    const entries: { doc: DocumentDiffSummary; comparison: typeof allComparisons[number] }[] = [];
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const comp = allComparisons[i];
      if (!doc || !comp) continue;
      const hasChanges = comp.diffs.some((d) => d.type !== 'unchanged');
      const isNew = doc.sourceSnapshot != null && doc.targetSnapshot == null;
      const isDeleted = doc.sourceSnapshot == null && doc.targetSnapshot != null;
      if (hasChanges || isNew || isDeleted) {
        entries.push({ doc, comparison: comp });
      }
    }
    return entries;
  }, [documents, allComparisons]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  const selected = changedEntries[selectedIndex];
  const selectedComparison = selected?.comparison ?? null;
  const selectedDocument = selected?.doc ?? null;

  // Create diff map and highlighted configs for the selected document
  const diffMap = useMemo(
    () => (selectedComparison ? createDiffMap(selectedComparison.diffs) : new Map()),
    [selectedComparison]
  );

  // Source is the "after" (new/changed state), target is the "before" (baseline)
  const sourceConfig = useMemo(
    () => createHighlightedConfig(config, diffMap, 'after'),
    [config, diffMap]
  );
  const targetConfig = useMemo(
    () => createHighlightedConfig(config, diffMap, 'before'),
    [config, diffMap]
  );

  // Get source and target data for rendering
  const sourceData = selectedDocument?.sourceSnapshot as PuckData | null;
  const targetData = selectedDocument?.targetSnapshot as PuckData | null;

  const emptyData: PuckData = { content: [], root: { props: {} } };

  // Determine document status for the selected entry
  const isNewDocument = sourceData != null && targetData == null;
  const isDeletedDocument = sourceData == null && targetData != null;

  // Aggregate change counts across all changed documents for the header
  const totalCounts = useMemo(() => {
    const totals = { added: 0, removed: 0, modified: 0 };
    for (const entry of changedEntries) {
      totals.added += entry.comparison.counts.added;
      totals.removed += entry.comparison.counts.removed;
      totals.modified += entry.comparison.counts.modified;
    }
    return totals;
  }, [changedEntries]);

  return (
    <div className={classes}>
      <BranchDiffHeader
        sourceBranchName={sourceBranchName}
        targetBranchName={targetBranchName}
        added={totalCounts.added}
        removed={totalCounts.removed}
        modified={totalCounts.modified}
        onClose={onClose}
      />

      {/* Document selector and legend bar */}
      <div className={`${baseClass}__legend`}>
        {changedEntries.length > 1 && (
          <select
            className="css-plugin-select"
            style={{ width: 'auto', maxWidth: '300px', marginRight: '1rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
          >
            {changedEntries.map((entry, i) => {
              const isNew = entry.doc.sourceSnapshot != null && entry.doc.targetSnapshot == null;
              const isDel = entry.doc.sourceSnapshot == null && entry.doc.targetSnapshot != null;
              const docChanges = entry.comparison.counts.added + entry.comparison.counts.removed + entry.comparison.counts.modified;
              let label = entry.doc.documentPath;
              if (isNew) {
                label += ' (new)';
              } else if (isDel) {
                label += ' (deleted)';
              } else if (docChanges > 0) {
                label += ` (${docChanges} change${docChanges !== 1 ? 's' : ''})`;
              }
              return (
                <option key={entry.doc.documentId} value={i}>
                  {label}
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
        {changedEntries.length === 0 ? (
          <div className={`${baseClass}__empty`}>No changes between Drafts</div>
        ) : (
          <div className={`${baseClass}__panels`}>
            {/* After panel (source branch - current changes) */}
            <div className={`${baseClass}__panel ${baseClass}__panel--before`}>
              <div className={`${baseClass}__panel-header`}>
                <span className={`${baseClass}__panel-label`}>New Changes</span>
                <span className={`${baseClass}__panel-version`}>{sourceBranchName}</span>
              </div>
              <div className={`${baseClass}__panel-content`}>
                {isDeletedDocument ? (
                  <div className={`${baseClass}__empty`}>Document deleted in this Draft</div>
                ) : (
                  <Render
                    config={sourceConfig as Parameters<typeof Render>[0]['config']}
                    data={(sourceData ?? emptyData) as Parameters<typeof Render>[0]['data']}
                  />
                )}
              </div>
            </div>

            {/* Before panel (target branch - main) */}
            <div className={`${baseClass}__panel ${baseClass}__panel--after`}>
              <div className={`${baseClass}__panel-header`}>
                <span className={`${baseClass}__panel-label`}>Current State</span>
                <span className={`${baseClass}__panel-version`}>{targetBranchName}</span>
              </div>
              <div className={`${baseClass}__panel-content`}>
                {isNewDocument ? (
                  <div className={`${baseClass}__empty`}>Document does not exist on this Draft</div>
                ) : (
                  <Render
                    config={targetConfig as Parameters<typeof Render>[0]['config']}
                    data={(targetData ?? emptyData) as Parameters<typeof Render>[0]['data']}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
