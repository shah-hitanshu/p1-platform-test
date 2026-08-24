/**
 * PanelHeader
 *
 * The heading every left-rail panel wears: title, an optional actions slot, a
 * collapse button, and the rule beneath. Blocks, Outline, Version history and
 * Data sources all render it, so their headings stay identical by construction
 * instead of by three hand-rolled copies drifting apart — which is exactly what
 * had happened (styles.css defined .css-plugin-panel-header twice, with
 * different padding).
 *
 * Collapsing is built in rather than a required prop: all four panels want the
 * same dispatch, and every one of them renders inside Puck's context. Pass
 * `onCollapse` only for work that must happen *in addition*.
 */

import React from 'react';
import { IconButton } from '@pantheon-systems/pds-toolkit-react';
import { createUsePuck } from '@puckeditor/core';
import styles from './PanelHeader.module.css';

const usePanelHeaderPuck = createUsePuck();

export interface PanelHeaderProps {
  /** Panel name, rendered as the heading. */
  title: string;
  /** Extra work to run after collapsing. The collapse itself is built in. */
  onCollapse?: () => void;
  /** Optional controls rendered between the title and the collapse button. */
  actions?: React.ReactNode;
}

export function PanelHeader({
  title,
  onCollapse,
  actions,
}: PanelHeaderProps): React.ReactElement {
  const dispatch = usePanelHeaderPuck((s) => s.dispatch) as (action: unknown) => void;

  return (
    <div className={styles.header}>
      <span className={styles.title}>{title}</span>
      {actions}
      <IconButton
        ariaLabel="Collapse panel"
        iconName="anglesLeft"
        size="s"
        hasTooltip={true}
        hasBorder={false}
        onClick={() => {
          dispatch({ type: 'setUi', ui: { leftSideBarVisible: false } });
          onCollapse?.();
        }}
      />
    </div>
  );
}
