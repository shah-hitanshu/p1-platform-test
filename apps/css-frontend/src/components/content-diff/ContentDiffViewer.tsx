/**
 * Content Diff Viewer Component
 *
 * Human-readable alternative to JsonDiffViewer. Shows property-level changes
 * without JSON syntax, grouped by component (for Puck data) or top-level key.
 *
 * Accepts the same props interface as JsonDiffViewer for drop-in toggling.
 */

import type { DiffOperation } from '../../types';
import { transformDiffOperations } from './transformDiffOperations';
import { ContentSectionGroup } from './ContentSectionGroup';
import './ContentDiffViewer.css';

/** Props for the {@link ContentDiffViewer} component. */
interface ContentDiffViewerProps {
  /** The source (before) snapshot, or null. */
  sourceData: Record<string, unknown> | null;
  /** The target (after) snapshot, or null. */
  targetData: Record<string, unknown> | null;
  /** The RFC 6902 diff operations to visualize. */
  diffOperations: DiffOperation[];
  /** Optional label for the source side. */
  sourceLabel?: string;
  /** Optional label for the target side. */
  targetLabel?: string;
}

/**
 * Human-readable content diff viewer that groups property-level changes by
 * Puck component or top-level JSON key, without exposing raw JSON syntax.
 */
export function ContentDiffViewer({
  sourceData,
  targetData,
  diffOperations,
}: ContentDiffViewerProps) {
  const sections = transformDiffOperations(sourceData, targetData, diffOperations);
  const totalChanges = sections.reduce((sum, s) => sum + s.changes.length, 0);

  if (totalChanges === 0) {
    return (
      <div className="content-diff-viewer">
        <div className="content-diff-empty">No changes detected</div>
      </div>
    );
  }

  return (
    <div className="content-diff-viewer">
      <div className="content-diff-legend">
        <span className="legend-item legend-added">Added</span>
        <span className="legend-item legend-removed">Removed</span>
        <span className="legend-item legend-changed">Changed</span>
      </div>

      <div className="content-diff-sections">
        {sections.map((section) => (
          <ContentSectionGroup
            key={section.label}
            section={section}
          />
        ))}
      </div>

      <div className="content-diff-summary">
        {totalChanges} change{totalChanges !== 1 ? 's' : ''} detected
      </div>
    </div>
  );
}
