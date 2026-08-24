import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { ScopeSummary } from './ScopeSummary.js';
import { WritablePages } from './WritablePages.js';

export interface WriteSetRowProps {
  /** Pages the agent may change, or null before the conversation has seeded itself. */
  writeSet: string[] | null;
  /** Every page the picker can offer, in the same canonical form as the write set. */
  sitePages: string[];
  onAddPage: (path: string) => void;
  onRemovePage: (path: string) => void;
  /** Whether the pages are listed, or summed up in one line. */
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  fontSize: 'var(--pds-typography-size-xs)',
  color: 'var(--pds-color-foreground-default)',
  minWidth: 0,
};

const keyStyle: React.CSSProperties = {
  color: 'var(--pds-color-foreground-default-secondary)',
};

const collapseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginLeft: 'auto',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--pds-color-foreground-default-secondary)',
  cursor: 'pointer',
};

/** Read scope is stated rather than configurable: the agent reads the whole site. */
export function WriteSetRow({
  writeSet,
  sitePages,
  onAddPage,
  onRemovePage,
  isExpanded,
  onExpandedChange,
}: WriteSetRowProps): React.ReactElement {
  const pages = writeSet ?? [];

  if (!isExpanded) {
    return (
      <div style={{ padding: '10px 16px' }}>
        <ScopeSummary pageCount={pages.length} onExpand={() => onExpandedChange(true)} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 16px' }}>
      <div style={rowStyle}>
        <Icon iconName="globe" size="s" />
        <span><span style={keyStyle}>Reading:</span> entire site</span>
        <button
          type="button"
          aria-expanded
          aria-label="Hide which pages the agent can edit"
          style={collapseStyle}
          onClick={() => onExpandedChange(false)}
        >
          <Icon iconName="angleUp" size="s" />
        </button>
      </div>
      <div style={rowStyle}>
        <Icon iconName="pen" size="s" />
        <span style={keyStyle}>Editing:</span>
        <WritablePages
          pages={pages}
          sitePages={sitePages}
          onAddPage={onAddPage}
          onRemovePage={onRemovePage}
        />
      </div>
    </div>
  );
}
