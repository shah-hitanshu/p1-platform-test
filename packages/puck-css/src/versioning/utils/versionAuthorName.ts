import type { DocumentVersion } from '@pantheon-systems/css-client';
import type { CurrentUser } from '../../pds/components/P1EditorHeader.js';

export interface VersionAuthorNameOptions {
  currentUser?: CurrentUser;
  resolveAuthorName?: (id: string, type: 'user' | 'agent') => string | undefined;
}

/** The byline for a version: who saved it, or which agent did so and for whom. */
export function versionAuthorName(
  version: DocumentVersion,
  { currentUser, resolveAuthorName }: VersionAuthorNameOptions,
): string {
  if (version.attribution) {
    return `${version.attribution.agent.name} on behalf of ${version.attribution.onBehalfOf.name}`;
  }
  const resolved = resolveAuthorName?.(version.createdById, version.createdByType);
  if (resolved !== undefined) return resolved;
  if (version.createdById === currentUser?.id) {
    return currentUser?.name ?? currentUser?.email ?? 'You';
  }
  return version.createdByType === 'agent' ? version.createdById : 'User';
}
