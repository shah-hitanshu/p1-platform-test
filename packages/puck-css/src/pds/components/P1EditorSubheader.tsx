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
import type { Branch } from '@pantheon-systems/css-client';
import type { DocState } from '../types.js';
import { AgentChip } from './AgentChip.js';
import { PublishControl } from './PublishControl.js';
import { WorkstreamSwitcher } from './WorkstreamSwitcher.js';
import styles from './P1EditorSubheader.module.css';

export interface SubheaderActor {
  id: string;
  name: string;
  avatar?: string;
  isAgent?: boolean;
  intent?: string;
  /** Reserved for future use (e.g. linking to user profile). Not passed to AgentChip. */
  requestedById?: string;
  requestedByName?: string;
}

export interface P1EditorSubheaderProps {
  puckActions: React.ReactNode;
  docState: DocState;
  /**
   * State for the publish *badge*. When undefined the badge is hidden (e.g. off
   * the Live branch, or while the published status is unknown). Distinct from
   * `docState`, which always drives the publish button/actions.
   */
  badgeDocState?: DocState;
  hasDrift?: boolean;
  context: 'branch' | 'main';
  agents: SubheaderActor[];
  onStopAgent: (id: string) => void;
  onPublish?: () => Promise<void> | void;
  onReviewAndPublish?: () => void;
  onReviewWorkstream?: () => void;
  onCreateWorkstream?: () => void;
  onDeleteDocument?: () => Promise<void> | void;
  hasPast: boolean;
  hasFuture: boolean;
  onUndo: () => void;
  onRedo: () => void;
  leftPanelVisible?: boolean;
  rightPanelVisible?: boolean;
  pluginRailVisible?: boolean;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  onTogglePluginRail?: () => void;
  // Workstream selector props
  branches: Branch[];
  currentBranch: Branch | null;
  onSwitchBranch: (id: string) => void;
  onCompareWithLive: () => void;
  onCreateBranch?: (name: string) => Promise<void>;
}

export function P1EditorSubheader({
  puckActions,
  docState,
  badgeDocState,
  hasDrift,
  context,
  agents,
  onStopAgent,
  onPublish,
  onReviewAndPublish,
  onReviewWorkstream,
  onCreateWorkstream,
  onDeleteDocument,
  hasPast,
  hasFuture,
  onUndo,
  onRedo,
  leftPanelVisible,
  rightPanelVisible,
  pluginRailVisible,
  onToggleLeftPanel,
  onToggleRightPanel,
  onTogglePluginRail,
  branches,
  currentBranch,
  onSwitchBranch,
  onCompareWithLive,
  onCreateBranch,
}: P1EditorSubheaderProps): React.ReactElement {
  return (
    <div data-testid="p1-editor-subheader" className={styles.subheader}>
      {/* Panel toggles — hidden on mobile */}
      <div data-testid="panel-toggles" className={styles.panelToggles}>
        <IconButton
          ariaLabel="Toggle plugin rail"
          iconName={pluginRailVisible ? "angleRight" : "angleLeft"}
          size="s"
          hasTooltip={false}
          hasBorder={false}
          aria-pressed={pluginRailVisible}
          onClick={onTogglePluginRail}
        />
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
          iconName="tableRows"
          size="s"
          hasTooltip={false}
          hasBorder={false}
          aria-pressed={rightPanelVisible}
          onClick={onToggleRightPanel}
          className={styles.rightPanelToggle}
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
              requestedByName: actor.requestedByName,
            }}
            currentWorkstream=""
            onStop={() => onStopAgent(actor.id)}
          />
        ))}

      </div>

      {/* Doc state badge — shown only when a badge state is provided
          (Live branch, status known); otherwise hidden. */}
      {badgeDocState && (
        <PublishControl
          docState={badgeDocState}
          hasDrift={hasDrift}
          context={context}
          onPublish={onPublish}
          onReviewAndPublish={onReviewAndPublish}
          onReviewWorkstream={onReviewWorkstream}
          onCreateWorkstream={onCreateWorkstream}
          onDeleteDocument={onDeleteDocument}
          renderBadgeOnly
        />
      )}

      {/* Workstream selector + Publish button group */}
      <div className={styles.workstreamPublishGroup}>
        <WorkstreamSwitcher
          branches={branches}
          currentBranch={currentBranch}
          onSwitch={onSwitchBranch}
          onCompareWithLive={onCompareWithLive}
          hideCompareButton
          onCreateBranch={onCreateBranch}
        />

        {/* Publish button only (badge rendered separately) */}
        <PublishControl
          docState={docState}
          hasDrift={hasDrift}
          context={context}
          onPublish={onPublish}
          onReviewAndPublish={onReviewAndPublish}
          onReviewWorkstream={onReviewWorkstream}
          onCreateWorkstream={onCreateWorkstream}
          onDeleteDocument={onDeleteDocument}
          renderButtonOnly
        />
      </div>
    </div>
  );
}
