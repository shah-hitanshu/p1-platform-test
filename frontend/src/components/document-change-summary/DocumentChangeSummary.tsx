/**
 * Document Change Summary Component
 *
 * Renders categorized document-level changes from merge preview data.
 * Shows source-only, target-only, and conflicting documents with counts
 * and document paths.
 */

import type { ModifiedDocument, DocumentConflict } from '../../types';
import { categorizeChanges } from './categorizeChanges';
import './DocumentChangeSummary.css';

/** Props for the {@link DocumentChangeSummary} component. */
interface DocumentChangeSummaryProps {
  /** Documents modified on the source branch. */
  sourceChanges: ModifiedDocument[];
  /** Documents modified on the target branch. */
  targetChanges: ModifiedDocument[];
  /** Documents with conflicting changes. */
  conflicts: DocumentConflict[];
  /** Display name for the source branch. */
  sourceBranchName: string;
  /** Display name for the target branch. */
  targetBranchName: string;
}

function getChangeType(doc: ModifiedDocument): 'deleted' | 'added' | 'modified' {
  if (doc.isDeleted) return 'deleted';
  if (doc.baseVersionId === null) return 'added';
  return 'modified';
}

function DocumentPath({ doc }: { doc: ModifiedDocument }) {
  const changeType = getChangeType(doc);
  return (
    <div className="document-path-item">
      <code>{doc.documentPath}</code>
      <span className={`${changeType}-badge`}>{changeType}</span>
    </div>
  );
}

/**
 * Renders categorized document-level changes from merge preview data.
 * Shows source-only, target-only, and conflicting documents with counts and paths.
 */
export function DocumentChangeSummary({
  sourceChanges,
  targetChanges,
  conflicts,
  sourceBranchName,
  targetBranchName,
}: DocumentChangeSummaryProps) {
  const summary = categorizeChanges(sourceChanges, targetChanges, conflicts);

  if (summary.totalChanges === 0) {
    return (
      <div className="document-change-summary">
        <div className="no-changes">No document changes</div>
      </div>
    );
  }

  return (
    <div className="document-change-summary">
      <div className="summary-header">
        {summary.totalChanges} document{summary.totalChanges !== 1 ? 's' : ''} changed
      </div>

      {summary.sourceOnly.length > 0 && (
        <div className="change-category source-category">
          <div className="category-header">
            <span className="category-label">
              Changed in {sourceBranchName} only
            </span>
            <span className="category-count">{summary.sourceOnly.length}</span>
          </div>
          <div className="category-documents">
            {summary.sourceOnly.map((doc) => (
              <DocumentPath key={doc.documentId} doc={doc} />
            ))}
          </div>
        </div>
      )}

      {summary.targetOnly.length > 0 && (
        <div className="change-category target-category">
          <div className="category-header">
            <span className="category-label">
              Changed in {targetBranchName} only
            </span>
            <span className="category-count">{summary.targetOnly.length}</span>
          </div>
          <div className="category-documents">
            {summary.targetOnly.map((doc) => (
              <DocumentPath key={doc.documentId} doc={doc} />
            ))}
          </div>
        </div>
      )}

      {summary.conflicting.length > 0 && (
        <div className="change-category conflict-category">
          <div className="category-header">
            <span className="category-label">Conflicts</span>
            <span className="category-count">{summary.conflicting.length}</span>
          </div>
          <div className="category-documents">
            {summary.conflicting.map((conflict) => (
              <div key={conflict.documentId} className="document-path-item conflict-item">
                <code>{conflict.documentPath}</code>
                <span className="conflict-type-badge">{conflict.conflictType}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
