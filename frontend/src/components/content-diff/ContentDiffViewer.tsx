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

interface ContentDiffViewerProps {
  sourceData: Record<string, unknown> | null;
  targetData: Record<string, unknown> | null;
  diffOperations: DiffOperation[];
  sourceLabel?: string;
  targetLabel?: string;
}

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
