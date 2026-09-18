import type { ChangeClassification, ChangeSummaryEntry } from '@pantheon-systems/css-client';
import { Button } from '@pantheon-systems/pds-toolkit-react';
import { useState } from 'react';
import { muted } from '../../../data/styles.js';
import type { UpstreamDiff } from '../upstream-diff-query.js';
import { dismissalKey, entryKey, type ReviewSession } from '../review-session.js';
import { UpstreamChangeRow } from './UpstreamChangeRow.js';
import styles from './UpstreamChanges.module.css';

export interface UpstreamChangesPanelProps {
  diff: Extract<UpstreamDiff, { state: 'ready' }>;
  documentLocale: string | undefined;
  dismissed: ReadonlySet<string>;
  onResolve: (entry: ChangeSummaryEntry) => void;
  isPending: (entry: ChangeSummaryEntry) => boolean;
  session: ReviewSession;
}

const GROUPS: Record<ChangeClassification, { label: string; color: string; summary: string }> = {
  needsTranslation: {
    label: 'Content might need translation',
    color: '#b45309',
    summary: 'The source changed since this was translated.',
  },
  autoApplied: {
    label: 'Inherited values',
    color: '#16a34a',
    summary: 'These source values can be adopted directly.',
  },
  prop: {
    label: 'Field changes',
    color: '#2563eb',
    summary: 'The source changed these values.',
  },
  advisory: {
    label: 'Locale-managed',
    color: '#6b7280',
    summary: 'This page owns these values. Source changes are advisory only.',
  },
  structural: {
    label: 'Page structure',
    color: '#7c3aed',
    summary: 'Page blocks have changed on the source. Reconcile these on the canvas.',
  },
};

const STRUCTURAL_PREVIEW_COUNT = 3;

export function UpstreamChangesPanel({
  diff,
  documentLocale,
  dismissed,
  onResolve,
  isPending,
  session,
}: UpstreamChangesPanelProps) {
  const summary = diff.summary;
  const changes = summary.changes.filter((entry) => !dismissed.has(dismissalKey(summary, entry)));

  return (
    <>
      {diff.staleReason !== null && (
        <p role="status" data-testid="upstream-refresh-failed">
          {diff.staleReason}. Showing the last list read.
        </p>
      )}
      {changes.length === 0 && (
        <p style={muted} data-testid="upstream-all-clear">
          Every reported change has been dealt with.
        </p>
      )}
      {(Object.keys(GROUPS) as ChangeClassification[]).map((classification) => {
        const entries = changes.filter((entry) => entry.classification === classification);
        if (!entries.length) return null;

        const group = GROUPS[classification];

        if (classification === 'structural') {
          return (
            <StructuralChanges
              key={classification}
              entries={entries}
              group={group}
              summary={summary}
              documentLocale={documentLocale}
              session={session}
            />
          );
        }

        return (
          <section
            key={classification}
            data-testid={`upstream-group-${classification}`}
            className={styles.group}
          >
            <h3 className={styles.groupHead}>
              <span className={styles.groupDot} style={{ background: group.color }} />
              {group.label}
              <span className={styles.groupCount} data-testid={`upstream-count-${classification}`}>
                {entries.length}
              </span>
            </h3>
            <p className={styles.groupSub}>{group.summary}</p>
            {entries.map((entry) => (
              <UpstreamChangeRow
                key={entryKey(entry)}
                entry={entry}
                summary={summary}
                documentLocale={documentLocale}
                session={session}
                pending={isPending(entry)}
                onResolve={() => onResolve(entry)}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}

function StructuralChanges({ entries, group, summary, documentLocale, session }: {
  entries: ChangeSummaryEntry[];
  group: (typeof GROUPS)['structural'];
  summary: Extract<UpstreamDiff, { state: 'ready' }>['summary'];
  documentLocale: string | undefined;
  session: ReviewSession;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, entries.length - STRUCTURAL_PREVIEW_COUNT);
  const visibleEntries = expanded ? entries : entries.slice(0, STRUCTURAL_PREVIEW_COUNT);
  const label = expanded
    ? 'Show fewer structural changes'
    : `Show ${hiddenCount} more structural ${hiddenCount === 1 ? 'change' : 'changes'}`;

  // Temporary: structural changes are informational until CCR can persist their resolution.
  return (
    <section className={styles.group} data-testid="upstream-structural-disclosure">
      <div className={styles.structuralHead}>
        <h3 className={styles.groupHead}>
          <span className={styles.groupDot} style={{ background: group.color }} />
          {group.label}
          <span className={styles.groupCount} data-testid="upstream-count-structural">
            {entries.length}
          </span>
        </h3>
        {hiddenCount > 0 && (
          <Button
            label={label}
            variant="subtle"
            size="s"
            iconName={expanded ? 'angleUp' : 'angleDown'}
            displayType="icon-end"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          />
        )}
      </div>
      <p className={styles.groupSub}>
        Compared with the source version used to create this localization.
      </p>
      <div
        className={expanded ? styles.structuralListExpanded : undefined}
        data-testid="upstream-structural-list"
      >
        {visibleEntries.map((entry) => (
          <UpstreamChangeRow
            key={entryKey(entry)}
            entry={entry}
            summary={summary}
            documentLocale={documentLocale}
            session={session}
            pending={false}
            onResolve={() => {}}
          />
        ))}
      </div>
    </section>
  );
}
