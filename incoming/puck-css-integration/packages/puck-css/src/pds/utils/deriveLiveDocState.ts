import type { DocState } from '../types.js';

type PublishedStatus = 'published' | 'unpublished-changes' | 'draft';

/**
 * Maps the publish state to a badge DocState — but ONLY on the Live (main)
 * branch. On any other branch, or while the published status is still unknown,
 * returns `undefined` so the badge is hidden (we never show a guessed state).
 *
 * On Live:
 *   'published'           → 'live'        ("Live")
 *   'unpublished-changes' → 'unpublished' ("Changes pending publishing")
 *   'draft'               → 'unpublished' ("Changes pending publishing")
 *
 * @param publishedStatus - The published status from useP1Editor (or undefined while loading).
 * @param isOnMain - Whether the editor is on the Live (main) branch.
 */
export function deriveLiveDocState(
  publishedStatus: PublishedStatus | undefined,
  isOnMain: boolean,
): DocState | undefined {
  if (!isOnMain || !publishedStatus) {
    return undefined;
  }
  return publishedStatus === 'published' ? 'live' : 'unpublished';
}
