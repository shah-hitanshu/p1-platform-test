/**
 * ReadOnlyFieldsGuard
 *
 * Wraps Puck's fields panel with the HTML inert attribute when viewing a
 * historical version. The inert attribute blocks all interaction — pointer
 * events AND keyboard focus — unlike pointer-events:none alone.
 */

import React from 'react';

export interface ReadOnlyFieldsGuardProps {
  children: React.ReactNode;
  isReadOnly: boolean;
}

export function ReadOnlyFieldsGuard({
  children,
  isReadOnly,
}: ReadOnlyFieldsGuardProps): React.ReactElement {
  // Always render the same div so React updates the inert attribute in-place
  // rather than remounting children. Remounting causes stale inert state on
  // page-level Puck fields that don't re-render unless a block is clicked.
  return (
    <div
      className={isReadOnly ? 'p1-readonly-fields-guard' : undefined}
      {...(isReadOnly ? { inert: true } : {})}
    >
      {children}
    </div>
  );
}
