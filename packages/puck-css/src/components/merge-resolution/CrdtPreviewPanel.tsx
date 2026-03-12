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
      <div className={baseClass} style={{ padding: '12px' }}>
        <p className={`${baseClass}__loading`} style={{ color: '#666', fontStyle: 'italic' }}>Loading CRDT merge preview...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={baseClass} style={{ padding: '12px' }}>
        <p className={`${baseClass}__error`} style={{ color: '#c53030', background: '#fde8e8', padding: '8px 12px', borderRadius: '6px' }}>{error}</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={baseClass} style={{ padding: '12px' }}>
        <p className={`${baseClass}__empty`} style={{ color: '#999', fontStyle: 'italic' }}>No CRDT preview available.</p>
      </div>
    );
  }

  return (
    <div className={baseClass} style={{ padding: '12px' }}>
      <p className={`${baseClass}__success`} style={{ color: '#155724', fontWeight: 500, marginBottom: '8px' }}>CRDT merge preview loaded.</p>
      {/* TODO: Replace raw JSON with Puck Render component for visual preview */}
      <pre className={`${baseClass}__snapshot`} style={{ background: '#f5f5f5', padding: '12px', borderRadius: '6px', overflow: 'auto', fontSize: '12px', maxHeight: '400px', border: '1px solid #e5e7eb' }}>
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    </div>
  );
}
