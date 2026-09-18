import React from 'react';
import { Badge, Button, Icon } from '@pantheon-systems/pds-toolkit-react';

import { SafeIcon } from '../../../pds/components/SafeIcon.js';
import type { ThreadSubject } from '../types.js';
import styles from './CommentThreadHeader.module.css';

export interface CommentThreadHeaderProps {
  /** What the thread is about, as shown to the reader. */
  label: string;
  /** Marks the subject with its kind's icon when it has one. */
  icon?: ThreadSubject['icon'];
  resolved: boolean;
  /** Marks the discussion over. Absent where the reader cannot resolve it. */
  onResolve?: () => void;
  /** The thread is being resolved. */
  resolving?: boolean;
  /** The thread could not be resolved. */
  resolveFailed?: boolean;
  onClose: () => void;
}

/** Names the content under discussion, offers to end it, and offers the way out. */
export function CommentThreadHeader({
  label,
  icon,
  resolved,
  onResolve,
  resolving = false,
  resolveFailed = false,
  onClose,
}: CommentThreadHeaderProps): React.ReactElement {
  return (
    <header className={styles.header}>
      <Badge
        color="silver-muted"
        size="xs"
        className={styles.subject}
        data-testid="comment-thread-subject"
        label={
          <>
            {icon && <SafeIcon iconName={icon} size="s" aria-hidden="true" />}
            <span className={styles.subjectLabel}>{label}</span>
          </>
        }
      />
      {resolved && (
        <Badge
          color="success-muted"
          size="s"
          className={styles.resolved}
          data-testid="comment-thread-resolved"
          label={
            <>
              <Icon iconName="check" size="s" aria-hidden="true" />
              Resolved
            </>
          }
        />
      )}
      <span className={styles.spacer} />
      {!resolved && onResolve && (
        <Button
          label="Resolve"
          variant="subtle"
          size="s"
          iconName="check"
          displayType="icon-start"
          className={styles.resolve}
          data-testid="comment-thread-resolve"
          disabled={resolving}
          ariaLabel={resolveFailed ? 'Resolve thread, last attempt failed' : 'Resolve thread'}
          onClick={onResolve}
        />
      )}
      <button type="button" className={styles.close} aria-label="Close comments" onClick={onClose}>
        <Icon iconName="xmark" size="m" aria-hidden="true" />
      </button>
    </header>
  );
}
