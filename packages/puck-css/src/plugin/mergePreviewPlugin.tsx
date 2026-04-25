import React from 'react';
import type { PuckPlugin } from './CSSPlugin.js';
import { MergePreviewPanel } from '../components/merge-preview/MergePreviewPanel.js';
import { useMergePreview } from '../hooks/useMergePreview.js';

export interface MergePreviewPluginOptions {
  /** Puck configuration for rendering components. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;

  /** Callback when a document is selected. */
  onDocumentSelect?: (documentId: string) => void;
}

function MergePreviewIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 2v4M12 2v4M4 6c0 3 4 4 8 4M4 6c0 3 4 4 8 4M12 10v4M4 10v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface ConnectedMergePreviewPanelProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  onDocumentSelect?: (documentId: string) => void;
}

function ConnectedMergePreviewPanel({
  config,
  onDocumentSelect,
}: ConnectedMergePreviewPanelProps): React.ReactElement {
  const { documents, loading, error, sourceBranchName, targetBranchName, isMainBranch } =
    useMergePreview();

  if (isMainBranch) {
    return (
      <div className="merge-preview-panel">
        <h3 className="merge-preview-panel__title">Merge preview</h3>
        <p className="merge-preview-panel__empty">
          Switch to a workstream to preview changes before merging.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="merge-preview-panel">
        <h3 className="merge-preview-panel__title">Merge preview</h3>
        <p className="merge-preview-panel__loading">Loading comparison…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="merge-preview-panel">
        <h3 className="merge-preview-panel__title">Merge preview</h3>
        <p className="merge-preview-panel__error">
          Failed to load comparison: {error.message}
        </p>
      </div>
    );
  }

  return (
    <MergePreviewPanel
      documents={documents}
      sourceBranchName={sourceBranchName}
      targetBranchName={targetBranchName}
      config={config}
      onDocumentSelect={onDocumentSelect}
    />
  );
}

export function createMergePreviewPlugin(
  options: MergePreviewPluginOptions,
): PuckPlugin {
  return {
    name: 'merge-preview',
    label: 'Merge Preview',
    icon: <MergePreviewIcon />,
    render: () => (
      <ConnectedMergePreviewPanel
        config={options.config}
        onDocumentSelect={options.onDocumentSelect}
      />
    ),
  };
}
