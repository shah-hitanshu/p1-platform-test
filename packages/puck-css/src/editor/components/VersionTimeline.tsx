import React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { formatVersionDate } from '../../versioning/utils/formatVersionDate.js';
import { versionKinds, VERSION_KIND_META } from '../../versioning/utils/versionKind.js';
import type { CurrentUser } from '../../pds/components/P1EditorHeader.js';

export interface VersionTimelineProps {
  dayGroups: Array<{ label: string; versions: DocumentVersion[] }>;
  /** Full version list — used to look up revert-source version numbers. */
  allVersions: DocumentVersion[];
  selectedVersionId?: string;
  currentVersionId?: string;
  isPreviewing: boolean;
  unpublishedCount: number;
  currentUser?: CurrentUser;
  resolveAuthorName?: (id: string, type: 'user' | 'agent') => string | undefined;
  onVersionSelect?: (version: DocumentVersion) => void;
}

export function VersionTimeline({
  dayGroups,
  allVersions,
  selectedVersionId,
  currentVersionId,
  isPreviewing,
  unpublishedCount,
  currentUser,
  resolveAuthorName,
  onVersionSelect,
}: VersionTimelineProps): React.ReactElement {
  return (
    <div className="css-plugin-version-groups">
      {dayGroups.map((group) => (
        <div key={group.label} className="css-plugin-version-day-group">
          <div className="css-plugin-version-day-header">{group.label}</div>
          <ul className="css-plugin-version-list css-plugin-version-list--timeline">
            {group.versions.map((version) => {
              const isCurrent = version.id === currentVersionId;
              const isSelected = version.id === selectedVersionId;
              const kinds = versionKinds(version, currentVersionId);
              const primaryKind = kinds[0];
              const authorName = resolveAuthorName?.(version.createdById, version.createdByType)
                ?? (version.createdById === currentUser?.id
                  ? (currentUser?.name ?? currentUser?.email ?? 'You')
                  : version.createdByType === 'agent'
                    ? version.createdById
                    : 'User');

              return (
                <li
                  key={version.id}
                  className={[
                    'css-plugin-version-item',
                    'css-plugin-version-row',
                    isCurrent ? 'css-plugin-version-row--current' : '',
                    isCurrent && isPreviewing ? 'css-plugin-version-row--exits-preview' : '',
                    isSelected ? 'css-plugin-version-item--selected css-plugin-version-row--selected' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (isCurrent) { if (isPreviewing) onVersionSelect?.(version); return; }
                    onVersionSelect?.(version);
                  }}
                >
                  <span
                    className={[
                      'css-plugin-version-dot',
                      primaryKind !== 'autosave' ? `css-plugin-version-dot--${primaryKind}` : '',
                    ].filter(Boolean).join(' ')}
                    aria-hidden="true"
                  />
                  <div className="css-plugin-version-content">
                    <div className="css-plugin-version-meta">
                      <span className="css-plugin-version-number">v{version.versionNumber}</span>
                      {kinds.filter(k => VERSION_KIND_META[k].tag).map(k => (
                        <span
                          key={k}
                          className={[
                            'css-plugin-version-kind-tag',
                            `css-plugin-version-kind-tag--${k}`,
                            VERSION_KIND_META[k].badgeClass,
                          ].filter(Boolean).join(' ')}
                        >
                          {VERSION_KIND_META[k].tag}
                        </span>
                      ))}
                    </div>
                    <div className="css-plugin-version-byline">
                      {formatVersionDate(version.createdAt)} · {authorName}
                    </div>
                    {version.source === 'revert' && version.sourceVersionId && (() => {
                      const sourceVer = allVersions.find(v => v.id === version.sourceVersionId);
                      return sourceVer ? (
                        <div className="css-plugin-version-revert-source">
                          Reverted to v{sourceVer.versionNumber}
                        </div>
                      ) : null;
                    })()}
                    {isCurrent && unpublishedCount > 0 && (
                      <span className="css-plugin-version-unpublished">
                        {unpublishedCount} unpublished change{unpublishedCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
