import React from 'react';
import { PanelHeader } from './PanelHeader.js';
import styles from './PanelShell.module.css';

export interface PanelShellProps {
  title: string;
  onCollapse?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}

export function PanelShell({
  title,
  onCollapse,
  actions,
  children,
  testId,
}: PanelShellProps): React.ReactElement {
  return (
    <div className={styles.shell} data-testid={testId}>
      <PanelHeader title={title} onCollapse={onCollapse} actions={actions} />
      <div className={styles.body}>{children}</div>
    </div>
  );
}
