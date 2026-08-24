import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

export interface ScopeSummaryProps {
  /** How many pages the agent may change. Named, so the count is never hidden. */
  pageCount: number;
  onExpand: () => void;
}

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: 0,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  fontSize: 'var(--pds-typography-size-xs)',
  color: 'var(--pds-color-foreground-default-secondary)',
  cursor: 'pointer',
};

function summarize(count: number): string {
  if (count === 0) return 'Reads the whole site, edits no existing pages';
  return `Reads the whole site, edits ${String(count)} ${count === 1 ? 'page' : 'pages'}`;
}

export function ScopeSummary({ pageCount, onExpand }: ScopeSummaryProps): React.ReactElement {
  return (
    <button type="button" aria-expanded={false} style={buttonStyle} onClick={onExpand}>
      <Icon iconName="pen" size="s" />
      <span>{summarize(pageCount)}</span>
      <Icon iconName="angleDown" size="s" />
    </button>
  );
}
