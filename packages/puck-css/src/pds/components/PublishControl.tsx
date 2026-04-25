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
  onCreateWorkstream?: () => void;
  onSchedulePublish?: () => void;
  onDeleteDocument?: () => Promise<void> | void;
}

function buildActionItems(
  docState: DocState,
  hasDrift: boolean,
  context: 'branch' | 'main',
  onRequestPublish?: () => void,
  onReviewAndPublish?: () => void,
  onCreateWorkstream?: () => void,
  onRequestDelete?: () => void
) {
  const items: { label: string; callback: () => void; disabled?: boolean }[] = [];

  if (docState === 'modified' && !hasDrift) {
    items.push({ label: 'Publish to live', callback: () => onRequestPublish?.() });
    items.push({ label: 'Schedule publish', callback: () => {}, disabled: true });
  } else if (docState === 'modified' && hasDrift) {
    items.push({ label: 'Review & publish', callback: () => onReviewAndPublish?.() });
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
  onReviewAndPublish,
  onCreateWorkstream,
  onDeleteDocument,
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
            variant={"reverse" as never}
          />
          <Button
            label="Cancel"
            onClick={() => toastApi.dismiss(PUBLISH_CONFIRM_TOAST_ID)}
            size="sm"
            variant={"reverse-secondary" as never}
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
            variant={"reverse" as never}
          />
          <Button
            label="Cancel"
            onClick={() => toastApi.dismiss(DELETE_CONFIRM_TOAST_ID)}
            size="sm"
            variant={"reverse-secondary" as never}
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
    onReviewAndPublish,
    onCreateWorkstream,
    onDeleteDocument ? handleDeleteRequest : undefined
  );

  const hasActions = actionItems.length > 0;

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
