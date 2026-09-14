/**
 * Upstream Changes Panel
 *
 * A single relation-agnostic list of how the current page has drifted from what
 * it derives from (a localization canonical or a content-type template), and the
 * controls to reconcile each change. The backend classifies each change; this
 * panel groups them and renders the control that fits each classification.
 * Applies flow through the editor's setData dispatch, so reconciliation rides the
 * normal document autosave rather than a dedicated reconcile endpoint.
 *
 * UpstreamChangesControl supplies the surrounding chrome, so this renders the
 * list alone.
 */

import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createUsePuck, useGetPuck } from '@puckeditor/core';
import type {
  ChangeClassification,
  ChangeSummary,
  ChangeSummaryEntry,
  P1Client,
} from '@pantheon-systems/css-client';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import { useP1SdkQueryClient } from '../../../data/query-provider.js';
import { PropValueDisplay } from '../../../versioning/components/version-compare/index.js';
import { ghostButton, muted, primaryButton } from '../../../data/styles.js';
import { derivesFromUpstream } from '../relation.js';
import { useUpstreamDiff, upstreamDiffQueryKey } from '../upstream-diff-query.js';
import { localeLabel, type LocaleLabel } from '../locale-labels.js';
import { applyUpstreamProp, type PuckDataShape } from '../upstream-apply.js';
import styles from './UpstreamChanges.module.css';

export interface UpstreamChangesPanelProps {
  /** Which derivation edge to reconcile. The panel is otherwise identical. */
  relationType?: 'localization' | 'template';
  /** Changes dismissed without an edge to record on, held by the caller. */
  dismissed?: ReadonlySet<string>;
  onDismiss?: (key: string) => void;
}

const usePuckState = createUsePuck();

interface ClassificationMeta {
  label: string;
  /** The dot beside the heading, tying a group to the severity it carries. */
  color: string;
  /** What the group means, in the terms the reconciler has to decide in. */
  summary: string;
  /** Who owns the value, shown against each change in the group. */
  ownership?: string;
}

const CLASSIFICATION_ORDER: ChangeClassification[] = [
  'needsTranslation',
  'autoApplied',
  'prop',
  'advisory',
  'structural',
];

const CLASSIFICATION_META: Record<ChangeClassification, ClassificationMeta> = {
  needsTranslation: {
    label: 'Needs translation',
    color: '#b45309',
    summary: 'Source-owned content changed. The translation is stale.',
    ownership: 'source-owned',
  },
  autoApplied: {
    label: 'Auto-applied',
    color: '#16a34a',
    summary: 'The source value carries straight over.',
    ownership: 'source-owned',
  },
  prop: {
    label: 'Prop changes',
    color: '#2563eb',
    summary: 'The source changed these values.',
  },
  advisory: {
    label: 'Locale-managed',
    color: '#6b7280',
    summary: 'This page owns these values. Source changes are advisory only.',
    ownership: 'locale-owned',
  },
  structural: {
    label: 'Structural',
    color: '#7c3aed',
    summary: 'A component was added or removed on the source. Reconcile it on the canvas.',
  },
};

export function entryKey(entry: ChangeSummaryEntry): string {
  return `${entry.classification}:${entry.componentId}:${entry.propPath ?? ''}`;
}

const NOTHING_DISMISSED: ReadonlySet<string> = new Set();

/**
 * Identifies one canonical value seeded into one field. A canonical that has
 * moved on carries a different value, so it reads as unseeded and can be taken.
 */
function seedKey(entry: ChangeSummaryEntry): string {
  return `${entryKey(entry)}:${JSON.stringify(entry.upstreamNewValue) ?? 'undefined'}`;
}

export function UpstreamChangesPanel({
  relationType = 'localization',
  dismissed = NOTHING_DISMISSED,
  onDismiss,
}: UpstreamChangesPanelProps): React.ReactElement | null {
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
    // Dismissals and the fetched summary belong to the document being
    // reconciled; keying on it resets both when the document changes.
    <UpstreamChanges
      key={currentDocument.id}
      client={client}
      siteId={siteId}
      branchId={branchId}
      documentId={currentDocument.id}
      documentLocale={currentDocument.locale}
      relationType={relationType}
      dismissed={dismissed}
      onDismiss={onDismiss}
    />
  );
}

