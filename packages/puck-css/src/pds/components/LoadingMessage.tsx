/**
 * LoadingMessage component.
 *
 * Full-panel waiting state: an animated indicator above caller-supplied copy.
 * The editor has several distinct waits (opening a document, redirecting to a
 * page it had to resolve first) and the message is a prop so each can say which
 * one the user is in.
 */

import React from 'react';
import styles from './LoadingMessage.module.css';

export interface LoadingMessageProps {
  /** Copy shown beneath the indicator, e.g. "Loading document" */
  message: string;
  'data-testid'?: string;
}

export function LoadingMessage({
  message,
  'data-testid': dataTestId,
}: LoadingMessageProps): React.ReactElement {
  return (
    <div className={styles.panel} role="status" aria-live="polite" data-testid={dataTestId}>
      <span className={styles.spinner} aria-hidden="true" />
      <p className={styles.message}>{message}</p>
    </div>
  );
}
