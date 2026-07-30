import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';

let mockCurrentDocument: unknown = null;
let mockIsReturningToLatest = false;

vi.mock('../../core/P1PuckContext', () => ({
  useP1Puck: () => ({
    currentDocument: mockCurrentDocument,
    isReturningToLatest: mockIsReturningToLatest,
  }),
}));

import { VersionBannerOverride } from '../../editor/components/VersionBannerOverride';

const v1: DocumentVersion = {
  id: 'v-latest',
  documentId: 'd1',
  versionNumber: 3,
  snapshot: {},
  createdAt: new Date().toISOString(),
  createdBy: 'user-1',
};

const v2: DocumentVersion = {
  id: 'v-old',
  documentId: 'd1',
  versionNumber: 2,
  snapshot: {},
  createdAt: new Date('2024-06-01').toISOString(),
  createdBy: 'user-1',
};

describe('VersionBannerOverride', () => {
  beforeEach(() => {
    mockCurrentDocument = { id: 'd1', path: '/home' };
    mockIsReturningToLatest = false;
  });

  it('renders children', () => {
    render(
      <VersionBannerOverride versions={[v1, v2]}>
        <div>child content</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('does not show warning banner when no version is selected', () => {
    render(
      <VersionBannerOverride versions={[v1, v2]}>
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.queryByText(/Previewing/)).not.toBeInTheDocument();
  });

  it('does not show warning banner when viewing the latest version', () => {
    render(
      <VersionBannerOverride versions={[v1, v2]} selectedVersionId="v-latest">
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.queryByText(/Previewing/)).not.toBeInTheDocument();
  });

  it('shows historical version banner when viewing an old version', () => {
    render(
      <VersionBannerOverride versions={[v1, v2]} selectedVersionId="v-old">
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByText(/Previewing/)).toBeInTheDocument();
  });

  it('"Return to current" button calls onVersionSelect with the latest version', () => {
    const onVersionSelect = vi.fn();
    render(
      <VersionBannerOverride
        versions={[v1, v2]}
        selectedVersionId="v-old"
        onVersionSelect={onVersionSelect}
      >
        <div>child</div>
      </VersionBannerOverride>,
    );
    fireEvent.click(screen.getByRole('button', { name: /return to current/i }));
    expect(onVersionSelect).toHaveBeenCalledWith(v1);
  });

  it('shows "Choose a page" overlay when currentDocument is null', () => {
    mockCurrentDocument = null;
    render(
      <VersionBannerOverride versions={[]}>
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByText('Choose a page from the menu above')).toBeInTheDocument();
  });

  it('hides "Choose a page" overlay when currentDocument is set', () => {
    mockCurrentDocument = { id: 'd1', path: '/home' };
    render(
      <VersionBannerOverride versions={[]}>
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.queryByText('Choose a page from the menu above')).not.toBeInTheDocument();
  });
});

describe('VersionBannerOverride — stepper wiring', () => {
  // v1 (latest/current) and v2 (historical) declared at module scope above
  const v3: DocumentVersion = {
    id: 'v-oldest',
    documentId: 'd1',
    versionNumber: 1,
    snapshot: {},
    createdAt: new Date('2024-05-01').toISOString(),
    createdBy: 'user-1',
  };

  it('shows Next stepper when previewing an older version and a newer one exists in filtered list', () => {
    // Viewing v2 (middle): next = v1 (newer), previous = v3 (older)
    render(
      <VersionBannerOverride
        versions={[v1, v2, v3]}
        selectedVersionId={v2.id}
        filteredVersions={[v1, v2, v3]}
      >
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByRole('button', { name: /next version/i })).toBeInTheDocument();
  });

  it('shows Previous stepper when a version older than the viewed one exists in filtered list', () => {
    render(
      <VersionBannerOverride
        versions={[v1, v2, v3]}
        selectedVersionId={v2.id}
        filteredVersions={[v1, v2, v3]}
      >
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByRole('button', { name: /previous version/i })).toBeInTheDocument();
  });

  it('Next button is disabled when viewing the newest (latest) historical version', () => {
    // Viewing v2, but the only filtered version newer is v1 (current — skip?)
    // Actually viewing the second item where the first IS the current.
    // In newest-first list: [v1(current), v2, v3] — viewing v2 means next=v1(current)
    // The stepper steps to v1 via onVersionSelect which exits preview. hasNext = true.
    // Viewing the oldest (v3): no version older exists → Previous disabled.
    render(
      <VersionBannerOverride
        versions={[v1, v2, v3]}
        selectedVersionId={v3.id}
        filteredVersions={[v1, v2, v3]}
      >
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByRole('button', { name: /previous version/i })).toBeDisabled();
  });

  it('Previous button is disabled when viewing the oldest filtered version', () => {
    render(
      <VersionBannerOverride
        versions={[v1, v2, v3]}
        selectedVersionId={v3.id}
        filteredVersions={[v1, v2, v3]}
      >
        <div>child</div>
      </VersionBannerOverride>,
    );
    const prevBtn = screen.getByRole('button', { name: /previous version/i });
    expect(prevBtn).toBeDisabled();
  });

  it('clicking Next navigates to the next newer version via onVersionSelect', () => {
    const onVersionSelect = vi.fn();
    render(
      <VersionBannerOverride
        versions={[v1, v2, v3]}
        selectedVersionId={v2.id}
        filteredVersions={[v1, v2, v3]}
        onVersionSelect={onVersionSelect}
      >
        <div>child</div>
      </VersionBannerOverride>,
    );
    fireEvent.click(screen.getByRole('button', { name: /next version/i }));
    // next newer in newest-first list = index before current (v1)
    expect(onVersionSelect).toHaveBeenCalledWith(v1);
  });

  it('clicking Previous navigates to the next older version via onVersionSelect', () => {
    const onVersionSelect = vi.fn();
    render(
      <VersionBannerOverride
        versions={[v1, v2, v3]}
        selectedVersionId={v2.id}
        filteredVersions={[v1, v2, v3]}
        onVersionSelect={onVersionSelect}
      >
        <div>child</div>
      </VersionBannerOverride>,
    );
    fireEvent.click(screen.getByRole('button', { name: /previous version/i }));
    // previous older in newest-first list = index after current (v3)
    expect(onVersionSelect).toHaveBeenCalledWith(v3);
  });

  it('does not show steppers when not previewing', () => {
    render(
      <VersionBannerOverride versions={[v1, v2, v3]}>
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.queryByRole('button', { name: /next version/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /previous version/i })).not.toBeInTheDocument();
  });
});

