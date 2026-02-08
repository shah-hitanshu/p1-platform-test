/**
 * Content Section Group Component
 *
 * Renders a collapsible group of content changes under a section heading.
 * For Puck data, the heading is the component type name.
 * For generic JSON, the heading is the top-level key.
 */

import { useState } from 'react';
import type { ContentSection } from './types';
import { ContentChangeRow } from './ContentChangeRow';

/** Props for the {@link ContentSectionGroup} component. */
interface ContentSectionGroupProps {
  /** The content section to render. */
  section: ContentSection;
  /** Whether the section is expanded on initial render. Defaults to true. */
  defaultExpanded?: boolean;
}

/**
 * Renders a collapsible group of content changes under a section heading.
 * Shows a toggle button, the section label, and a change count badge.
 */
export function ContentSectionGroup({
  section,
  defaultExpanded = true,
}: ContentSectionGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="content-section-group">
      <button
        className="section-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        type="button"
      >
        <span className="section-toggle">{isExpanded ? '\u25BC' : '\u25B6'}</span>
        <span className="section-label">{section.label}</span>
        <span className="section-count">
          {section.changes.length} change{section.changes.length !== 1 ? 's' : ''}
        </span>
      </button>

      {isExpanded && (
        <div className="section-changes">
          {section.changes.map((change) => (
            <ContentChangeRow key={change.path} change={change} />
          ))}
        </div>
      )}
    </div>
  );
}
