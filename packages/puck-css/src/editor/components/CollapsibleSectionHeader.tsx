/**
 * CollapsibleSectionHeader
 *
 * Section header for a collapsible section that can be used within P1
 *
 * Callers own the expanded state and the id wiring, so this stays presentational.
 */

import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import styles from './CollapsibleSection.module.css';

export interface CollapsibleSectionHeaderProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Id of the region this header controls, for aria-controls. */
  controlsId: string;
  id?: string;
  /** Item count shown beside the chevron. Omitted when there is nothing to count. */
  count?: number;
}

export function CollapsibleSectionHeader({
  title,
  open,
  onToggle,
  controlsId,
  id,
  count,
}: CollapsibleSectionHeaderProps): React.ReactElement {
  return (
    <button
      id={id}
      // Puck renders inspector fields inside a <form>; a submit-typed button
      // would submit it.
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controlsId}
      className={styles.toggle}
    >
      <span className={styles.title}>{title}</span>
      <span className={styles.meta}>
        {count !== undefined && (
          <span className={styles.count}>{count}</span>
        )}
        <Icon iconName={open ? 'angleUp' : 'angleDown'} size="s" />
      </span>
    </button>
  );
}
