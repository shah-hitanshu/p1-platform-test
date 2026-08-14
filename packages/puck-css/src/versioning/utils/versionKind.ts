import type { DocumentVersion } from '@pantheon-systems/css-client';

export type VersionKind = 'current' | 'published' | 'reverted' | 'autosave';

export const VERSION_KIND_META: Record<VersionKind, { tag: string | null; badgeClass: string; milestone: boolean }> = {
  current:   { tag: 'Current',   badgeClass: 'pds-badge pds-badge--success pds-badge--xs', milestone: false },
  published: { tag: 'Published', badgeClass: 'pds-badge pds-badge--info pds-badge--xs',    milestone: true  },
  reverted:  { tag: 'Reverted',  badgeClass: 'pds-badge pds-badge--warning pds-badge--xs', milestone: true  },
  autosave:  { tag: null,        badgeClass: '',                                         milestone: false },
};

/**
 * Returns all applicable display kinds for a version.
 * current, published, and reverted are independent labels that can coexist.
 * Returns ['autosave'] when none of the three apply.
 */
export function versionKinds(
  version: DocumentVersion,
  currentVersionId: string | undefined,
): VersionKind[] {
  const kinds: VersionKind[] = [];
  // Order matters: kinds[0] drives the timeline dot color (highest → lowest priority).
  if (version.id === currentVersionId) kinds.push('current');
  if (version.isPublished === true) kinds.push('published');
  if (version.source === 'revert') kinds.push('reverted');
  return kinds.length > 0 ? kinds : ['autosave'];
}

/**
 * Returns true for versions that represent a meaningful milestone:
 * published checkpoints and revert points.
 */
export function isMilestone(version: DocumentVersion): boolean {
  return versionKinds(version, undefined).some((k) => VERSION_KIND_META[k].milestone);
}
