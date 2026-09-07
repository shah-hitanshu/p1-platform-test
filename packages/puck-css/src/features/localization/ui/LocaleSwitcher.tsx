/**
 * Locale Switcher
 *
 * Names the locale version of the page currently open, and lists the site's
 * markets: those with a version to switch to, and those still to be created.
 *
 * The menu is portalled and positioned against the trigger, so the editor
 * toolbar's own overflow cannot clip it.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, StatusIndicator } from '@pantheon-systems/pds-toolkit-react';
import type { LocaleRow } from '../locale-rows.js';
import { localeLabel } from '../locale-labels.js';
import styles from './LocaleSwitcher.module.css';

/** What the untagged page is called wherever a locale would otherwise be named. */
export const UNTAGGED_LABEL = 'Unset';

/** What a market holding a version of this page reads as. */
const LOCALIZED_LABEL = 'Localized';

const MENU_WIDTH = 320;

export interface LocaleSwitcherProps {
  rows: LocaleRow[];
  /**
   * The site's configured markets. Counted and gated on separately from `rows`,
   * which also cover a locale only a document carries.
   */
  markets: string[];
  /**
   * The canonical and its variants, for naming the page behind a row. Only rows
   * sharing a locale need it, since the locale alone no longer tells them apart.
   */
  documents: { id: string; path: string }[];
  /** The site's markets have not arrived yet. */
  loading: boolean;
  /** The markets could not be read, so what the site publishes in is unknown. */
  failed: boolean;
  /** Ask for the markets and the page's versions again. */
  onRetry: () => void;
  /** Open the locale version held by this document. */
  onOpenLocale: (documentId: string) => void;
  /** Create a version of this page in a market that has none. */
  onAddLocale: (locale: string) => void;
}

export function LocaleSwitcher({
  rows,
  markets,
  documents,
  loading,
  failed,
  onRetry,
  onOpenLocale,
  onAddLocale,
}: LocaleSwitcherProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      zIndex: 9999,
    });
  }, []);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => !wasOpen);
  }, []);

  // Measured after the menu opens rather than while deciding to open it: React
  // may run a state updater more than once, and reading layout is not something
  // to repeat.
  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);

  const choose = useCallback(
    (row: LocaleRow) => {
      setOpen(false);
      if (row.state === 'current') return;
      if (row.documentId !== null) {
        onOpenLocale(row.documentId);
        return;
      }
      if (row.locale !== null) onAddLocale(row.locale);
    },
    [onOpenLocale, onAddLocale],
  );

  // Pointerdown, and skipping the menu itself, so a row's click still lands
  // before the menu unmounts.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [open, position]);

  // Unknown is not the same as none, and a switcher that hid itself either way
  // would make a failed request look like a site that publishes in one locale.
  if (failed) {
    return (
      <div className={styles.root}>
        <button
          type="button"
          data-testid="locale-switcher-retry"
          className={`${styles.trigger} ${styles.triggerFailed}`}
          title="The page's locales could not be loaded. Try again."
          aria-label="Locales unavailable, try again"
          onClick={onRetry}
        >
          <Icon iconName="triangleExclamation" size="s" aria-hidden="true" />
          <span className={styles.triggerLabel}>
            <span className={styles.triggerName}>Locales unavailable</span>
          </span>
        </button>
      </div>
    );
  }

  const current = rows.find((r) => r.state === 'current');

  // A site with no markets has no locale dimension to switch along: the only row
  // would be the page already open.
  if (loading || markets.length === 0) return null;

  // Rows are measured against an open page, so without one there is nothing for
  // the trigger to name and nothing for the menu to list.
  if (rows.length === 0) return null;

  const currentLabel = current?.locale === null || current === undefined
    ? null
    : localeLabel(current.locale);

  const rowsPerLocale = new Map<string, number>();
  for (const row of rows) {
    if (row.locale === null) continue;
    rowsPerLocale.set(row.locale, (rowsPerLocale.get(row.locale) ?? 0) + 1);
  }

  const pathOf = (documentId: string | null): string | null =>
    documentId === null ? null : (documents.find((doc) => doc.id === documentId)?.path ?? null);

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="locale-switcher-trigger"
        className={styles.trigger}
        title="Switch to another locale version of this page"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <Icon iconName="globe" size="s" aria-hidden="true" />
        <span className={styles.triggerLabel}>
          <span className={styles.triggerName}>{currentLabel?.native ?? UNTAGGED_LABEL}</span>
          {currentLabel !== null && <span className={styles.badge}>{currentLabel.tag}</span>}
          <Icon iconName="angleDown" size="s" aria-hidden="true" />
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.dropdown}
            data-testid="locale-switcher-menu"
            style={menuStyle}
          >
            <div className={styles.header}>
              <span className={styles.headerTitle}>Locales</span>
              <span className={styles.headerCount} data-testid="locale-switcher-count">
                {markets.length} site {markets.length === 1 ? 'locale' : 'locales'}
              </span>
            </div>

            <ul className={styles.list} role="menu">
              {rows.map((row) => {
                const label = row.locale === null ? null : localeLabel(row.locale);
                const locale = row.locale ?? 'none';
                // Rows are per document, so a locale held by two of them appears
                // twice. Those rows name their page in place of the language they
                // share, which is the only thing that tells them apart.
                const shares = row.locale !== null && (rowsPerLocale.get(row.locale) ?? 0) > 1;
                const path = shares ? pathOf(row.documentId) : null;
                const key = row.documentId ?? locale;
                const testKey = path === null ? locale : `${locale}-${row.documentId ?? ''}`;
                return (
                  <li key={key} className={styles.item} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`locale-row-${testKey}`}
                      className={styles.row}
                      aria-current={row.state === 'current' ? 'true' : undefined}
                      onClick={() => choose(row)}
                    >
                      <span
                        className={styles.badge}
                        data-testid={`locale-badge-${testKey}`}
                        aria-hidden="true"
                      >
                        {label?.tag ?? '—'}
                      </span>
                      <span className={styles.rowText}>
                        <span className={styles.rowName}>
                          {label?.native ?? UNTAGGED_LABEL}
                          {label?.dir === 'rtl' && (
                            <span className={styles.rtl} data-testid={`locale-rtl-${testKey}`}>
                              RTL
                            </span>
                          )}
                        </span>
                        {label !== null && (
                          <span className={styles.rowSub}>
                            {row.state === 'available'
                              ? 'Not localized yet'
                              : (path ?? label.english)}
                          </span>
                        )}
                      </span>
                      {row.state === 'available' ? (
                        <span className={styles.add} data-testid={`locale-add-${testKey}`}>
                          <Icon iconName="plus" size="s" aria-hidden="true" />
                          Add {label?.tag}
                        </span>
                      ) : (
                        label !== null && (
                          <StatusIndicator
                            data-testid={`locale-status-${testKey}`}
                            className={styles.status}
                            type="success"
                            label={LOCALIZED_LABEL}
                          />
                        )
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
