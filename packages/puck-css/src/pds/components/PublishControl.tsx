import React, { useCallback } from 'react';
import { SplitButton, Button, useToast, ToastType } from '@pantheon-systems/pds-toolkit-react';
import type { DocState } from '../types.js';
import { DocStateBadge } from './DocStateBadge.js';
import styles from './PublishControl.module.css';

const PUBLISH_CONFIRM_TOAST_ID = 'publish-confirm';
const DELETE_CONFIRM_TOAST_ID = 'delete-confirm';

interface PublishControlProps {
  docState: DocState;
  hasDrift?: boolean;
  context: 'branch' | 'main';
  onPublish?: () => Promise<void> | void;
  onReviewAndPublish?: () => void;
  onReviewWorkstream?: () => void;
  onCreateWorkstream?: () => void;
  onSchedulePublish?: () => void;
  onDeleteDocument?: () => Promise<void> | void;
  renderBadgeOnly?: boolean;
  renderButtonOnly?: boolean;
}

function buildActionItems(
  docState: DocState,
  hasDrift: boolean,
  context: 'branch' | 'main',
  onRequestPublish?: () => void,
  onReviewWorkstream?: () => void,
  onCreateWorkstream?: () => void,
  onRequestDelete?: () => void
) {
  const items: { label: string; callback: () => void; disabled?: boolean }[] = [];

  if (docState === 'modified') {
    // When on a branch, always show "Review" regardless of drift
    if (context === 'branch') {
      items.push({ label: 'Review', callback: () => onReviewWorkstream?.() });

      // Add "Publish this page to Live" with drift warning if needed
      const publishLabel = hasDrift
        ? 'Publish this page to Live\n⚠️ Page changed since you edited'
        : 'Publish this page to Live';
      items.push({ label: publishLabel, callback: () => onRequestPublish?.() });
    } else {
      // On main, keep existing behavior
      items.push({ label: 'Publish to live', callback: () => onRequestPublish?.() });
    }
    items.push({ label: 'Schedule publish', callback: () => {}, disabled: true });
  } else if (docState === 'unpublished' && context === 'main') {
    items.push({ label: 'Publish', callback: () => onRequestPublish?.() });
    items.push({ label: 'Create a new workstream', callback: () => onCreateWorkstream?.() });
    items.push({ label: 'Schedule publish', callback: () => {}, disabled: true });
  }

  if (onRequestDelete) {
    items.push({ label: 'Delete page', callback: () => onRequestDelete() });
  }

  return items;
}

export function PublishControl({
  docState,
  hasDrift = false,
  context,
  onPublish,
  onReviewAndPublish: _onReviewAndPublish,
  onReviewWorkstream,
  onCreateWorkstream,
  onDeleteDocument,
  renderBadgeOnly = false,
  renderButtonOnly = false,
}: PublishControlProps): React.ReactElement {
  const [addToast, toastApi] = useToast();

  const handlePublishRequest = useCallback(() => {
    addToast(
      ToastType.Warning,
      <div className={styles.confirmContent}>
        <span>Publish directly to live site?</span>
        <div className="pds-button-group">
          <Button
            label="Confirm"
            onClick={() => {
              toastApi.dismiss(PUBLISH_CONFIRM_TOAST_ID);
              void onPublish?.();
            }}
            size="sm"
            variant={"primary" as never}
          />
          <Button
            label="Cancel"
            onClick={() => toastApi.dismiss(PUBLISH_CONFIRM_TOAST_ID)}
            size="sm"
            variant={"secondary" as never}
          />
        </div>
      </div>,
      { toastId: PUBLISH_CONFIRM_TOAST_ID }
    );
  }, [addToast, toastApi, onPublish]);

  const handleDeleteRequest = useCallback(() => {
    addToast(
      ToastType.Warning,
      <div className={styles.confirmContent}>
        <span>Permanently delete this page?</span>
        <div className="pds-button-group">
          <Button
            label="Delete"
            onClick={() => {
              toastApi.dismiss(DELETE_CONFIRM_TOAST_ID);
              void onDeleteDocument?.();
            }}
            size="sm"
            variant={"primary" as never}
          />
          <Button
            label="Cancel"
            onClick={() => toastApi.dismiss(DELETE_CONFIRM_TOAST_ID)}
            size="sm"
            variant={"secondary" as never}
          />
        </div>
      </div>,
      { toastId: DELETE_CONFIRM_TOAST_ID }
    );
  }, [addToast, toastApi, onDeleteDocument]);

  const actionItems = buildActionItems(
    docState,
    hasDrift,
    context,
    handlePublishRequest,
    onReviewWorkstream,
    onCreateWorkstream,
    onDeleteDocument ? handleDeleteRequest : undefined
  );

  const hasActions = actionItems.length > 0;

  // Render only the badge
  if (renderBadgeOnly) {
    return (
      <span className={styles.stateBadge}>
        <DocStateBadge docState={docState} hasDrift={hasDrift} />
      </span>
    );
  }

  // Render only the button
  if (renderButtonOnly) {
    return hasActions ? (
      <SplitButton
        id="publish-split-button"
        data-testid="publish-split-button"
        actionItems={actionItems}
        size="s"
        variant="primary"
      />
    ) : <></>;
  }

  // Render both (default)
  return (
    <div className={styles.container} data-testid="publish-control">
      <span className={styles.stateBadge}>
        <DocStateBadge docState={docState} hasDrift={hasDrift} />
      </span>

      {hasActions && (
        <SplitButton
          id="publish-split-button"
          data-testid="publish-split-button"
          actionItems={actionItems}
          size="s"
          variant="primary"
        />
      )}
    </div>
  );
}
