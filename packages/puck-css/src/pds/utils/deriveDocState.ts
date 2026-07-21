import type { DocState } from '../types.js';

interface DocLike {
  inherited?: boolean;
  isPublished?: boolean;
}

export function deriveDocState(doc: DocLike | null, isOnMainBranch: boolean): DocState {
  if (doc === null) {
    return 'liveOnly';
  }

  if (isOnMainBranch) {
    return doc.isPublished ? 'live' : 'unpublished';
  }

  if (doc.inherited) {
    return doc.isPublished ? 'live' : 'liveOnly';
  }

  // inherited === false or undefined — locally edited doc on a branch
  return 'modified';
}
