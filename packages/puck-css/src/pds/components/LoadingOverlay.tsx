/**
 * LoadingOverlay component.
 *
 * Floating waiting state for a reload that happens *over* content the user can
 * still see — switching workstream or page keeps the outgoing document on the
 * canvas, so the indicator has to sit above it rather than replace it. The
 * full-panel counterpart, for when there is nothing to show yet, is
 * <LoadingMessage />.
 */

import React from 'react';
import { Spinner } from '@pantheon-systems/pds-toolkit-react';
import styles from './LoadingOverlay.module.css';

export interface LoadingOverlayProps {
  /** Copy shown beside the indicator, e.g. "Switching workstream…" */
  message: string;
  'data-testid'?: string;
}

export function LoadingOverlay({
  message,
  'data-testid': dataTestId,
}: LoadingOverlayProps): React.ReactElement {
  return (
    <div className={styles.overlay} role="status" aria-live="polite" data-testid={dataTestId}>
      {/* Spinner marks itself aria-hidden, so the message below is the only announcement. */}
      <Spinner isInline size="m" />
      <span className={styles.message}>{message}</span>
    </div>
  );
}
