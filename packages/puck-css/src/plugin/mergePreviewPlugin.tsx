/**
 * Merge Preview Plugin
 *
 * Puck plugin that renders a merge preview panel with visual diff
 * highlighting across multiple documents between two branches.
 */

import React from 'react';
import type { PuckPlugin } from './CSSPlugin.js';
import type { DocumentDiffSummary } from '../utils/branchDiff.js';
import { MergePreviewPanel } from '../components/merge-preview/MergePreviewPanel.js';

/**
 * Options for creating the merge preview plugin.
 */
export interface MergePreviewPluginOptions {
  /** Array of document diff summaries to display. */
  documents: DocumentDiffSummary[];

  /** Name of the source branch. */
  sourceBranchName: string;

  /** Name of the target branch. */
  targetBranchName: string;

  /** Puck configuration for rendering components. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;

  /** Callback when a document is selected. */
  onDocumentSelect?: (documentId: string) => void;
}

/**
 * Icon for the merge preview plugin.
 */
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

/**
 * Creates a merge preview plugin for the Puck editor.
 *
 * The plugin renders a panel that lists documents with diff summaries.
 * Selecting a document shows a visual comparison using side-by-side,
 * overlay, or slider view modes.
 *
 * @param options - {@link MergePreviewPluginOptions} configuring documents, branches, and callbacks.
 * @returns A {@link PuckPlugin} that can be passed to the Puck editor's `plugins` array.
 *
 * @example
 * ```tsx
 * import { createMergePreviewPlugin } from '@pantheon/puck-css';
 *
 * const mergePlugin = createMergePreviewPlugin({
 *   documents,
 *   sourceBranchName: 'feature',
 *   targetBranchName: 'main',
 *   config: puckConfig,
 *   onDocumentSelect: (id) => console.log('Selected:', id),
 * });
 *
 * <Puck plugins={[mergePlugin]} {...otherProps} />
 * ```
 */
export function createMergePreviewPlugin(
  options: MergePreviewPluginOptions,
): PuckPlugin {
  return {
    name: 'merge-preview',
    label: 'Merge Preview',
    icon: <MergePreviewIcon />,
    render: () => (
      <MergePreviewPanel
        documents={options.documents}
        sourceBranchName={options.sourceBranchName}
        targetBranchName={options.targetBranchName}
        config={options.config}
        onDocumentSelect={options.onDocumentSelect}
      />
    ),
  };
}
