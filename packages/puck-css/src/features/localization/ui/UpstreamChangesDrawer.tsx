/**
 * Upstream Changes Drawer
 *
 * The list of what a derived page has yet to take from the page it derives
 * from, and the actions that settle each one. Its head names both sides of the
 * comparison and how far apart they are.
 */

import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { SlideOverDrawer } from '../../../editor/components/SlideOverDrawer.js';
import { localeLabel } from '../locale-labels.js';
import type { UpstreamRelationType } from '../upstream-diff-query.js';
import type { UpstreamReview } from '../useUpstreamReview.js';
import { UpstreamChangesPanel } from './UpstreamChangesPanel.js';
import styles from './UpstreamChanges.module.css';

const EYEBROW: Record<UpstreamRelationType, string> = {
  localization: 'Locale diff',
  template: 'Template diff',
};

export interface UpstreamChangesDrawerProps {
  review: UpstreamReview;
  open: boolean;
  onClose: () => void;
  documentPath: string;
  documentLocale: string | undefined;
}

/** How far the page is behind its source, as the drawer's head puts it. */
function changesBehindLabel(outstanding: number, fromVersion: number): string {
  return `${String(outstanding)} ${outstanding === 1 ? 'change' : 'changes'} since v${String(fromVersion)}`;
}

export function UpstreamChangesDrawer({
  review,
  open,
  onClose,
  documentPath,
  documentLocale,
}: UpstreamChangesDrawerProps): React.ReactElement | null {
  const { diff, relationType, outstanding, structuralOnly } = review;
  if (diff.state !== 'ready') return null;

  const isLocalization = relationType === 'localization';
  const { summary } = diff;
  const locale = documentLocale === undefined ? null : localeLabel(documentLocale);

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      ariaLabel={isLocalization ? 'Source changes' : 'Template changes'}
      testId="upstream-changes-drawer"
      eyebrow={
        <>
          <Icon iconName={isLocalization ? 'rotate' : 'codeBranch'} size="s" aria-hidden="true" />
          {EYEBROW[relationType]}
        </>
      }
      title={documentPath}
      meta={
        <div className={styles.versions}>
          <span className={styles.side}>
            {isLocalization ? 'Source' : 'Template'} · v{String(summary.toVersion)}
          </span>
          <span aria-hidden="true">→</span>
          <span className={styles.side}>
            {locale !== null && <span className={styles.flag}>{locale.tag}</span>}
            {locale === null ? 'This page' : locale.native} · synced from v
            {String(summary.fromVersion)}
          </span>
          {(outstanding > 0 || structuralOnly) && (
            <span className={styles.behind} data-testid="upstream-changes-behind">
              {structuralOnly
                ? 'Structure changed'
                : changesBehindLabel(outstanding, summary.fromVersion)}
            </span>
          )}
        </div>
      }
    >
      <UpstreamChangesPanel
        diff={diff}
        documentLocale={documentLocale}
        dismissed={review.dismissed}
        isPending={review.isPending}
        onResolve={(entry) => review.resolve(entry, summary)}
        session={review.session}
      />
    </SlideOverDrawer>
  );
}
