import type { ThreadOverview } from '../../types/threads';
import { isUuid } from '../../utils/uuid';

export interface ThreadCursor {
  updatedAt: string;
  id: string;
}

/** Keyset position after a thread: its (updated_at, id) so a page boundary never skips or repeats. */
export function encodeCursor(thread: ThreadOverview): string {
  return btoa(`${thread.updatedAt}|${thread.id}`);
}

/** A cursor that does not decode to (timestamp, id) is ignored rather than rejected. */
export function decodeCursor(cursor: string | undefined): ThreadCursor | null {
  if (cursor === undefined || cursor === '') return null;
  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    return null;
  }
  const separator = decoded.indexOf('|');
  if (separator === -1) return null;
  const updatedAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(Date.parse(updatedAt)) || !isUuid(id)) return null;
  return { updatedAt, id };
}
