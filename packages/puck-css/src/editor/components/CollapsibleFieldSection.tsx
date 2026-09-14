import React, { useId, useState } from 'react';
import { CollapsibleSectionHeader } from './CollapsibleSectionHeader.js';

export interface CollapsibleFieldSectionProps {
  children: React.ReactNode;
  label: string;
  defaultCollapsed?: boolean;
  /** Shown beside the chevron. Omitted when there is nothing to count. */
  count?: number;
  /** A control governing the group as a whole. */
  action?: React.ReactNode;
}

export function CollapsibleFieldSection({
  children,
  label,
  defaultCollapsed = false,
  count,
  action,
}: CollapsibleFieldSectionProps): React.ReactElement {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const contentId = useId();

  return (
    <>
      <CollapsibleSectionHeader
        title={label}
        open={expanded}
        onToggle={() => setExpanded((v) => !v)}
        controlsId={contentId}
        count={count}
        action={action}
      />
      {expanded && <div id={contentId}>{children}</div>}
    </>
  );
}
