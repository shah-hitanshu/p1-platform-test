"use client";

/**
 * EditorReloadOverlay
 *
 * Renders the waiting indicator for a `useP1Editor` reload that runs behind
 * content the user can still see, and owns the copy for each kind of wait.
 * Every P1 editor should describe these waits the same way, so the mapping
 * lives here rather than in each app's editor page.
 */

import React from 'react';
import { LoadingOverlay } from '../../pds/components/LoadingOverlay.js';
import type { ReloadKind } from '../useP1Editor.js';

const RELOAD_MESSAGES: Record<ReloadKind, string> = {
  branch: 'Switching workstream…',
  document: 'Loading page…',
};

export interface EditorReloadOverlayProps {
  /** The `reloading` value from useP1Editor — null renders nothing */
  reloading: ReloadKind | null;
}

export function EditorReloadOverlay({
  reloading,
}: EditorReloadOverlayProps): React.ReactElement | null {
  if (!reloading) return null;

  return (
    <LoadingOverlay
      message={RELOAD_MESSAGES[reloading]}
      data-testid={`editor-reloading-${reloading}`}
    />
  );
}
