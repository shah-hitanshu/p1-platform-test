/**
 * AgentChip component.
 *
 * Displays a compact representation of an active AI agent, including its
 * name, current intent, optional progress, cross-workstream indicator, and
 * a stop button allowing the user to halt the agent.
 */

import React from 'react';
import { Avatar, Icon } from '@pantheon-systems/pds-toolkit-react';
import styles from './AgentChip.module.css';

// =============================================================================
// Types
// =============================================================================

export interface AgentChipAgent {
  id: string;
  name: string;
  initials: string;
  gradient: string;
  intent: string;
  progress?: string;
  workstream: string;
  /** Display name of the human driving this agent session (human_requested sessions only) */
  requestedByName?: string;
}

export interface AgentChipProps {
  agent: AgentChipAgent;
  onStop: (agentId: string) => void;
  currentWorkstream?: string;
  /** HTML prop pass-through for test compatibility */
  id?: string;
}

// =============================================================================
// Component
// =============================================================================

export function AgentChip({ agent, onStop, currentWorkstream, id }: AgentChipProps): React.JSX.Element {
  const showWorkstreamBadge =
    currentWorkstream === undefined || agent.workstream !== currentWorkstream;

  const displayName = agent.requestedByName
    ? `Agent on behalf of ${agent.requestedByName}`
    : agent.name;

  function handleStop(): void {
    onStop(agent.id);
  }

  return (
    <div className={styles.chip} id={id}>
      <div
        className={styles.avatarWrapper}
        data-testid="agent-chip-avatar"
      >
        <Avatar uniqueId={agent.id} size="s" />
        <span className={styles.robotOverlay} aria-hidden="true">
          <Icon iconName="robot" size="s" />
        </span>
      </div>

      <span className={styles.info}>
        <span data-testid="agent-chip-name" className={styles.name}>
          {displayName}
        </span>
        <span data-testid="agent-chip-intent" className={styles.intent}>
          {agent.intent}
          {agent.progress !== undefined && (
            <> &mdash; {agent.progress}</>
          )}
        </span>
      </span>

      {showWorkstreamBadge && (
        <span
          data-testid="agent-chip-workstream-badge"
          className={styles.workstreamBadge}
          title={agent.workstream}
        >
          {agent.workstream}
        </span>
      )}

      <button
        data-testid="agent-chip-stop"
        className={styles.stopButton}
        aria-label={`Stop ${displayName}`}
        type="button"
        onClick={handleStop}
      >
        &#x25A0;
      </button>
    </div>
  );
}