interface UpstreamChangesProps {
  client: P1Client;
  siteId: string;
  branchId: string;
  documentId: string;
  documentLocale: string | undefined;
  relationType: 'localization' | 'template';
  dismissed: ReadonlySet<string>;
  onDismiss: ((key: string) => void) | undefined;
}

function UpstreamChanges({
  client,
  siteId,
  branchId,
  documentId,
  documentLocale,
  relationType,
  dismissed,
  onDismiss,
}: UpstreamChangesProps): React.ReactElement | null {
  // Selected rather than read off the whole store: a panel subscribed to all of
  // Puck's state re-renders on every keystroke in the canvas.
  const dispatch = usePuckState((state) => state.dispatch);
  const getPuck = useGetPuck();
  const queryClient = useP1SdkQueryClient();
  const notifications = useP1PuckOptional()?.notifications;

  // A change needing translation stays listed once its draft is seeded, so the
  // button is still there to press. Pressing it again writes the canonical
  // wording over whatever has been translated since, so a value already seeded
  // is not seeded twice.
  const [seeded, setSeeded] = useState<ReadonlySet<string>>(new Set());

  const diff = useUpstreamDiff(client, siteId, branchId, documentId, relationType);
  const summary = diff.state === 'ready' ? diff.summary : undefined;

  const diffQueryKey = upstreamDiffQueryKey(siteId, branchId, documentId, relationType);

  const resolveMutation = useMutation(
    {
      mutationFn: (variables: {
        key: string;
        slotId: string;
        propPath: string;
        upstreamVersion: number;
      }) =>
        client.relations.setUpstreamResolutions(
          siteId,
          branchId,
          documentId,
          [{ slotId: variables.slotId, propPath: variables.propPath }],
          variables.upstreamVersion,
        ),
      // The entry leaves the list on the click rather than on the refetch, so the
      // list and the resolution being recorded agree while the write is in flight.
      onMutate: async (variables) => {
        // A read already on the wire would otherwise land after this edit and put
        // the entry back for as long as the write takes.
        await queryClient.cancelQueries({ queryKey: diffQueryKey });
        let removed: { entry: ChangeSummaryEntry; index: number } | undefined;
        queryClient.setQueryData(diffQueryKey, (prev: ChangeSummary | undefined) => {
          if (prev === undefined) return prev;
          const index = prev.changes.findIndex((c) => entryKey(c) === variables.key);
          const entry = prev.changes[index];
          if (entry === undefined) return prev;
          const changes = [...prev.changes];
          changes.splice(index, 1);
          removed = { entry, index };
          return { ...prev, changes };
        });
        return removed;
      },
      onError: (error: Error, _variables, removed) => {
        // An unrecorded change is still outstanding, so it goes back where it was
        // rather than to the end of its group. Only this entry is restored: a
        // whole-summary rollback would resurrect a sibling resolved while this
        // write was in flight. The refetch below cannot stand in for the restore,
        // because whatever failed the write usually fails the read as well, and a
        // list left pruned would contradict the message.
        if (removed !== undefined) {
          const { entry, index } = removed;
          queryClient.setQueryData(diffQueryKey, (prev: ChangeSummary | undefined) => {
            if (prev === undefined || prev.changes.some((c) => entryKey(c) === entryKey(entry))) {
              return prev;
            }
            const changes = [...prev.changes];
            changes.splice(index, 0, entry);
            return { ...prev, changes };
          });
        }
        notifications?.addError(
          `Could not record that change as reconciled: ${error.message}. It is still listed.`,
        );
      },
      // The canonical is the authority on what is outstanding; the edits above
      // only hold the list steady until it answers.
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: diffQueryKey });
      },
    },
    queryClient,
  );

  const resolveEntry = (entry: ChangeSummaryEntry) => {
    // The version the listed changes were computed against, so settling records the
    // state the translator was shown rather than whatever the canonical has reached.
    const upstreamVersion = summary?.toVersion;
    if (
      relationType !== 'localization' ||
      entry.propPath === undefined ||
      upstreamVersion === undefined
    ) {
      // A page derived from a template has no edge to hold a resolution, so the
      // dismissal is only remembered for as long as the page is open.
      onDismiss?.(entryKey(entry));
      return;
    }
    resolveMutation.mutate({
      key: entryKey(entry),
      slotId: entry.componentId,
      propPath: entry.propPath,
      upstreamVersion,
    });
  };

  const applyEntry = (entry: ChangeSummaryEntry) => {
    const { propPath } = entry;
    if (!propPath) return;
    const data = getPuck().appState.data as unknown as PuckDataShape;
    // applyUpstreamProp returns its input when the document holds no such
    // component. The change is still outstanding, so it stays in the list.
    if (applyUpstreamProp(data, entry.componentId, propPath, entry.upstreamNewValue) === data) {
      notifications?.addError(
        `Nothing to update: this page no longer holds ${entry.componentId}. Reconcile it on the canvas.`,
      );
      return;
    }
    // An apply overwrites whatever the author had here, so it has to be
    // undoable; Puck keeps setData out of history unless asked.
    //
    // The updater runs against the document as it stands when the reducer does,
    // so a remote edit or an autosave dispatched in between survives.
    dispatch({
      type: 'setData',
      recordHistory: true,
      data: (previous: PuckDataShape) =>
        applyUpstreamProp(previous, entry.componentId, propPath, entry.upstreamNewValue),
    } as never);
    // A change needing translation is only seeded here, not settled: the field now
    // holds the canonical's wording and still wants translating, so it stays on the
    // list until someone marks it done. Every other apply takes the canonical value
    // as final.
    if (entry.classification === 'needsTranslation') {
      setSeeded((prev) => new Set(prev).add(seedKey(entry)));
      return;
    }
    // The edit lands first: a resolution that fails to record leaves the change
    // listed, where taking it again is harmless.
    resolveEntry(entry);
  };

  const grouped = useMemo(() => {
    const map = new Map<ChangeClassification, ChangeSummaryEntry[]>();
    for (const change of summary?.changes ?? []) {
      if (dismissed.has(entryKey(change))) continue;
      const list = map.get(change.classification) ?? [];
      list.push(change);
      map.set(change.classification, list);
    }
    return map;
  }, [summary, dismissed]);

  // A page whose upstream edge is gone has nothing to reconcile, and the
  // toolbar has already withheld the control that opens this.
  if (diff.state === 'noEdge') return null;
  if (diff.state === 'checking') {
    return <p style={{ ...muted }}>Checking for upstream changes…</p>;
  }
  if (diff.state === 'unavailable') {
    return <p style={{ color: '#be123c', margin: 0 }}>{diff.message}</p>;
  }

  const upstreamLabel = relationType === 'localization' ? 'Canonical' : 'Template';
  const locale = documentLocale === undefined ? null : localeLabel(documentLocale);

  // The changes already read are still worth acting on, so a failed refresh is
  // reported beside the list rather than in place of it.
  const staleNotice =
    diff.staleReason === null ? null : (
      <p
        style={{ color: '#b45309', margin: '0 0 0.75rem' }}
        role="status"
        data-testid="upstream-refresh-failed"
      >
        {diff.staleReason}. Showing the last list read.
      </p>
    );

  if (grouped.size === 0) {
    return (
      <>
        {staleNotice}
        <p style={{ ...muted, margin: 0 }} data-testid="upstream-all-clear">
          Every reported change has been dealt with.
        </p>
      </>
    );
  }

  return (
    <>
      {staleNotice}
      {CLASSIFICATION_ORDER.map((c) => {
        const entries = grouped.get(c);
        if (!entries || entries.length === 0) return null;
        const meta = CLASSIFICATION_META[c];
        return (
          <section key={c} data-testid={`upstream-group-${c}`} className={styles.group}>
            <h3 className={styles.groupHead}>
              <span className={styles.groupDot} style={{ background: meta.color }} />
              {meta.label}
              <span className={styles.groupCount} data-testid={`upstream-count-${c}`}>
                {entries.length}
              </span>
            </h3>
            <p className={styles.groupSub}>{meta.summary}</p>
            {entries.map((entry) => (
              <UpstreamChangeEntry
                key={entryKey(entry)}
                entry={entry}
                ownership={meta.ownership}
                upstreamLabel={upstreamLabel}
                upstreamVersion={diff.summary.toVersion}
                syncedVersion={diff.summary.fromVersion}
                locale={locale}
                seeded={seeded.has(seedKey(entry))}
                onApply={() => applyEntry(entry)}
                onResolve={() => resolveEntry(entry)}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}

interface UpstreamChangeEntryProps {
  entry: ChangeSummaryEntry;
  /** Who owns the value, when the classification settles that. */
  ownership: string | undefined;
  upstreamLabel: string;
  upstreamVersion: number;
  syncedVersion: number;
  /** The language this page's content is written in, where it declares one. */
  locale: LocaleLabel | null;
  /** Whether this canonical value has already been written into the field. */
  seeded: boolean;
  onApply: () => void;
  onResolve: () => void;
}

function UpstreamChangeEntry({
  entry,
  ownership,
  upstreamLabel,
  upstreamVersion,
  syncedVersion,
  locale,
  seeded,
  onApply,
  onResolve,
}: UpstreamChangeEntryProps): React.ReactElement {
  if (entry.classification === 'structural') {
    return (
      <div className={styles.row}>
        <div className={styles.field}>
          <span className={styles.ownership}>{entry.structuralKind ?? 'changed'}</span>
          {entry.componentId}
        </div>
        <p className={styles.note} data-testid="upstream-structural-note">
          {entry.structuralKind
            ? `A slot was ${entry.structuralKind} upstream`
            : 'Structural change upstream'}{' '}
          ({entry.componentId}). Reconcile this on the canvas.
        </p>
      </div>
    );
  }

  const isAdvisory = entry.classification === 'advisory';

  return (
    <div className={styles.row}>
      <div className={styles.field}>
        {entry.propPath ?? entry.componentId}
        {ownership !== undefined && <span className={styles.ownership}>{ownership}</span>}
      </div>

      <div className={styles.cols}>
        <div className={styles.col}>
          <span className={styles.colLabel}>
            {upstreamLabel} · v{String(upstreamVersion)}
          </span>
          {/* No locale names the canonical's language, so the value's own
              characters are what its direction is read from. */}
          <span
            className={`${styles.value} ${isAdvisory ? styles.valueMuted : ''}`}
            data-testid="upstream-new-value"
            dir="auto"
          >
            <PropValueDisplay value={entry.upstreamNewValue} />
          </span>
        </div>
        <div className={styles.col}>
          <span className={styles.colLabel}>
            {locale === null ? 'This page' : locale.tag} ·{' '}
            {isAdvisory ? 'kept' : `v${String(syncedVersion)} (stale)`}
          </span>
          {/* The two values are in different languages, so each carries its own
              direction and language: an Arabic or Japanese value laid out under
              the page's direction reads wrong. */}
          <span
            className={`${styles.value} ${isAdvisory ? '' : styles.valueStale}`}
            data-testid="upstream-current-value"
            dir={locale?.dir ?? 'auto'}
            lang={locale?.lang}
          >
            <PropValueDisplay value={entry.documentValue} />
          </span>
        </div>
      </div>

      <div className={styles.actions}>
        {entry.classification === 'needsTranslation' ? (
          <>
            <button
              type="button"
              data-testid="upstream-apply-draft"
              onClick={onApply}
              disabled={seeded}
              title={seeded ? 'The canonical wording is in the field, ready to translate.' : undefined}
              style={{ ...primaryButton, ...(seeded ? { opacity: 0.6, cursor: 'default' } : {}) }}
            >
              {seeded ? 'Draft applied' : 'Apply as draft to translate'}
            </button>
            <button
              type="button"
              data-testid="upstream-mark-done"
              onClick={onResolve}
              style={{ ...ghostButton }}
            >
              Mark done
            </button>
          </>
        ) : isAdvisory ? (
          <button
            type="button"
            data-testid="upstream-dismiss"
            onClick={onResolve}
            style={{ ...ghostButton }}
          >
            Dismiss
          </button>
        ) : (
          <button
            type="button"
            data-testid="upstream-apply"
            onClick={onApply}
            style={{ ...primaryButton }}
          >
            Apply update
          </button>
        )}
      </div>
    </div>
  );
}
