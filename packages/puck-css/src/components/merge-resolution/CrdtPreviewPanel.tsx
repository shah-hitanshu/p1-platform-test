/**
 * CrdtPreviewPanel Component
 *
 * Renders the CRDT auto-merge preview for a single document.
 * When sourceData and targetData are provided, shows a three-way
 * visual comparison: Draft | CRDT Result | Live.
 *
 * All visual styling uses inline React styles.
 */

import React from 'react';
import { Render } from '@puckeditor/core';
import type { PuckData } from '@pantheon/css-client';

export interface CrdtPreviewPanelProps {
  snapshot: PuckData | null;
  loading: boolean;
  error: string | null;
  /** Puck config for rendering */
  config?: unknown;
  /** Source data for three-way comparison */
  sourceData?: PuckData | null;
  /** Target data for three-way comparison */
  targetData?: PuckData | null;
  /** Source branch name */
  sourceBranchName?: string;
  /** Target branch name */
  targetBranchName?: string;
}

const baseClass = 'crdt-preview-panel';

// =============================================================================
// Inline Style Constants
// =============================================================================

const containerStyle: React.CSSProperties = {
  padding: '12px',
};

const loadingStyle: React.CSSProperties = {
  color: '#666',
  fontStyle: 'italic',
};

const errorStyle: React.CSSProperties = {
  color: '#c53030',
  background: '#fde8e8',
  padding: '8px 12px',
  borderRadius: '6px',
};

const emptyStyle: React.CSSProperties = {
  color: '#999',
  fontStyle: 'italic',
};

const threeWayContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
};

const threeWayPanelStyle: React.CSSProperties = {
  flex: '1 1 33.3%',
  minWidth: 0,
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
};

const panelLabelStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: '13px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
};

const crdtLabelStyle: React.CSSProperties = {
  ...panelLabelStyle,
  background: '#f3e8ff',
  color: '#5a2d82',
};

const panelContentStyle: React.CSSProperties = {
  padding: '12px',
};

const singlePanelStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
};

// =============================================================================
// Component
// =============================================================================

export function CrdtPreviewPanel({
  snapshot,
  loading,
  error,
  config,
  sourceData,
  targetData,
  sourceBranchName,
  targetBranchName,
}: CrdtPreviewPanelProps): React.ReactElement {
  if (loading) {
    return (
      <div className={baseClass} style={containerStyle}>
        <p className={`${baseClass}__loading`} style={loadingStyle}>
          Loading CRDT merge preview...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={baseClass} style={containerStyle}>
        <p className={`${baseClass}__error`} style={errorStyle}>{error}</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={baseClass} style={containerStyle}>
        <p className={`${baseClass}__empty`} style={emptyStyle}>
          No CRDT preview available.
        </p>
      </div>
    );
  }

  // Three-way comparison when all data is available
  if (config && sourceData && targetData) {
    return (
      <div className={baseClass} style={containerStyle}>
        <div className={`${baseClass}__three-way`} style={threeWayContainerStyle}>
          {/* Draft (source) panel */}
          <div className={`${baseClass}__panel`} style={threeWayPanelStyle}>
            <div className={`${baseClass}__panel-label`} style={panelLabelStyle}>
              {sourceBranchName || 'Draft'}
            </div>
            <div className={`${baseClass}__panel-content`} style={panelContentStyle}>
              <Render
                config={config as Parameters<typeof Render>[0]['config']}
                data={sourceData as Parameters<typeof Render>[0]['data']}
              />
            </div>
          </div>

          {/* CRDT Result panel */}
          <div className={`${baseClass}__panel ${baseClass}__panel--crdt`} style={threeWayPanelStyle}>
            <div className={`${baseClass}__panel-label ${baseClass}__panel-label--crdt`} style={crdtLabelStyle}>
              Auto-merged
            </div>
            <div className={`${baseClass}__panel-content`} style={panelContentStyle}>
              <Render
                config={config as Parameters<typeof Render>[0]['config']}
                data={snapshot as Parameters<typeof Render>[0]['data']}
              />
            </div>
          </div>

          {/* Live (target) panel */}
          <div className={`${baseClass}__panel`} style={threeWayPanelStyle}>
            <div className={`${baseClass}__panel-label`} style={panelLabelStyle}>
              {targetBranchName || 'Live'}
            </div>
            <div className={`${baseClass}__panel-content`} style={panelContentStyle}>
              <Render
                config={config as Parameters<typeof Render>[0]['config']}
                data={targetData as Parameters<typeof Render>[0]['data']}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single panel: standalone CRDT result (when source/target not provided)
  if (config) {
    return (
      <div className={baseClass} style={containerStyle}>
        <div className={`${baseClass}__standalone`} style={singlePanelStyle}>
          <div className={`${baseClass}__panel-label ${baseClass}__panel-label--crdt`} style={crdtLabelStyle}>
            Auto-merged
          </div>
          <div className={`${baseClass}__panel-content`} style={panelContentStyle}>
            <Render
              config={config as Parameters<typeof Render>[0]['config']}
              data={snapshot as Parameters<typeof Render>[0]['data']}
            />
          </div>
        </div>
      </div>
    );
  }

  // Fallback: no config available, show raw JSON (backward compatibility)
  return (
    <div className={baseClass} style={containerStyle}>
      <p className={`${baseClass}__success`} style={{ color: '#155724', fontWeight: 500, marginBottom: '8px' }}>
        CRDT merge preview loaded.
      </p>
      <pre className={`${baseClass}__snapshot`} style={{
        background: '#f5f5f5',
        padding: '12px',
        borderRadius: '6px',
        overflow: 'auto',
        fontSize: '12px',
        maxHeight: '400px',
        border: '1px solid #e5e7eb',
      }}>
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    </div>
  );
}
