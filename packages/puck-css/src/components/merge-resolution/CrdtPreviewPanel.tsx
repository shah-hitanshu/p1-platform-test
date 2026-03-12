/**
 * CrdtPreviewPanel Component
 *
 * Renders the CRDT auto-merge preview for a single document.
 */

import React from 'react';
import type { PuckData } from '@pantheon/css-client';

export interface CrdtPreviewPanelProps {
  snapshot: PuckData | null;
  loading: boolean;
  error: string | null;
}

const baseClass = 'crdt-preview-panel';

export function CrdtPreviewPanel({
  snapshot,
  loading,
  error,
}: CrdtPreviewPanelProps): React.ReactElement {
  if (loading) {
    return (
      <div className={baseClass}>
        <p className={`${baseClass}__loading`}>Loading CRDT merge preview...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={baseClass}>
        <p className={`${baseClass}__error`}>{error}</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={baseClass}>
        <p className={`${baseClass}__empty`}>No CRDT preview available.</p>
      </div>
    );
  }

  return (
    <div className={baseClass}>
      <p className={`${baseClass}__success`}>CRDT merge preview loaded.</p>
      {/* TODO: Replace raw JSON with Puck Render component for visual preview */}
      <pre className={`${baseClass}__snapshot`}>
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    </div>
  );
}
