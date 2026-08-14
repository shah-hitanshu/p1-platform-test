import { Icon, StatusIndicator } from '@pantheon-systems/pds-toolkit-react';
import type { DocState } from '../types.js';

export interface DocStateBadgeProps {
  docState: DocState;
  hasDrift?: boolean;
}

const STATUS_TYPE: Record<DocState, 'warning' | 'success' | 'info'> = {
  modified: 'warning',
  unpublished: 'warning',
  live: 'success',
  liveOnly: 'info',
};

const LABEL_TEXT: Record<DocState, string> = {
  modified: 'Modified',
  unpublished: 'Changes pending publishing',
  live: 'Live',
  liveOnly: 'Live only',
};

const DRIFT_STATES = new Set<DocState>(['modified', 'liveOnly']);

const DRIFT_TOOLTIP: Partial<Record<DocState, string>> = {
  modified:
    'Live has also changed this page since your branch was created. Compare before publishing.',
  liveOnly:
    'Live has made additional changes since your branch was created. You will get the latest version when you start editing.',
};

export function DocStateBadge({ docState, hasDrift = false }: DocStateBadgeProps) {
  const showDrift = hasDrift && DRIFT_STATES.has(docState);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
      <StatusIndicator
        label={LABEL_TEXT[docState]}
        type={STATUS_TYPE[docState]}
      />
      {showDrift && (
        <span
          data-testid="drift-warning"
          title={DRIFT_TOOLTIP[docState]}
          style={{ color: '#b45309', display: 'inline-flex', alignItems: 'center' }}
        >
          <Icon iconName="triangleExclamation" size="s" />
        </span>
      )}
    </span>
  );
}
