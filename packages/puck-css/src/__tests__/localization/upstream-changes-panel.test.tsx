import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChangeSummary } from '@pantheon-systems/css-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamChangesPanel } from '../../features/localization/ui/UpstreamChangesPanel.js';
import type { ReviewSession } from '../../features/localization/review-session.js';

vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Icon: () => null,
  SectionMessage: ({ onDismiss, 'data-testid': testId }: {
    onDismiss: () => void;
    'data-testid': string;
  }) => (
    <div data-testid={testId}>
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  ),
}));

vi.mock('../../features/localization/ui/UpstreamChangeRow.js', () => ({
  UpstreamChangeRow: () => null,
}));

const summary: ChangeSummary = {
  relationType: 'localization',
  upstreamDocumentId: 'source-document',
  upstreamVersionId: 'source-version',
  toVersionId: 'localized-version',
  counts: {
    needsTranslation: 1,
    autoApplied: 0,
    prop: 0,
    advisory: 0,
    structural: 0,
  },
  changes: [
    {
      classification: 'needsTranslation',
      componentId: 'heading',
      propPath: '/title',
      sourceValue: 'Updated title',
      currentValue: 'Translated title',
    },
  ],
};

const props = {
  diff: { state: 'ready' as const, summary, staleReason: null },
  documentLocale: 'fr-FR',
  dismissed: new Set<string>(),
  onResolve: vi.fn(),
  isPending: () => false,
  session: { replacements: new Map(), remember: vi.fn() } as ReviewSession,
};

describe('upstream changes explanation', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it('stays dismissed for the session and returns after session storage is cleared', () => {
    const first = render(<UpstreamChangesPanel {...props} />);
    expect(screen.getByTestId('upstream-out-of-sync-note')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('upstream-out-of-sync-note')).not.toBeInTheDocument();

    first.unmount();
    const second = render(<UpstreamChangesPanel {...props} />);
    expect(screen.queryByTestId('upstream-out-of-sync-note')).not.toBeInTheDocument();

    second.unmount();
    sessionStorage.clear();
    render(<UpstreamChangesPanel {...props} />);
    expect(screen.getByTestId('upstream-out-of-sync-note')).toBeInTheDocument();
  });
});
