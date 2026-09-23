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
import { Icon, Spinner, StatusIndicator } from '@pantheon-systems/pds-toolkit-react';
import type { LocaleRow } from '../locale-rows.js';
import { localeLabel } from '../locale-labels.js';
import type { LocaleReviewStatus } from '../useLocaleReviewStatus.js';
import styles from './LocaleSwitcher.module.css';

/** What the untagged page is called wherever a locale would otherwise be named. */
export const UNTAGGED_LABEL = 'Unset';

/** What the source row reads as when the canonical carries no locale. */
const SOURCE_UNSET_LABEL = 'Source locale unset';

/** Wide enough for the count and the way into the list to share one line. */
const MENU_WIDTH = 360;

/** What the open page has yet to take from the page it was translated from. */
export interface LocaleDrift {
  /** Changes the page can take. Structural ones are reported rather than applied. */
  outstanding: number;
  /** The source's only changes were to add, move or remove blocks. */
  structuralOnly: boolean;
  /** Open the list of those changes. */
  onReview: () => void;
}

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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewStatus: ReadonlyMap<string, LocaleReviewStatus>;
  /** Ask for the markets and the page's versions again. */
  onRetry: () => void;
  /** Open the locale version held by this document. */
  onOpenLocale: (documentId: string) => void;
  /** Create a version of this page in a market that has none. */
  onAddLocale: (locale: string) => void;
  /** How far the open page has drifted from its source, where it has one. */
  drift?: LocaleDrift | null;
}

