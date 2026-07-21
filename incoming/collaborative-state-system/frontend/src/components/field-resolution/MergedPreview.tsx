/**
 * Merged Preview Component
 *
 * Live preview of the merged document state based on current selections.
 */

interface MergedPreviewProps {
  snapshot: Record<string, unknown>;
}

function formatPreviewValue(value: unknown): string {
  if (value === undefined) return '(undefined)';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function MergedPreview({ snapshot }: MergedPreviewProps) {
  const entries = Object.entries(snapshot);

  if (entries.length === 0) {
    return (
      <div className="merged-preview">
        <div className="merged-preview-header">Merged preview</div>
        <p className="merged-preview-empty">No fields to preview.</p>
      </div>
    );
  }

  return (
    <div className="merged-preview">
      <div className="merged-preview-header">Merged preview</div>
      <div className="merged-preview-fields">
        {entries.map(([key, value]) => (
          <div key={key} className="merged-preview-field">
            <span className="merged-preview-label">{key}:</span>
            <span className="merged-preview-value">
              {formatPreviewValue(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
