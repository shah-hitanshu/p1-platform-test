import React from 'react';
import { useP1Puck } from '../../core/P1PuckContext.js';
import styles from './ReadOnlyRoleBanner.module.css';

export function ReadOnlyRoleBanner(): React.ReactElement | null {
  const { permissions } = useP1Puck();
  if (!permissions || permissions.canEditDocuments) return null;

  return (
    <div className={styles.banner} role="status">
      You are viewing this page in read-only mode.
    </div>
  );
}
