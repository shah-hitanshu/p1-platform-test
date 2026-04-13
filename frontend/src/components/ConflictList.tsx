/**
 * Conflict List Component
 *
 * Displays a list of document conflicts in a merge request.
 */

import type { DocumentConflict, DocumentConflictType } from '../types';
import { StatusBadge } from '@pantheon-systems/pds-toolkit-react';
import './ConflictList.css';

interface ConflictListProps {
  conflicts: DocumentConflict[];
}

function getConflictTypeLabel(type: DocumentConflictType): string {
  switch (type) {
    case 'both-modified':
      return 'Both Modified';
    case 'deleted-in-source':
      return 'Deleted in Source';
    case 'deleted-in-target':
      return 'Deleted in Target';
    default:
      return type;
  }
}

export function ConflictList({ conflicts }: ConflictListProps) {
  if (conflicts.length === 0) {
    return (
      <div className="conflict-list-empty">
        <p>No conflicts to display.</p>
      </div>
    );
  }

  return (
    <div className="conflict-list">
      <div className="conflict-list-header">
        <span className="conflict-count">
          {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} found
        </span>
      </div>
      <div className="conflict-table-container">
        <table className="conflict-table">
          <thead>
            <tr>
              <th>Document Path</th>
              <th>Conflict Type</th>
              <th>Source Version</th>
              <th>Target Version</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((conflict) => (
              <tr key={conflict.documentId}>
                <td className="conflict-path">
                  <code>{conflict.documentPath}</code>
                </td>
                <td>
                  <StatusBadge
                    label={getConflictTypeLabel(conflict.conflictType)}
                    color="neutral"
                  />
                </td>
                <td className="conflict-version">
                  {conflict.sourceVersion !== undefined ? `v${conflict.sourceVersion}` : '-'}
                </td>
                <td className="conflict-version">
                  {conflict.targetVersion !== undefined ? `v${conflict.targetVersion}` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
