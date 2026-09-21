import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Textarea } from '@pantheon-systems/pds-toolkit-react';
import type { AgentProposalComment } from '@pantheon-systems/css-client';

import { SafeIcon } from '../../../pds/components/SafeIcon.js';
import { describeChanges, type ProposalChange } from '../proposal-preview.js';
import { useProposalPreviewSource } from '../proposal-preview-context.js';
import { agentName, type ProposalActions } from '../proposals.js';
import { relativeTime } from '../relative-time.js';
import styles from './ProposalCard.module.css';

export interface ProposalCardProps {
  comment: AgentProposalComment;
  actions?: ProposalActions;
  /** The moment to measure the decision's age from. */
  now: number;
}

function isEditingKey(e: React.KeyboardEvent): boolean {
  return e.key === 'Backspace' || e.key === 'Delete';
}

function changeCount(n: number): string {
  return n === 1 ? '1 change' : `${n} changes`;
}

function sameBlock(changes: ProposalChange[]): string | undefined {
  const [first] = changes;
  return first?.block && changes.every((c) => c.block === first.block) ? first.block : undefined;
}

function afterText(change: ProposalChange): string {
  if (change.kind === 'remove') return 'Removed';
  if (change.kind === 'move') return 'Moved';
  return change.after ?? '—';
}

function Preview({ change, heading }: { change: ProposalChange; heading?: string }): React.ReactElement {
  return (
    <div className={styles.change} data-testid="agent-proposal-change">
      {heading && <span className={styles.changeField}>{heading}</span>}
      <div className={styles.diff}>
        <div className={styles.side}>
          <span className={`${styles.sideLabel} ${styles.beforeLabel}`}>Before</span>
          <span className={styles.before} data-testid="agent-proposal-before">
            {change.before ?? (change.kind === 'add' ? 'Nothing' : '—')}
          </span>
        </div>
        <div className={styles.side}>
          <span className={`${styles.sideLabel} ${styles.afterLabel}`}>After</span>
          <span className={styles.after} data-testid="agent-proposal-after">
            {afterText(change)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * An agent's proposed edit and what became of it.
 *
 * Names the block and field the change lands in, gives the agent's reason, and shows
 * the text before and after. While the proposal waits, the reader can put it into the
 * page, set it aside, or open a note to send the agent to try again with. One being
 * applied keeps its buttons, since the service refuses a second accept while the first
 * is at work and lets one through once that accept has evidently given up. Once decided,
 * the card collapses to a line saying who decided and how, so the thread keeps the
 * record after the buttons are gone.
 */
export function ProposalCard({ comment, actions, now }: ProposalCardProps): React.ReactElement {
  const { summary, operations, status, decidedBy, decidedAt } = comment.metadata;
  const source = useProposalPreviewSource();
  const changes = describeChanges(operations, source);
  const block = sameBlock(changes);
  const single = changes.length === 1 ? changes[0] : undefined;
  const refineId = useId();
  const refineRef = useRef<HTMLDivElement>(null);
  const [refining, setRefining] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const deciding = actions?.deciding === comment.id;
  const failed = actions?.failed === comment.id;
  const body = note.trim();
  const canRefine = Boolean(actions?.refine) && body.length > 0 && !sending;

  useEffect(() => {
    if (refining) refineRef.current?.querySelector('textarea')?.focus();
  }, [refining]);

  const refine = useCallback(() => {
    if (!canRefine || !actions?.refine) return;
    setSending(true);
    void actions.refine(comment, body).then((landed) => {
      if (landed) {
        setNote('');
        setRefining(false);
      }
      setSending(false);
    });
  }, [canRefine, actions, comment, body]);

  const onNoteKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isEditingKey(e)) e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      refine();
    }
  };

  if (status === 'accepted' || status === 'dismissed') {
    const accepted = status === 'accepted';
    const decider = decidedBy?.name;
    return (
      <div
        className={styles.record}
        data-testid="agent-proposal"
        data-status={status}
      >
        <SafeIcon iconName={accepted ? 'check' : 'xmark'} size="xs" />
        <span data-testid="agent-proposal-outcome">
          {accepted ? `Applied by ${agentName(comment)}` : 'Dismissed'}
          {decider && (
            <>
              {accepted ? ' on behalf of ' : ' by '}
              <b className={styles.decider}>{decider}</b>
            </>
          )}
        </span>
        {decidedAt && (
          <time className={styles.recordTime} dateTime={decidedAt}>
            {relativeTime(decidedAt, now)}
          </time>
        )}
      </div>
    );
  }

  return (
    <div className={styles.card} data-testid="agent-proposal" data-status={status}>
      <div className={styles.scope}>
        {block && (
          <span className={styles.blockChip} data-testid="agent-proposal-block">
            Block · {block}
          </span>
        )}
        <span className={styles.field} data-testid="agent-proposal-field">
          {single?.field ?? changeCount(changes.length)}
        </span>
      </div>

      <p className={styles.summary}>{summary}</p>

      {changes.map((change, i) => (
        <Preview key={i} change={change} heading={single ? undefined : change.field ?? (change.block !== block ? change.block : undefined)} />
      ))}

      <div className={styles.decisions}>
        <Button
          label="Accept"
          variant="primary"
          size="s"
          className={`${styles.button} ${styles.primary}`}
          disabled={deciding || !actions?.accept}
          onClick={() => void actions?.accept?.(comment)}
          data-testid="agent-proposal-accept"
        />
        {actions?.refine && (
          <Button
            label="Refine"
            variant="secondary"
            size="s"
            className={`${styles.button} ${styles.secondary}`}
            aria-expanded={refining}
            aria-controls={refineId}
            onClick={() => setRefining((open) => !open)}
            data-testid="agent-proposal-refine-toggle"
          />
        )}
        <span className={styles.spacer} />
        <Button
          label="Dismiss"
          variant="subtle"
          size="s"
          className={`${styles.button} ${styles.subtle}`}
          disabled={deciding || !actions?.dismiss}
          onClick={() => void actions?.dismiss?.(comment)}
          data-testid="agent-proposal-dismiss"
        />
      </div>

      {failed && (
        <span className={styles.failed} role="alert" data-testid="agent-proposal-failed">
          That did not go through. Try again.
        </span>
      )}

      {refining && actions?.refine && (
        <div ref={refineRef} className={styles.refine} id={refineId}>
          <Textarea
            id={`${refineId}-note`}
            label="Refine this proposal"
            showLabel={false}
            placeholder="Tell the agent what to change…"
            rows={2}
            size="s"
            className={styles.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            textareaProps={{ onKeyDown: onNoteKeyDown }}
          />
          <div>
            <Button
              label={`Send to ${agentName(comment)}`}
              variant="secondary"
              size="s"
              className={`${styles.button} ${styles.secondary}`}
              disabled={!canRefine}
              onClick={refine}
              data-testid="agent-proposal-refine"
            />
          </div>
        </div>
      )}
    </div>
  );
}
