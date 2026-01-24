/**
 * CSS Puck Plugin
 *
 * Adds CSS functionality to the Puck editor's plugin rail.
 * Provides branch selection and other CSS-specific controls.
 */

import React from 'react';
import type { Branch } from '@pantheon/css-client';

/**
 * Props for the CSS Plugin panel content
 */
interface CSSPluginPanelProps {
  /** List of available branches */
  branches: Branch[];
  /** Currently selected branch */
  currentBranch: Branch | null;
  /** Callback when branch is switched */
  onBranchSwitch: (branchId: string) => void;
  /** Whether there are unsaved changes */
  hasUnsavedChanges?: boolean;
}

/**
 * Plugin panel content component
 */
function CSSPluginPanel({
  branches,
  currentBranch,
  onBranchSwitch,
  hasUnsavedChanges = false,
}: CSSPluginPanelProps): React.ReactElement {
  const handleBranchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBranchId = e.target.value;
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Switch branch anyway?'
      );
      if (!confirmed) return;
    }
    onBranchSwitch(newBranchId);
  };

  return (
    <div className="css-plugin-panel">
      <div className="css-plugin-section">
        <label className="css-plugin-label" htmlFor="css-branch-select">
          Branch
        </label>
        <select
          id="css-branch-select"
          className="css-plugin-select"
          value={currentBranch?.id ?? ''}
          onChange={handleBranchChange}
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
              {branch.isMain ? ' (main)' : ''}
            </option>
          ))}
        </select>
      </div>

      {currentBranch && (
        <div className="css-plugin-section">
          <div className="css-plugin-info">
            <span className="css-plugin-info-label">Current Branch:</span>
            <span className="css-plugin-info-value">{currentBranch.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * CSS Plugin icon component
 */
function CSSPluginIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 4h12M2 8h12M2 12h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Options for creating the CSS Plugin
 */
export interface CSSPluginOptions {
  /** List of available branches */
  branches: Branch[];
  /** Currently selected branch */
  currentBranch: Branch | null;
  /** Callback when branch is switched */
  onBranchSwitch: (branchId: string) => void;
  /** Whether there are unsaved changes */
  hasUnsavedChanges?: boolean;
}

/**
 * Puck Plugin type (matches Puck's expected structure)
 */
export interface PuckPlugin {
  name: string;
  label: string;
  icon: React.ReactNode;
  render: () => React.ReactElement;
  overrides?: Record<string, unknown>;
}

/**
 * Creates a CSS Plugin for the Puck editor.
 *
 * @example
 * ```tsx
 * import { createCSSPlugin, useCSSPuck } from '@pantheon/puck-css';
 *
 * function Editor() {
 *   const { branches, currentBranch, switchBranch, saveStatus } = useCSSPuck();
 *
 *   const cssPlugin = createCSSPlugin({
 *     branches,
 *     currentBranch,
 *     onBranchSwitch: switchBranch,
 *     hasUnsavedChanges: saveStatus === 'saving',
 *   });
 *
 *   return <Puck plugins={[cssPlugin]} {...otherProps} />;
 * }
 * ```
 */
export function createCSSPlugin(options: CSSPluginOptions): PuckPlugin {
  return {
    name: 'css',
    label: 'CSS',
    icon: <CSSPluginIcon />,
    render: () => (
      <CSSPluginPanel
        branches={options.branches}
        currentBranch={options.currentBranch}
        onBranchSwitch={options.onBranchSwitch}
        hasUnsavedChanges={options.hasUnsavedChanges}
      />
    ),
    overrides: {},
  };
}
