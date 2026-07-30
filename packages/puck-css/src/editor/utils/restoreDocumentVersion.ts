import type { DocumentVersion } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';

type RestoreDeps = Pick<
  P1PuckContextValue,
  | 'client'
  | 'siteId'
  | 'branchId'
  | 'currentDocument'
  | 'pauseAutoSave'
  | 'resumeAutoSave'
  | 'persistCurrentEdits'
  | 'loadDocument'
  | 'notifications'
>;

/**
 * Reverts the document to a previous version.
 *
 * Flow:
 * 1. Pause auto-save and flush any pending edits (with a confirm fallback on flush failure).
 * 2. Call the restore API. On success, best-effort reload the document.
 * 3. Resume auto-save (always, in finally).
 * 4. Notify the caller whether the reload succeeded so it can refresh the
 *    version list and remount Puck with clean state.
 *
 * @param onReloadSuccess - Called when the post-restore document reload succeeds.
 */
export async function restoreDocumentVersion(
  version: DocumentVersion,
  deps: RestoreDeps,
  refreshVersions: () => Promise<void>,
  onReloadSuccess: () => void,
): Promise<void> {
  const { client, siteId, branchId, currentDocument, pauseAutoSave, resumeAutoSave,
          persistCurrentEdits, loadDocument, notifications } = deps;

  if (!currentDocument) return;

  pauseAutoSave();

  try {
    await persistCurrentEdits();
  } catch {
    const proceed = window.confirm(
      "Your current edits couldn't be saved. Proceed with the revert anyway?"
    );
    if (!proceed) {
      resumeAutoSave();
      return;
    }
  }

  let reloadSucceeded = false;
  try {
    await client.versions.restore(siteId, branchId, currentDocument.id, version.id);
    try {
      await loadDocument(currentDocument.path);
      reloadSucceeded = true;
    } catch {
      notifications.addNotification({
        severity: 'warning',
        message: 'Revert succeeded, but the editor content could not be refreshed. Please reload the page.',
      });
    }
  } finally {
    resumeAutoSave();
  }

  await refreshVersions();
  if (reloadSucceeded) onReloadSuccess();
}
