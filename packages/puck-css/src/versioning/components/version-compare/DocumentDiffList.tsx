/**
 * DocumentDiffList Component
 *
 * Multi-document wrapper that displays a list of documents with
 * change summaries and expandable rows showing per-document
 * component diffs.
 */

import React, { useState } from 'react';
import type { BranchDocumentComparison } from '../../utils/branchDiff.js';
import { ComponentTree } from './ComponentTree.js';

/**
 * Props for the DocumentDiffList component.
 */
export interface DocumentDiffListProps {
  /**
   * Array of document comparisons to display.
   */
  documents: BranchDocumentComparison[];

  /**
   * Name of the source branch.
   */
  sourceBranchName: string;

  /**
   * Name of the target branch.
   */
  targetBranchName: string;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Renders a list of documents with change count badges and expandable
 * rows for viewing component-level diffs per document.
 *
 * @param props - {@link DocumentDiffListProps}
 * @returns A React element with expandable document rows and change count badges.
 */
export function DocumentDiffList({
  documents,
  sourceBranchName,
  targetBranchName,
  className = '',
}: DocumentDiffListProps): React.ReactElement {
  const baseClass = 'document-diff-list';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  const isEmpty = documents.length === 0;

  const handleToggle = (docId: string) => {
    setExpandedDocId((prev) => (prev === docId ? null : docId));
  };

  return (
    <div
      className={classes}
      data-source-branch={sourceBranchName}
      data-target-branch={targetBranchName}
    >
      {!isEmpty && (
        <div className={`${baseClass}__header`}>
          <span className={`${baseClass}__summary`}>
            {`${documents.length} documents`}
          </span>
        </div>
      )}

      {isEmpty ? (
        <div className={`${baseClass}__empty`}>No documents to compare</div>
      ) : (
        <div className={`${baseClass}__rows`}>
          {documents.map((doc) => {
            const isExpanded = expandedDocId === doc.documentId;
            const { added, removed, modified } = doc.counts;

            return (
              <div
                key={doc.documentId}
                className={`${baseClass}__row${isExpanded ? ` ${baseClass}__row--expanded` : ''}`}
              >
                <button
                  type="button"
                  className={`${baseClass}__row-header`}
                  onClick={() => handleToggle(doc.documentId)}
                >
                  <span className={`${baseClass}__path`}>
                    {doc.documentPath}
                  </span>
                  <span className={`${baseClass}__badges`}>
                    {added > 0 && (
                      <span className={`${baseClass}__badge ${baseClass}__badge--added`}>
                        +{added}
                      </span>
                    )}
                    {removed > 0 && (
                      <span className={`${baseClass}__badge ${baseClass}__badge--removed`}>
                        -{removed}
                      </span>
                    )}
                    {modified > 0 && (
                      <span className={`${baseClass}__badge ${baseClass}__badge--modified`}>
                        ~{modified}
                      </span>
                    )}
                  </span>
                </button>

                {isExpanded && (
                  <div className={`${baseClass}__detail`}>
                    {doc.isPuckData ? (
                      <ComponentTree
                        diffs={doc.diffs}
                        side="after"
                      />
                    ) : (
                      <div className={`${baseClass}__non-puck`}>
                        This is not a Puck document. Detailed diff view is not available.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
