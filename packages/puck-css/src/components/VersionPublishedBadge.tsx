import React from "react";

export interface VersionPublishedBadgeProps {
  isPublished?: boolean;
}

export function VersionPublishedBadge({
  isPublished = true,
}: VersionPublishedBadgeProps) {
  if (!isPublished) {
    return null;
  }

  return (
    <span className="pds-indicator-badge pds-indicator-badge--success pds-indicator-badge--sm">
      <span className="pds-indicator-badge__label">Published</span>
    </span>
  );
}
