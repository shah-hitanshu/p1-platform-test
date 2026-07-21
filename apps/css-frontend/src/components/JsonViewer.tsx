/**
 * JSON Viewer Component
 *
 * Displays JSON data in a formatted, readable way.
 */

import './JsonViewer.css';

interface JsonViewerProps {
  data: unknown;
  title?: string;
}

export function JsonViewer({ data, title }: JsonViewerProps) {
  return (
    <div className="json-viewer">
      {title && <h3 className="json-viewer-title">{title}</h3>}
      <pre className="json-content">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
