import React, { useMemo, useState } from 'react';
import { Dropdown } from '@pantheon-systems/pds-toolkit-react';

export interface AddPageDropdownProps {
  /** Pages that can still be added, in the same canonical form as the write set. */
  candidates: string[];
  onAdd: (path: string) => void;
}

export function AddPageDropdown({ candidates, onAdd }: AddPageDropdownProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === '' ? candidates : candidates.filter(p => p.toLowerCase().includes(needle));
  }, [candidates, query]);

  return (
    <Dropdown inline>
      <Dropdown.Trigger
        style={{
          fontSize: 'var(--pds-typography-size-2xs)',
          padding: '2px 8px',
          borderRadius: 999,
          border: '1px dashed var(--pds-color-border-default)',
          background: 'transparent',
          color: 'var(--pds-color-foreground-default-secondary)',
          cursor: 'pointer',
        }}
      >
        + Add page
      </Dropdown.Trigger>
      <Dropdown.Panel>
        <Dropdown.Filter
          label="Filter pages"
          placeholder="Find a page"
          noResultsText="No pages match"
          showNoResults={shown.length === 0}
          onFilterChange={setQuery}
        />
        {shown.map((path, index) => (
          <Dropdown.Item
            key={path}
            index={index}
            onClick={() => onAdd(path)}
            // Both load-bearing, measured in Chrome: the panel is a column flex box floating-ui
            // caps to the available space, so without flexShrink rows collapse to their min-height
            // and a wrapped path overlaps the next; without minWidth the panel shrink-wraps to
            // PDS's 10rem and almost every path wraps.
            style={{ flexShrink: 0, minWidth: '15rem' }}
          >
            {path}
          </Dropdown.Item>
        ))}
      </Dropdown.Panel>
    </Dropdown>
  );
}