export function LocaleSwitcher({
  rows,
  markets,
  documents,
  loading,
  failed,
  open,
  onOpenChange: setOpen,
  reviewStatus,
  onRetry,
  onOpenLocale,
  onAddLocale,
  drift = null,
}: LocaleSwitcherProps): React.ReactElement | null {
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const changed = drift !== null && (drift.outstanding > 0 || drift.structuralOnly);
  // Blocks moving is not a translation falling behind: it is reported, and
  // there is nothing to act on, so it is stated in the neutral tone.
  const structural = drift?.structuralOnly === true;
  const changedLabel = structural ? 'Structure changed' : 'Source changed';
  const changeWord = drift?.outstanding === 1 ? 'change' : 'changes';
  const reviewLabel = structural
    ? 'Structure changed'
    : `${String(drift?.outstanding ?? 0)} ${changeWord} since translation`;
  const reviewDescription = structural
    ? 'View structural changes from the source'
    : `Review ${String(drift?.outstanding ?? 0)} ${changeWord} in the locale source`;
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
    setOpen(!open);
  }, [open, setOpen]);

  // Measured after the menu opens rather than while deciding to open it: React
  // may run a state updater more than once, and reading layout is not something
  // to repeat.
  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);

  const choose = useCallback(
    (row: LocaleRow) => {
      setOpen(false);
      // The page is already open, so the changes waiting on it are what the row
      // has left to offer.
      if (row.state === 'current') {
        if (!changed) return;
        // The drawer hands focus back to whatever held it when it opened, and
        // the menu is gone by then. The trigger is what outlasts it.
        triggerRef.current?.focus();
        drift?.onReview();
        return;
      }
      if (row.documentId !== null) {
        onOpenLocale(row.documentId);
        return;
      }
      if (row.locale !== null) onAddLocale(row.locale);
    },
    [changed, drift, onOpenLocale, onAddLocale, setOpen],
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
  }, [open, setOpen]);

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
  // What the source did is known from the diff, which the market read has no
  // part in. A page that has changes to take says so and keeps the way to them
  // wherever the list of locales cannot be drawn.
  const reviewRoute = changed && drift !== null
    ? (
        <button
          type="button"
          className={`${styles.trigger} ${structural ? '' : styles.triggerChanged}`}
          data-testid="locale-switcher-drift-alone"
          aria-label={reviewDescription}
          onClick={drift.onReview}
        >
          <Icon iconName="rotate" size="s" aria-hidden="true" />
          <span className={styles.triggerLabel}>
            <span className={styles.triggerName}>{changedLabel}</span>
          </span>
        </button>
      )
    : null;

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
          <Icon iconName="triangleExclamation" size="xs" aria-hidden="true" />
          <span className={styles.triggerLabel}>
            <span className={styles.triggerName}>Locales unavailable</span>
          </span>
        </button>
        {reviewRoute}
      </div>
    );
  }

  const current = rows.find((r) => r.state === 'current');

  if (loading) return null;

  // A site with no markets has no locale dimension to switch along: the only row
  // would be the page already open. A page whose source has moved on still has
  // changes to take, and rows cover the locales a document carries either way.
  if (markets.length === 0 && !changed) return null;

  // Rows are measured against an open page, so without one there is nothing for
  // the trigger to name and nothing for the menu to list.
  if (rows.length === 0) return reviewRoute && <div className={styles.root}>{reviewRoute}</div>;

  const currentLabel = current?.locale === null || current === undefined
    ? null
    : localeLabel(current.locale);

  const currentReview = current?.documentId == null
    ? undefined
    : reviewStatus.get(current.documentId);
  const currentStatus = currentReview === 'translated' || currentReview === 'needsReview'
    ? currentReview
    : undefined;

  // The trigger carries one locale signal. A page whose source has moved on says
  // so in place of its review status: the drift is what there is to act on, and
  // the status it would show says no more than the drift already does.
  const sourceRow = rows.find((row) => row.isSource) ?? null;
  const otherRows = rows.filter((row) => !row.isSource);
  const rowsPerLocale = new Map<string, number>();
  for (const row of otherRows) {
    if (row.locale === null) continue;
    rowsPerLocale.set(row.locale, (rowsPerLocale.get(row.locale) ?? 0) + 1);
  }

  const pathOf = (documentId: string | null): string | null =>
    documentId === null ? null : (documents.find((doc) => doc.id === documentId)?.path ?? null);

  const renderRow = (row: LocaleRow, section: 'source' | 'other'): React.ReactElement => {
    const label = row.locale === null ? null : localeLabel(row.locale);
    const locale = row.locale ?? 'none';
    // Rows are per document, so a locale held by two of them appears twice.
    // Those rows name their page in place of the language they share, which is
    // the only thing that tells them apart.
    const shares = section === 'other' && row.locale !== null && (rowsPerLocale.get(row.locale) ?? 0) > 1;
    const path = shares ? pathOf(row.documentId) : null;
    const key = row.documentId ?? locale;
    const testKey = path === null ? locale : `${locale}-${row.documentId ?? ''}`;
    const status = row.documentId === null ? undefined : reviewStatus.get(row.documentId);
    // The row and the count under it lead to the same place, so they are one
    // target: one thing to hover, one thing to click, one item in the menu.
    const carriesReview = row.state === 'current' && changed && drift !== null;

    return (
      <li key={key} className={styles.item} role="none">
        <button
          type="button"
          role="menuitem"
          data-testid={`locale-row-${testKey}`}
          className={styles.row}
          aria-current={row.state === 'current' ? 'true' : undefined}
          // The row states its locale and what it leads to. Left to its content,
          // the name would be everything the two lines say.
          aria-label={carriesReview
            ? `${label === null ? UNTAGGED_LABEL : label.native}: ${reviewDescription}`
            : undefined}
          onClick={() => choose(row)}
        >
        <span className={styles.rowMain}>
          <span
            className={`${styles.badge} ${row.state === 'available' ? '' : styles.badgeHeld}`}
            data-testid={`locale-badge-${testKey}`}
            aria-hidden="true"
          >
            {label?.tag ?? '—'}
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowName}>
              {label === null
                ? section === 'source'
                  ? SOURCE_UNSET_LABEL
                  : UNTAGGED_LABEL
                : label.native}
              {label?.dir === 'rtl' && (
                <span className={styles.rtl} data-testid={`locale-rtl-${testKey}`}>
                  RTL
                </span>
              )}
            </span>
            {label !== null && (
              <span className={styles.rowSub}>
                {row.state === 'available' ? 'Not localized yet' : (path ?? label.english)}
              </span>
            )}
          </span>
          {section === 'source'
            ? null
            : row.state === 'available'
              ? (
                  <span className={styles.add} data-testid={`locale-add-${testKey}`}>
                    <Icon iconName="plus" size="xs" aria-hidden="true" />
                    Add {label?.tag}
                  </span>
                )
              : row.state === 'current' && changed
                // Structural changes are said once, in the line under the row.
                ? (!structural && (
                    <span className={styles.rowDrift} data-testid={`locale-drift-${testKey}`}>
                      <Icon iconName="rotate" size="s" aria-hidden="true" />
                      {changedLabel}
                    </span>
                  ))
                : label !== null && (
                  status === 'translated' || status === 'needsReview' ? (
                    <StatusIndicator
                      data-testid={`locale-status-${testKey}`}
                      className={styles.status}
                      type={status === 'needsReview' ? 'warning' : 'success'}
                      label={status === 'needsReview' ? 'Needs review' : 'Up to date'}
                    />
                  ) : status === undefined || status === 'checking' ? (
                    <span
                      className={styles.status}
                      data-testid={`locale-status-${testKey}`}
                      role="status"
                      aria-label="Checking translation status"
                    >
                      <Spinner isInline size="m" />
                    </span>
                  ) : (
                    <span className={styles.status} data-testid={`locale-status-${testKey}`}>
                      {status === 'unavailable' ? 'Status unavailable' : 'Source unavailable'}
                    </span>
                  )
                )}
          {row.state === 'current' && (
            <span
              className={styles.current}
              data-testid={`locale-current-${testKey}`}
              aria-hidden="true"
            >
              <Icon iconName="circleCheck" size="s" />
            </span>
          )}
        </span>
        {carriesReview && (
          <span
            className={`${styles.review} ${structural ? styles.reviewNeutral : ''}`}
            data-testid="locale-review-changes"
          >
            <span>{reviewLabel}</span>
            <span className={styles.reviewLink}>
              Review changes
              <Icon iconName="arrowRight" size="s" aria-hidden="true" />
            </span>
          </span>
        )}
        </button>
      </li>
    );
  };

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="locale-switcher-trigger"
        className={`${styles.trigger} ${changed && !structural ? styles.triggerChanged : ''}`}
        title="Switch to another locale version of this page"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <Icon iconName="globe" size="xs" aria-hidden="true" />
        <span className={styles.triggerLabel}>
          <span className={styles.triggerName}>{currentLabel?.native ?? UNTAGGED_LABEL}</span>
          {currentLabel !== null && (
            <span className={styles.triggerBadge}>{currentLabel.tag}</span>
          )}
          {changed ? (
            <span className={styles.triggerDrift} data-testid="locale-switcher-drift">
              <Icon iconName="rotate" size="s" aria-hidden="true" />
              <span className={styles.triggerDriftLabel}>{changedLabel}</span>
            </span>
          ) : (
            currentStatus !== undefined && (
              <StatusIndicator
                data-testid="locale-switcher-status"
                className={styles.triggerStatus}
                type={currentStatus === 'needsReview' ? 'warning' : 'success'}
                label={currentStatus === 'needsReview' ? 'Needs review' : 'Up to date'}
              />
            )
          )}
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
            <ul className={styles.list} role="menu">
              {sourceRow !== null && (
                <>
                  <li className={styles.groupLabel} role="none" aria-hidden="true">
                    Source
                  </li>
                  {renderRow(sourceRow, 'source')}
                </>
              )}
              {otherRows.length > 0 && (
                <>
                  <li className={styles.groupLabel} role="none" aria-hidden="true">
                    Other locales
                  </li>
                  {otherRows.map((row) => renderRow(row, 'other'))}
                </>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
