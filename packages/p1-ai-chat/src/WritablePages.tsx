import React, { useMemo } from 'react';
import { Tag } from '@pantheon-systems/pds-toolkit-react';
import { AddPageDropdown } from './AddPageDropdown.js';

export interface WritablePagesProps {
  /** Pages the agent may change, in the canonical form the write set holds. */
  pages: string[];
  /** Every page the picker can offer. */
  sitePages: string[];
  onAddPage: (path: string) => void;
  onRemovePage: (path: string) => void;
}

const secondaryStyle: React.CSSProperties = {
  color: 'var(--pds-color-foreground-default-secondary)',
};

export function WritablePages({
  pages,
  sitePages,
  onAddPage,
  onRemovePage,
}: WritablePagesProps): React.ReactElement {
  const candidates = useMemo(
    () => sitePages.filter(path => !pages.includes(path)),
    [sitePages, pages],
  );

  return (
    <>
      {pages.length === 0 && (
        <span style={secondaryStyle}>no pages — it can read and create, but not change existing pages</span>
      )}
      {pages.map(path => (
        <Tag
          key={path}
          tagLabel={path}
          size="xs"
          // Pinned because Tag picks a random colour when none is given, recolouring on render.
          tagColor="slate"
          isRemovable
          // Tag appends the label, giving "Stop editing: about".
          removeLabel="Stop editing"
          onRemove={() => onRemovePage(path)}
        />
      ))}
      {candidates.length > 0 && <AddPageDropdown candidates={candidates} onAdd={onAddPage} />}
    </>
  );
}
