import React from 'react';
import styles from './FieldHelpText.module.css';

export interface FieldHelpTextProps {
  children: React.ReactNode;
}

export function FieldHelpText({ children }: FieldHelpTextProps): React.ReactElement {
  return <span className={styles.help}>{children}</span>;
}
