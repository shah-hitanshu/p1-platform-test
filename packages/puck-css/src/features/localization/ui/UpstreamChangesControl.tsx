/**
 * Upstream Changes Control
 *
 * The toolbar's entry to reconciling a derived page. The pill carries how many
 * changes are outstanding and appears only while there are any, so a page with
 * nothing to reconcile takes no toolbar room.
 * Opening it raises the drawer that lists and settles those changes.
 */

import React, { useCallback, useState } from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import { SlideOverDrawer } from '../../../editor/components/SlideOverDrawer.js';
import { localeLabel } from '../locale-labels.js';
import { derivesFromUpstream } from '../relation.js';
import { useUpstreamDiff, type UpstreamRelationType } from '../upstream-diff-query.js';
import { dismissalKey, useReviewSession } from '../review-session.js';
import { useUpstreamResolution } from '../useUpstreamResolution.js';
import { UpstreamChangesPanel } from './UpstreamChangesPanel.js';
import styles from './UpstreamChanges.module.css';

export interface UpstreamChangesControlProps {
  /** Which derivation edge to reconcile. The control is otherwise identical. */
  relationType?: UpstreamRelationType;
}

const EYEBROW: Record<UpstreamRelationType, string> = {
  localization: 'Locale diff',
  template: 'Template diff',
};

export function UpstreamChangesControl({
  relationType = 'localization',
}: UpstreamChangesControlProps): React.ReactElement | null {
  const css = useP1PuckOptional();
  const client = css?.client;
  const siteId = css?.siteId;
  const branchId = css?.branchId;
  const currentDocument = css?.currentDocument;

  if (
    !client ||
    !siteId ||
    !branchId ||
    !currentDocument ||
    !derivesFromUpstream(relationType, currentDocument)
  ) {
    return null;
  }

  return (
    // The drawer's open state and the summary belong to the page being
    // reconciled; keying on it closes the drawer when the page changes.
    <UpstreamChangesTrigger
      key={`${siteId}:${branchId}:${currentDocument.id}:${relationType}`}
      relationType={relationType}
      documentId={currentDocument.id}
      documentPath={currentDocument.path}
      documentLocale={currentDocument.locale}
      client={client}
      siteId={siteId}
      branchId={branchId}
    />
  );
}

interface UpstreamChangesTriggerProps {
  relationType: UpstreamRelationType;
  documentId: string;
  documentPath: string;
  documentLocale: string | undefined;
  client: NonNullable<ReturnType<typeof useP1PuckOptional>>['client'];
  siteId: string;
  branchId: string;
}

function UpstreamChangesTrigger({
  relationType,
  documentId,
  documentPath,
  documentLocale,
  client,
  siteId,
  branchId,
}: UpstreamChangesTriggerProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);

  // Recovery and in-flight resolutions belong to the editing session, not the drawer.
  const session = useReviewSession();
  const close = useCallback(() => setOpen(false), []);

  // A change with no edge to record on is dismissed here rather than in the
  // panel: the count on the pill has to agree with the list, and the panel only
  // exists while the drawer is open.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const dismiss = useCallback(
    (key: string) => setDismissed((prev) => new Set(prev).add(key)),
    [],
  );

  const diff = useUpstreamDiff(client, siteId, branchId, documentId, relationType);
  const resolution = useUpstreamResolution(client, siteId, branchId, documentId, relationType);

  if (diff.state === 'checking' || diff.state === 'noEdge') return null;

  // A check that failed knows of no changes, exactly as a page in sync does.
  // Standing down on both would make the two indistinguishable, so a page whose
  // drift is unknown says so and offers the check again. There is no list behind
  // it to open.
  if (diff.state === 'unavailable') {
    return (
      <button
        type="button"
        className={styles.pill}
        data-testid="upstream-changes-unavailable"
        onClick={diff.retry}
        title={diff.message}
        aria-label={`Upstream changes could not be checked: ${diff.message}. Check again.`}
      >
        <Icon iconName="codeBranch" size="xs" aria-hidden="true" />
        Check failed
      </button>
    );
  }

  const { summary } = diff;
  const visibleChanges = summary.changes.filter(
    (change) => !dismissed.has(dismissalKey(summary, change)),
  );
  const outstanding = visibleChanges.filter((change) => change.classification !== 'structural').length;
  const structuralOnly = outstanding === 0
    && visibleChanges.some((change) => change.classification === 'structural');

  // The two version numbers are counted on their own branches, so the distance
  // between them is not a quantity. The list is: every change it holds is one
  // the page has yet to take.
  const sourceName = relationType === 'localization' ? 'source' : 'template';
  const changeCount = `${String(outstanding)} ${sourceName} ${outstanding === 1 ? 'change' : 'changes'}`;
  const label = `${changeCount} since v${String(summary.fromVersion)}`;
  const locale = documentLocale === undefined ? null : localeLabel(documentLocale);

  // Only the pill answers to the count. An open drawer stays up when the last
  // change is settled: pulling it out from under the reader loses their place,
  // and a write that then fails would leave the change listed with no way back
  // to it. The drawer retires itself a transition after it is closed.
  return (
    <>
      {(outstanding > 0 || structuralOnly) && (
        <button
          type="button"
          className={`${styles.pill} ${structuralOnly ? styles.pillNeutral : ''}`}
          data-testid={structuralOnly ? 'upstream-structural-changes-pill' : 'upstream-changes-pill'}
          onClick={() => setOpen(true)}
          aria-label={structuralOnly
            ? `View structural changes from the ${sourceName}`
            : `Review ${String(outstanding)} upstream ${outstanding === 1 ? 'change' : 'changes'}`}
        >
          <Icon iconName="globe" size="xs" aria-hidden="true" />
          {structuralOnly ? 'Structure changed' : label}
        </button>
      )}

      <SlideOverDrawer
        open={open}
        onClose={close}
        ariaLabel={relationType === 'localization' ? 'Source changes' : 'Template changes'}
        testId="upstream-changes-drawer"
        eyebrow={
          <>
            <Icon iconName="codeBranch" size="xs" aria-hidden="true" />
            {EYEBROW[relationType]}
          </>
        }
        title={documentPath}
        meta={
          <div className={styles.versions}>
            <span className={styles.side}>
              {relationType === 'localization' ? 'Source' : 'Template'} · v
              {String(summary.toVersion)}
            </span>
            <span aria-hidden="true">→</span>
            <span className={styles.side}>
              {locale !== null && <span className={styles.flag}>{locale.tag}</span>}
              {locale === null ? 'This page' : locale.native} · synced from v
              {String(summary.fromVersion)}
            </span>
            {(outstanding > 0 || structuralOnly) && (
              <span className={styles.behind} data-testid="upstream-changes-behind">
                {structuralOnly ? 'Structure changed' : label}
              </span>
            )}
          </div>
        }
      >
        <UpstreamChangesPanel
          diff={diff}
          documentLocale={documentLocale}
          dismissed={dismissed}
          isPending={resolution.isPending}
          onResolve={(entry) => {
            if (relationType === 'localization' && entry.propPath !== undefined) {
              resolution.resolve(entry, summary);
            } else {
              dismiss(dismissalKey(summary, entry));
            }
          }}
          session={session}
        />
      </SlideOverDrawer>
    </>
  );
}
