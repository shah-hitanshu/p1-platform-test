/**
 * BranchSelector Component
 *
 * Dropdown for switching between branches.
 */

import React, { useCallback } from 'react';
import type { Branch } from '@pantheon/css-client';

interface BranchSelectorProps {
  /**
   * List of available branches.
   */
  branches: Branch[];

  /**
   * Currently selected branch.
   */
  currentBranch: Branch | null;

  /**
   * Callback when branch selection changes.
   */
  onSwitch: (branchId: string) => Promise<void>;

  /**
   * Whether the selector is disabled.
   */
  disabled?: boolean;

  /**
   * Whether there are unsaved changes (shows warning before switching).
   */
  hasUnsavedChanges?: boolean;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Dropdown component for selecting and switching branches.
 *
 * @example
 * ```tsx
 * <BranchSelector
 *   branches={branches}
 *   currentBranch={currentBranch}
 *   onSwitch={switchBranch}
 *   hasUnsavedChanges={isDirty}
 * />
 * ```
 */
export function BranchSelector({
  branches,
  currentBranch,
  onSwitch,
  disabled = false,
  hasUnsavedChanges = false,
  className = '',
}: BranchSelectorProps): React.ReactElement {
  const baseClass = 'css-puck-branch-selector';

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newBranchId = e.target.value;

      if (newBranchId === currentBranch?.id) {
        return;
      }

      if (hasUnsavedChanges) {
        const confirmed = window.confirm(
          'You have unsaved changes. They will be saved before switching Drafts. Continue?'
        );
        if (!confirmed) {
          // Reset the select to current value
          e.target.value = currentBranch?.id ?? '';
          return;
        }
      }

      try {
        await onSwitch(newBranchId);
      } catch (error) {
        console.error('Failed to switch branch:', error);
        // Reset the select to current value
        e.target.value = currentBranch?.id ?? '';
      }
    },
    [currentBranch, hasUnsavedChanges, onSwitch]
  );

  // Sort branches: main first, then by name
  const sortedBranches = [...branches].sort((a, b) => {
    if (a.isMain && !b.isMain) return -1;
    if (!a.isMain && b.isMain) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={`${baseClass} ${className}`}>
      <label htmlFor="branch-selector" className={`${baseClass}__label`}>
        Drafts
      </label>
      <select
        id="branch-selector"
        className={`${baseClass}__select`}
        value={currentBranch?.id ?? ''}
        onChange={(e) => void handleChange(e)}
        disabled={disabled || branches.length === 0}
      >
        {sortedBranches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.isMain ? 'Live' : branch.name}
            {branch.status === 'archived' ? ' [archived]' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
