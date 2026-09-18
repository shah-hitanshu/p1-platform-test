import React, { useRef } from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

import type { ThreadContext } from '../types.js';
import { useKeepInView } from '../use-keep-in-view.js';
import styles from './CommentThread.module.css';

export interface CommentThreadProps
  extends Pick<ThreadContext, 'contextType' | 'contextId' | 'threadId'> {
  onClose: () => void;
}

/**
 * Placeholder for the thread view.
 *
 * Stands in for the real thread — body list, composer, resolution — and exists so
 * the trigger has somewhere to open and so the context it passes along is visible while
 * that view is being built.
 *
 * Opens beside the trigger it belongs to, with a caret pointing back at it, so a reader
 * can tell which piece of content is being discussed when several threads are in reach.
 */
export function CommentThread({
  contextType,
  contextId,
  threadId,
  onClose,
}: CommentThreadProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  useKeepInView(panelRef);

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-label="Comments"
      data-testid="comment-thread"
    >
      <span className={styles.caret} aria-hidden="true" />
      <div className={styles.header}>
        <span className={styles.title}>Comments</span>
        <button type="button" className={styles.close} aria-label="Close comments" onClick={onClose}>
          <Icon iconName="xmark" size="s" aria-hidden="true" />
        </button>
      </div>
      <p className={styles.body}>
        thread will go here for {contextType} with id {contextId}
        {threadId ? ` (thread ${threadId})` : ''}
      </p>
    </div>
  );
}
