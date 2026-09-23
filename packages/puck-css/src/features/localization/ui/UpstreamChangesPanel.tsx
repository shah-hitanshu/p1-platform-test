import type { ChangeClassification, ChangeSummaryEntry } from '@pantheon-systems/css-client';
import { Icon, SectionMessage } from '@pantheon-systems/pds-toolkit-react';
import { useState } from 'react';
import { muted } from '../../../data/styles.js';
import type { UpstreamDiff } from '../upstream-diff-query.js';
import { dismissalKey, entryKey, type ReviewSession } from '../review-session.js';
import { UpstreamChangeRow } from './UpstreamChangeRow.js';
import styles from './UpstreamChanges.module.css';
import { structuralSummary } from './upstream-change-presentation.js';

export interface UpstreamChangesPanelProps {
  diff: Extract<UpstreamDiff, { state: 'ready' }>;
  documentLocale: string | undefined;
  dismissed: ReadonlySet<string>;
  onResolve: (entry: ChangeSummaryEntry) => void;
  isPending: (entry: ChangeSummaryEntry) => boolean;
  session: ReviewSession;
}

type ReportedClassification = Exclude<ChangeClassification, 'advisory'>;

const GROUPS: Record<ReportedClassification, { label: string; color: string; summary: string }> = {
  needsTranslation: {
    label: 'Needs translation',
    color: '#b45309',
    summary: 'The source changed after this was translated.',
  },
  autoApplied: {
    label: 'From source',
    color: '#16a34a',
    summary: 'These follow the source locale.',
  },
  prop: {
    label: 'Field changes',
    color: '#2563eb',
    summary: 'The source changed these values.',
  },
  structural: {
    label: 'Page structure',
    color: '#7c3aed',
    summary: '',
  },
};

/**
 * The drawer explains itself the first time a reader meets an out-of-sync page,
 * then stays out of the way. Session storage rather than local: the explanation
 * is worth repeating to someone who comes back tomorrow, not on every open.
 */
const NOTE_KEY = 'p1.localization.out-of-sync-note-seen';

function noteSeen(): boolean {
  try {
    return sessionStorage.getItem(NOTE_KEY) === '1';
  } catch {
    // Storage is unreachable in private browsing, where nothing is remembered anyway.
    return false;
  }
}

function markNoteSeen(): void {
  try {
    sessionStorage.setItem(NOTE_KEY, '1');
  } catch {
    // Nothing to fall back to; the note shows again next time.
  }
}

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

  // Structural changes are reported, not reconciled here, so a page holding only
  // those is not what the note is explaining.
  const outOfSync = changes.some((entry) => entry.classification !== 'structural');
  // The explanation is spent when a reader dismisses it, not when it is drawn:
  // a drawer opened and closed on the way past has explained nothing. It tracks
  // the list too, so a page that only later has changes to take still gets it.
  const [noteDismissed, setNoteDismissed] = useState(noteSeen);
  const noteOpen = outOfSync && !noteDismissed;

  return (
    <>
      {noteOpen && (
        <SectionMessage
          className={styles.sessionNote}
          data-testid="upstream-out-of-sync-note"
          type="discovery"
          isDismissible
          onDismiss={() => {
            setNoteDismissed(true);
            markNoteSeen();
          }}
          title={'What "out of sync" means'}
          message="The source changed after this locale was translated. Take the source wording with Replace with Source, or write your own, then Mark done."
        />
      )}
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
      {(Object.keys(GROUPS) as ReportedClassification[]).map((classification) => {
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
        </h3>
        {hiddenCount > 0 && (
          <button
            type="button"
            className={styles.structuralToggle}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {label}
            <Icon iconName={expanded ? 'angleUp' : 'angleDown'} size="xs" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className={styles.groupSub}>
        {structuralSummary(entries.length, summary.relationType === 'localization' ? 'source' : 'template')}
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
