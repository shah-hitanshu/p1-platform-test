/**
 * P1EditorSubheader
 *
 * Document task bar (48px). Renders: panel toggles, presence (agents + humans),
 * undo/redo, doc state badge, and publish control.
 *
 * Note: Device/viewport controls are intentionally omitted — Puck's native
 * canvas toolbar already handles this. Compare with Live belongs in the header
 * bar (P1EditorHeader), shown only when not on the live workstream.
 */

import React from 'react';
import { IconButton } from '@pantheon-systems/pds-toolkit-react';
import type { DocState } from '../types.js';
import { AgentChip } from './AgentChip.js';
import { PresenceStack } from './PresenceStack.js';
import { PublishControl } from './PublishControl.js';
import styles from './P1EditorSubheader.module.css';

export interface SubheaderActor {
  id: string;
  name: string;
  avatar?: string;
  isAgent?: boolean;
  intent?: string;
}

export interface P1EditorSubheaderProps {
  puckActions: React.ReactNode;
  docState: DocState;
  hasDrift?: boolean;
  context: 'branch' | 'main';
  agents: SubheaderActor[];
  humanActors: SubheaderActor[];
  onStopAgent: (id: string) => void;
  onPublish?: () => Promise<void> | void;
  onReviewAndPublish?: () => void;
  onCreateWorkstream?: () => void;
  onDeleteDocument?: () => Promise<void> | void;
  hasPast: boolean;
  hasFuture: boolean;
  onUndo: () => void;
  onRedo: () => void;
  leftPanelVisible?: boolean;
  rightPanelVisible?: boolean;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
}

export function P1EditorSubheader({
  puckActions,
  docState,
  hasDrift,
  context,
  agents,
  humanActors,
  onStopAgent,
  onPublish,
  onReviewAndPublish,
  onCreateWorkstream,
  onDeleteDocument,
  hasPast,
  hasFuture,
  onUndo,
  onRedo,
  leftPanelVisible,
  rightPanelVisible,
  onToggleLeftPanel,
  onToggleRightPanel,
}: P1EditorSubheaderProps): React.ReactElement {
  return (
    <div data-testid="p1-editor-subheader" className={styles.subheader}>
      {/* Panel toggles — hidden on mobile */}
      <div data-testid="panel-toggles" className={styles.panelToggles}>
        <IconButton
          ariaLabel="Toggle left panel"
          iconName="tableRows"
          size="s"
          hasTooltip={false}
          hasBorder={false}
          aria-pressed={leftPanelVisible}
          onClick={onToggleLeftPanel}
        />
        <IconButton
          ariaLabel="Toggle right panel"
          iconName="penField"
          size="s"
          hasTooltip={false}
          hasBorder={false}
          aria-pressed={rightPanelVisible}
          onClick={onToggleRightPanel}
        />
      </div>

      {/* Puck's native undo/redo actions are passed through here */}
      {puckActions}

      {/* Manual undo/redo */}
      <div data-testid="device-selector" className={styles.historyGroup}>
        <IconButton
          data-testid="undo-btn"
          ariaLabel="Undo"
          iconName="rotateLeft"
          size="s"
          disabled={!hasPast}
          onClick={onUndo}
          hasTooltip={false}
          hasBorder={false}
        />
        <IconButton
          data-testid="redo-btn"
          ariaLabel="Redo"
          iconName="rotateRight"
          size="s"
          disabled={!hasFuture}
          onClick={onRedo}
          hasTooltip={false}
          hasBorder={false}
        />
      </div>

      {/* Spacer */}
      <div className={styles.spacer} />

      {/* Agents + presence — scrollable when overflow */}
      <div className={styles.actorsArea}>
        {agents.map((actor) => (
          <AgentChip
            key={actor.id}
            id={actor.id}
            agent={{
              id: actor.id,
              name: actor.name,
              initials: actor.name[0] ?? '',
              gradient: '',
              intent: actor.intent ?? '',
              workstream: '',
            }}
            currentWorkstream=""
            onStop={() => onStopAgent(actor.id)}
          />
        ))}

        {humanActors.length > 0 && (
          <PresenceStack
            actors={humanActors.map((a) => ({
              id: a.id,
              actorId: a.id,
              actorType: 'user' as const,
              role: 'human' as const,
              name: a.name,
              avatar: a.avatar,
              state: 'active' as const,
              lastActivityAt: new Date().toISOString(),
              joinedAt: new Date().toISOString(),
            }))}
            maxVisible={3}
          />
        )}
      </div>

      {/* Divider */}
      <div className={styles.divider} />

      {/* Publish control (owns DocStateBadge internally) */}
      <PublishControl
        docState={docState}
        hasDrift={hasDrift}
        context={context}
        onPublish={onPublish}
        onReviewAndPublish={onReviewAndPublish}
        onCreateWorkstream={onCreateWorkstream}
        onDeleteDocument={onDeleteDocument}
      />
    </div>
  );
}
