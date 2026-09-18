import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Badge } from '@pantheon-systems/pds-toolkit-react';

import { SafeIcon } from '../../../pds/components/SafeIcon.js';
import type { MentionCandidate } from '../mentions.js';
import styles from './MentionPicker.module.css';

export interface MentionPickerProps {
  id: string;
  /** Already filtered to the query, agents first. */
  candidates: readonly MentionCandidate[];
  /** Index into `candidates` of the row the keyboard is on. */
  highlighted: number;
  onHighlight: (index: number) => void;
  onSelect: (candidate: MentionCandidate) => void;
}

export function mentionOptionId(pickerId: string, candidate: MentionCandidate): string {
  return `${pickerId}-${candidate.type}-${candidate.id}`;
}

function CandidateAvatar({ candidate }: { candidate: MentionCandidate }): React.ReactElement {
  if (candidate.type === 'agent') {
    return (
      <span className={styles.agentAvatar} aria-hidden="true">
        <SafeIcon iconName="sparkles" size="s" />
      </span>
    );
  }
  return (
    <Avatar
      className={styles.avatar}
      size="s"
      imageSrc={candidate.avatar ?? undefined}
      uniqueId={candidate.id}
      hasUserFallback
      aria-hidden="true"
    />
  );
}

function Group({
  label,
  pickerId,
  candidates,
  offset,
  highlighted,
  onHighlight,
  onSelect,
}: MentionPickerProps & { label: string; pickerId: string; offset: number }): React.ReactElement | null {
  if (candidates.length === 0) return null;
  return (
    <div role="group" aria-label={label} className={styles.group}>
      <div className={styles.heading} aria-hidden="true">
        {label}
      </div>
      {candidates.map((candidate, i) => {
        const index = offset + i;
        const active = index === highlighted;
        return (
          <button
            key={mentionOptionId(pickerId, candidate)}
            id={mentionOptionId(pickerId, candidate)}
            type="button"
            role="option"
            aria-selected={active}
            className={`${styles.option} ${active ? styles.active : ''}`}
            data-testid="mention-option"
            data-mention-type={candidate.type}
            data-mention-id={candidate.id}
            tabIndex={-1}
            onMouseEnter={() => onHighlight(index)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(candidate)}
          >
            <CandidateAvatar candidate={candidate} />
            <span className={styles.name}>{candidate.name}</span>
            {candidate.type === 'agent' ? (
              <Badge className={styles.agentBadge} label="Agent" color="silver-muted" size="xs" />
            ) : (
              <span className={styles.role}>{candidate.role}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The list that opens over the composer when a reader types `@`: agents, then the
 * site's members. The composer owns the keyboard, so this only draws the rows and says
 * which one is under the pointer or the arrow keys.
 */
export function MentionPicker(props: MentionPickerProps): React.ReactElement | null {
  const { id, candidates, highlighted } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);

  // The list lives inside the canvas frame and cannot escape it, so when the composer
  // sits too close to the frame's top edge the list opens under it instead.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const composer = root?.parentElement;
    if (!root || !composer) return;
    setBelow(root.offsetHeight > composer.getBoundingClientRect().top);
  }, [candidates]);

  useEffect(() => {
    const active = candidates[highlighted];
    if (!active || !rootRef.current) return;
    rootRef.current.ownerDocument
      .getElementById(mentionOptionId(id, active))
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [id, candidates, highlighted]);

  if (candidates.length === 0) return null;

  const agents = candidates.filter((c) => c.type === 'agent');
  const members = candidates.filter((c) => c.type !== 'agent');

  return (
    <div
      ref={rootRef}
      id={id}
      role="listbox"
      aria-label="Mention someone"
      className={`${styles.picker} ${below ? styles.below : ''}`}
      data-testid="mention-picker"
      data-placement={below ? 'below' : 'above'}
    >
      <Group {...props} pickerId={id} label="Agent" candidates={agents} offset={0} />
      <Group {...props} pickerId={id} label="Site members" candidates={members} offset={agents.length} />
    </div>
  );
}
