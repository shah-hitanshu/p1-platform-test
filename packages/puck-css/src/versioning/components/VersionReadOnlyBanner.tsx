/**
 * VersionReadOnlyBanner
 *
 * Shown at the top of the inspector when a historical version is being previewed.
 * Copy rule: no em-dashes in version-history surfaces.
 */

import React from 'react';

export interface VersionReadOnlyBannerProps {
  versionNumber?: number | null;
}

export function VersionReadOnlyBanner({
  versionNumber,
}: VersionReadOnlyBannerProps): React.ReactElement {
  return (
    <div className="p1-version-readonly-banner">
      {versionNumber != null
        ? `Viewing v${versionNumber}. Fields are read-only.`
        : 'You have view-only access. Changes are not saved.'}
    </div>
  );
}
