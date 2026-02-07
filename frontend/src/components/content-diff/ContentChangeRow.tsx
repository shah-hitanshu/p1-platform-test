/**
 * Content Change Row Component
 *
 * Displays a single field-level change in human-readable format:
 * "Field: ~~old~~ -> new" with color coding by change type.
 */

import type { ContentChange } from './types';

/** Props for the {@link ContentChangeRow} component. */
interface ContentChangeRowProps {
  /** The content change to display. */
  change: ContentChange;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Displays a single field-level change with the field label, old value, and new value.
 * Color-coded by change type (add, replace, remove).
 */
export function ContentChangeRow({ change }: ContentChangeRowProps) {
  const cssClass = `content-change-row change-${change.type}`;

  return (
    <div className={cssClass}>
      <span className="change-label">{change.label}</span>
      <span className="change-values">
        {change.oldValue !== undefined && (
          <span className="change-old-value">{formatValue(change.oldValue)}</span>
        )}
        {change.oldValue !== undefined && change.newValue !== undefined && (
          <span className="change-arrow">{'\u2192'}</span>
        )}
        {change.newValue !== undefined && (
          <span className="change-new-value">{formatValue(change.newValue)}</span>
        )}
      </span>
    </div>
  );
}
