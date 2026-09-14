/**
 * SlideOverDrawer
 *
 * A panel that enters from the right over the editor, for work that needs more
 * room than the fields rail and more focus than a popover. It closes on Escape,
 * on the scrim, and on its own close control, and returns focus to whatever
 * opened it. Focus is not contained: Tab reaches the editor behind it.
 *
 * It renders into the document body, so a drawer opened from the toolbar is not
 * clipped by it.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import styles from './SlideOverDrawer.module.css';

/**
 * Backstop for the close transition. `animationend` is what normally retires the
 * drawer, but an environment that runs no animations never fires it, and a
 * drawer that cannot unmount traps focus. Longer than the CSS duration so the
 * transition is the usual way out.
 */
const CLOSE_FALLBACK_MS = 400;

export interface SlideOverDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Names the drawer to a screen reader, since the title is styled text. */
  ariaLabel: string;
  /** Short kicker above the title, naming the kind of thing this is. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** A line under the title for the particulars: versions, counts, status. */
  meta?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}

export function SlideOverDrawer({
  open,
  onClose,
  ariaLabel,
  eyebrow,
  title,
  meta,
  footer,
  children,
  testId,
}: SlideOverDrawerProps): React.ReactElement | null {
  // Closing is animated, so the drawer outlives `open` by one transition.
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement;
      setMounted(true);
      setClosing(false);
    } else {
      setClosing((wasClosing) => wasClosing || mounted);
    }
  }, [open, mounted]);

  // Focus moves in on open so the keyboard lands inside the drawer, and back to
  // the control that opened it on close.
  useEffect(() => {
    if (!mounted || closing) return;
    drawerRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [mounted, closing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const settle = useCallback(() => {
    setClosing(false);
    setMounted(false);
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(settle, CLOSE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [closing, settle]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`${styles.scrim} ${closing ? styles.scrimClosing : ''}`}
      data-testid={testId}
      // Only the scrim itself closes: a mousedown inside the panel reaches here
      // by bubbling, with the panel as its target.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className={`${styles.drawer} ${closing ? styles.drawerClosing : ''}`}
        role="dialog"
        // aria-modal announces the rest of the page as inert, which holds only
        // once Tab is contained here. Both go in together.
        aria-label={ariaLabel}
        tabIndex={-1}
        onAnimationEnd={closing ? settle : undefined}
      >
        <div className={styles.head}>
          <div className={styles.headTop}>
            {eyebrow !== undefined ? <span className={styles.eyebrow}>{eyebrow}</span> : <span />}
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label={`Close ${ariaLabel.toLowerCase()}`}
              data-testid={testId === undefined ? undefined : `${testId}-close`}
            >
              <Icon iconName="xmark" size="s" aria-hidden="true" />
            </button>
          </div>
          <h2 className={styles.title}>{title}</h2>
          {meta}
        </div>

        <div className={styles.body}>{children}</div>

        {footer !== undefined && <div className={styles.foot}>{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}
