/**
 * P1EditorSubheader
 *
 * Document task bar (48px). Renders: panel toggles, undo/redo, doc state badge,
 * and publish control. Agents and humans are shown elsewhere — humans as avatars
 * in P1EditorHeader, an editing agent on the block it holds.
 *
 * Note: Device/viewport controls are intentionally omitted — Puck's native
 * canvas toolbar already handles this. Compare with Live belongs in the header
 * bar (P1EditorHeader), shown only when not on the live workstream.
 */

import React from 'react';
import { IconButton } from '@pantheon-systems/pds-toolkit-react';
import type { Branch, RolePermissions } from '@pantheon-systems/css-client';
import type { DocState } from '../types.js';
import { PublishControl } from './PublishControl.js';
import { WorkstreamSwitcher } from './WorkstreamSwitcher.js';
import styles from './P1EditorSubheader.module.css';

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
  /** Greys out the publish button, e.g. while a historical version is previewed. */
  publishDisabled?: boolean;
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
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  /**
   * Controls contributed by feature plugins, placed alongside the document's
   * own controls. The toolbar does not know what they are.
   */
  featureActions?: React.ReactNode;
  // Workstream selector props
  branches: Branch[];
  currentBranch: Branch | null;
  onSwitchBranch: (id: string) => void;
  onCompareWithLive: () => void;
  onCreateBranch?: (name: string) => Promise<void>;
  /** Backend-resolved permissions; absent means no restrictions (backward compat). */
  permissions?: RolePermissions | null;
}

export function P1EditorSubheader({
  puckActions,
  docState,
  badgeDocState,
  hasDrift,
  context,
  publishDisabled,
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
  onToggleLeftPanel,
  onToggleRightPanel,
  featureActions,
  branches,
  currentBranch,
  onSwitchBranch,
  onCompareWithLive,
  onCreateBranch,
  permissions,
}: P1EditorSubheaderProps): React.ReactElement {
  // Undo/redo replay local edits that a read-only role could never save.
  const canEdit = permissions?.canEditDocuments ?? true;

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
          disabled={!hasPast || !canEdit}
          onClick={onUndo}
          hasTooltip={false}
          hasBorder={false}
        />
        <IconButton
          data-testid="redo-btn"
          ariaLabel="Redo"
          iconName="rotateRight"
          size="s"
          disabled={!hasFuture || !canEdit}
          onClick={onRedo}
          hasTooltip={false}
          hasBorder={false}
        />
      </div>

      {featureActions !== undefined && featureActions !== null && (
        <>
          <div className={styles.divider} aria-hidden="true" />
          <div className={styles.featureActions} data-testid="toolbar-feature-actions">
            {featureActions}
          </div>
        </>
      )}

      {/* Spacer */}
      <div className={styles.spacer} />

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
          permissions={permissions}
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
          permissions={permissions}
          disabled={publishDisabled}
          renderButtonOnly
        />
      </div>
    </div>
  );
}
